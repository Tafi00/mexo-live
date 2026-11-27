/**
 * Trình quản lý tải video lên (cấp module, không gắn với trang nào).
 * - Chuyển trang trong ứng dụng không làm hủy tải lên.
 * - Tải theo đoạn, tiếp tục được: máy chủ nhận biết file qua (tên | dung lượng | ngày sửa đổi).
 * - Lỗi mạng → thử lại tự động với thời gian chờ tăng dần.
 * - Cảnh báo khi đóng tab trong lúc đang tải.
 */
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LIMITS } from '@mexo/shared';
import { api, ApiError } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { MAX_VIDEO_BYTES, VIDEO_EXT_RE, videoFailText } from './labels';

export type UploadPhase = 'queued' | 'probing' | 'starting' | 'uploading' | 'paused' | 'done' | 'failed' | 'error' | 'cancelled';

export interface UploadItem {
  id: string;
  shopId: number;
  shopName: string | null;
  fileName: string;
  size: number;
  lastModified: number;
  folderId: number | null;
  phase: UploadPhase;
  uploaded: number;
  /** byte/giây (trung bình trượt) */
  speed: number;
  videoId: number | null;
  /** Tiếp tục một lần tải dở trước đó */
  resumed: boolean;
  resumedFrom: number;
  /** Gắn lại file gốc cho video nhập từ hệ thống cũ */
  relinked: boolean;
  error: string | null;
  failReason: string | null;
  /** Đang chờ thử lại (giây) */
  retryIn: number | null;
  addedAt: number;
  finishedAt: number | null;
}

interface InitRes {
  videoId: number;
  uploadedBytes: number;
  resumed: boolean;
  relinked?: boolean;
  chunkBytes: number;
}
interface ChunkRes {
  uploadedBytes: number;
  status?: 'uploading' | 'ready' | 'failed' | 'processing';
  mismatch?: boolean;
  failReason?: string;
}
interface Meta {
  durationSec: number | null;
  width: number | null;
  height: number | null;
}
interface Internal {
  file: File;
  ctrl: AbortController | null;
  meta: Meta | null;
}

const ACTIVE: UploadPhase[] = ['queued', 'probing', 'starting', 'uploading'];
const RUNNING: UploadPhase[] = ['probing', 'starting', 'uploading'];
const MAX_PARALLEL = 2;
const MAX_RETRY = 6;

let items: UploadItem[] = [];
const internals = new Map<string, Internal>();
const listeners = new Set<() => void>();
let queryClient: QueryClient | null = null;
let seq = 0;

export const isActivePhase = (p: UploadPhase) => ACTIVE.includes(p);

function emit() {
  for (const l of listeners) l();
  syncUnloadGuard();
}

function patch(id: string, p: Partial<UploadItem>) {
  items = items.map((it) => (it.id === id ? { ...it, ...p } : it));
  emit();
}

function get(id: string) {
  return items.find((i) => i.id === id);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => items;

/** Danh sách tải lên hiện tại (mọi shop) */
export function useUploads(): UploadItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Gắn QueryClient để tự làm mới thư viện / mẫu phát khi tải xong */
export function bindQueryClient(qc: QueryClient) {
  queryClient = qc;
}

function invalidate(shopId: number, templates = false) {
  if (!queryClient) return;
  void queryClient.invalidateQueries({ queryKey: ['shop', shopId, 'videos'] });
  if (templates) void queryClient.invalidateQueries({ queryKey: ['shop', shopId, 'templates'] });
}

// ───────────── Cảnh báo rời trang ─────────────
function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = '';
}
let guardOn = false;
function syncUnloadGuard() {
  const need = items.some((i) => isActivePhase(i.phase));
  if (need && !guardOn) {
    window.addEventListener('beforeunload', onBeforeUnload);
    guardOn = true;
  } else if (!need && guardOn) {
    window.removeEventListener('beforeunload', onBeforeUnload);
    guardOn = false;
  }
}

// ───────────── Đọc thông tin video trong trình duyệt ─────────────
/** Đọc thời lượng / độ phân giải bằng thẻ <video> ẩn (loadedmetadata). Định dạng trình duyệt không đọc được → null. */
export function readVideoMeta(file: File, timeoutMs = 10_000): Promise<Meta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.style.display = 'none';
    let done = false;
    const finish = (m: Meta) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      try {
        v.load();
      } catch {
        /* bỏ qua */
      }
      v.remove();
      URL.revokeObjectURL(url);
      resolve(m);
    };
    const timer = setTimeout(() => finish({ durationSec: null, width: null, height: null }), timeoutMs);
    v.onloadedmetadata = () =>
      finish({
        durationSec: Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration * 100) / 100 : null,
        width: v.videoWidth || null,
        height: v.videoHeight || null,
      });
    v.onerror = () => finish({ durationSec: null, width: null, height: null });
    document.body.appendChild(v);
    v.src = url;
  });
}

// ───────────── Tiện ích ─────────────
function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === 'AbortError';
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function friendlyError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Mất kết nối tới máy chủ. Bấm “Thử lại” để tiếp tục từ chỗ đang dở.';
}

/** Gọi lại khi lỗi mạng / lỗi máy chủ tạm thời, chờ 1 → 2 → 4 → 8 → 16 → 30 giây */
async function withRetry<T>(id: string, ctrl: AbortController, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fn();
      if (attempt) patch(id, { retryIn: null, error: null });
      return r;
    } catch (e) {
      if (ctrl.signal.aborted || isAbort(e)) throw e;
      const transient = !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429;
      if (!transient || attempt >= MAX_RETRY) throw e;
      const wait = Math.min(30, 2 ** attempt);
      patch(id, { retryIn: wait, error: 'Mất kết nối — đang thử lại', speed: 0 });
      await sleep(wait * 1000, ctrl.signal);
      patch(id, { retryIn: null });
    }
  }
}

// ───────────── Hàng đợi ─────────────
function pump() {
  const running = items.filter((i) => RUNNING.includes(i.phase)).length;
  let slots = MAX_PARALLEL - running;
  for (const it of items) {
    if (slots <= 0) break;
    if (it.phase === 'queued') {
      slots--;
      void run(it.id);
    }
  }
}

async function run(id: string) {
  const it = get(id);
  const inr = internals.get(id);
  if (!it || !inr) return;
  const ctrl = new AbortController();
  inr.ctrl = ctrl;
  patch(id, { phase: 'probing', error: null, failReason: null, retryIn: null, speed: 0 });
  const { shopId, size } = it;
  try {
    if (!inr.meta) inr.meta = await readVideoMeta(inr.file);
    if (ctrl.signal.aborted) return;
    patch(id, { phase: 'starting' });
    const init = await withRetry(id, ctrl, () =>
      api.post<InitRes>(`/api/shops/${shopId}/videos/uploads`, {
        fileName: it.fileName,
        sizeBytes: size,
        lastModified: it.lastModified,
        durationSec: inr.meta?.durationSec ?? null,
        width: inr.meta?.width ?? null,
        height: inr.meta?.height ?? null,
        mime: inr.file.type || undefined,
        folderId: it.folderId,
      }),
    );
    if (ctrl.signal.aborted) return;
    const relinked = Boolean(init.relinked);
    patch(id, { videoId: init.videoId, resumed: init.resumed, relinked, uploaded: init.uploadedBytes, resumedFrom: init.uploadedBytes, phase: 'uploading' });
    invalidate(shopId, relinked);
    if (relinked) toast.info(`Đã nhận ra file gốc của video cũ: ${it.fileName}`, { description: 'File sẽ được gắn lại vào video nhập từ hệ thống cũ, các mẫu phát dùng video này sẽ hợp lệ trở lại khi tải xong.' });
    else if (init.resumed && init.uploadedBytes > 0) toast.info(`Tiếp tục tải ${it.fileName}`, { description: `Đã có sẵn ${fmtBytes(init.uploadedBytes)} / ${fmtBytes(size)} trên máy chủ.` });

    const chunkBytes = init.chunkBytes > 0 ? init.chunkBytes : LIMITS.uploadChunkBytes;
    let offset = init.uploadedBytes;
    while (offset < size) {
      if (ctrl.signal.aborted) return;
      const end = Math.min(size, offset + chunkBytes);
      const from = offset;
      const blob = inr.file.slice(from, end);
      const t0 = performance.now();
      const r = await withRetry(id, ctrl, () => api.put<ChunkRes>(`/api/shops/${shopId}/videos/${init.videoId}/chunk?offset=${from}`, blob, { signal: ctrl.signal }));
      if (ctrl.signal.aborted) return;
      if (r.mismatch) {
        // Máy chủ đang giữ số byte khác (ví dụ đoạn trước đã ghi nhưng mất phản hồi) → tiếp tục từ đó
        offset = r.uploadedBytes;
        patch(id, { uploaded: offset });
        continue;
      }
      const dt = Math.max((performance.now() - t0) / 1000, 0.05);
      const inst = (end - from) / dt;
      const prev = get(id)?.speed ?? 0;
      offset = r.uploadedBytes;
      patch(id, { uploaded: offset, speed: prev ? prev * 0.6 + inst * 0.4 : inst });
      if (r.status === 'failed') {
        patch(id, { phase: 'failed', failReason: r.failReason ?? null, speed: 0, finishedAt: Date.now() });
        invalidate(shopId, relinked);
        toast.error(`Video không hợp lệ: ${it.fileName}`, { description: videoFailText(r.failReason) ?? undefined });
        return;
      }
      if (r.status === 'ready') {
        patch(id, { phase: 'done', speed: 0, finishedAt: Date.now() });
        invalidate(shopId, true);
        if (relinked) toast.success(`Đã gắn lại file gốc: ${it.fileName}`, { description: 'Video cũ đã sẵn sàng, mẫu phát liên quan dùng được trở lại.' });
        return;
      }
    }
    // Hết vòng lặp mà máy chủ chưa xác nhận hoàn tất
    patch(id, { phase: 'error', error: 'Máy chủ chưa xác nhận hoàn tất. Làm mới thư viện để xem trạng thái.', speed: 0 });
    invalidate(shopId);
  } catch (e) {
    if (ctrl.signal.aborted || isAbort(e)) return;
    patch(id, { phase: 'error', error: friendlyError(e), retryIn: null, speed: 0 });
    invalidate(shopId);
  } finally {
    if (inr.ctrl === ctrl) inr.ctrl = null;
    pump();
  }
}

function ensurePanel() {
  void import('./UploadPanel').then((m) => m.ensureUploadPanel());
}

// ───────────── API công khai ─────────────
export interface EnqueueOptions {
  shopId: number;
  shopName?: string | null;
  folderId?: number | null;
}

/** Kiểm tra nhanh trước khi tải (trả về lý do từ chối, hoặc null) */
export function precheckFile(f: File): string | null {
  if (!VIDEO_EXT_RE.test(f.name)) return 'Định dạng không hỗ trợ (dùng MP4, MOV, MKV, WEBM, FLV, TS)';
  if (f.size === 0) return 'File rỗng (0 byte)';
  if (f.size > MAX_VIDEO_BYTES) return 'File vượt quá 4 GB';
  return null;
}

/** Thêm file vào hàng đợi. Chọn lại đúng file đang tải dở → tiếp tục. Trả về số file được nhận. */
export function enqueueUploads(files: File[], opts: EnqueueOptions): number {
  let accepted = 0;
  const rejected: string[] = [];
  for (const f of files) {
    const why = precheckFile(f);
    if (why) {
      rejected.push(`${f.name}: ${why}`);
      continue;
    }
    const same = items.find((i) => i.shopId === opts.shopId && i.fileName === f.name && i.size === f.size && i.lastModified === f.lastModified);
    if (same && isActivePhase(same.phase)) {
      toast.info(`${f.name} đang được tải lên`);
      continue;
    }
    if (same && same.phase !== 'done') {
      // Tạm dừng / lỗi / đã hủy → dùng lại mục cũ, tiếp tục từ chỗ dở
      const inr = internals.get(same.id);
      internals.set(same.id, { file: f, ctrl: null, meta: inr?.meta ?? null });
      patch(same.id, { phase: 'queued', error: null, failReason: null, folderId: opts.folderId ?? same.folderId, finishedAt: null });
      accepted++;
      continue;
    }
    if (same) {
      items = items.filter((i) => i.id !== same.id);
      internals.delete(same.id);
    }
    const id = `u${Date.now().toString(36)}${(seq++).toString(36)}`;
    internals.set(id, { file: f, ctrl: null, meta: null });
    items = [
      ...items,
      {
        id,
        shopId: opts.shopId,
        shopName: opts.shopName ?? null,
        fileName: f.name,
        size: f.size,
        lastModified: f.lastModified,
        folderId: opts.folderId ?? null,
        phase: 'queued',
        uploaded: 0,
        speed: 0,
        videoId: null,
        resumed: false,
        resumedFrom: 0,
        relinked: false,
        error: null,
        failReason: null,
        retryIn: null,
        addedAt: Date.now(),
        finishedAt: null,
      },
    ];
    accepted++;
  }
  if (rejected.length) toast.error(`${rejected.length} file không được nhận`, { description: rejected.slice(0, 4).join('\n') + (rejected.length > 4 ? '\n…' : '') });
  if (accepted) {
    emit();
    ensurePanel();
    pump();
  }
  return accepted;
}

/** Tạm dừng: giữ phần đã tải trên máy chủ để tiếp tục sau */
export function pauseUpload(id: string) {
  const it = get(id);
  if (!it || !isActivePhase(it.phase)) return;
  internals.get(id)?.ctrl?.abort();
  patch(id, { phase: 'paused', speed: 0, retryIn: null });
  pump();
}

export function resumeUpload(id: string) {
  const it = get(id);
  if (!it || !internals.has(id) || isActivePhase(it.phase) || it.phase === 'done') return;
  patch(id, { phase: 'queued', error: null, failReason: null, finishedAt: null });
  pump();
}

/**
 * Hủy tải lên. Lần tải mới (tạo trong phiên này) sẽ bị xóa trên máy chủ;
 * lần tải tiếp tục / gắn lại video cũ chỉ dừng lại để không mất video gốc.
 */
export function cancelUpload(id: string) {
  const it = get(id);
  if (!it || it.phase === 'done') return;
  internals.get(id)?.ctrl?.abort();
  patch(id, { phase: 'cancelled', speed: 0, retryIn: null, finishedAt: Date.now() });
  if (it.videoId && !it.resumed && !it.relinked) {
    void api
      .del(`/api/shops/${it.shopId}/videos/${it.videoId}`)
      .catch(() => undefined)
      .finally(() => invalidate(it.shopId));
  } else invalidate(it.shopId);
  pump();
}

export function dismissUpload(id: string) {
  const it = get(id);
  if (!it || isActivePhase(it.phase)) return;
  items = items.filter((i) => i.id !== id);
  internals.delete(id);
  emit();
}

/** Ẩn các mục đã xong / đã hủy */
export function clearFinishedUploads() {
  const keep = items.filter((i) => i.phase !== 'done' && i.phase !== 'cancelled');
  for (const i of items) if (!keep.includes(i)) internals.delete(i.id);
  items = keep;
  emit();
}

/** Còn file nào đang tải không */
export function hasActiveUploads() {
  return items.some((i) => isActivePhase(i.phase));
}
