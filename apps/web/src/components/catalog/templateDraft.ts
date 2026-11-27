import { LIMITS } from '@mexo/shared';
import { fmtClock } from '@/lib/format';
import type { Video } from '@/lib/types';
import { videoFailText } from './labels';

// ───────────── Kiểu dữ liệu ─────────────
export type ReplyMode = 'inherit' | 'on' | 'off';

export interface VideoRef {
  id: number;
  name: string;
  durationSec: number | null;
  status: string;
  sizeBytes: number;
  failReason?: string | null;
}

export interface PinProduct {
  id: number;
  itemId: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  stock: number | null;
  removed: boolean;
}

/** Dữ liệu GET /api/shops/:id/templates/:tid */
export interface TemplateFull {
  template: {
    id: number;
    number: number;
    name: string;
    note: string;
    liveTitle: string | null;
    liveDescription: string | null;
    coverKey: string | null;
    loop: boolean;
    expectedDurationMin: number | null;
    replyMode: ReplyMode;
    legacyNeedsReview: boolean;
    updatedAt: string;
  };
  items: { id: number; position: number; videoId: number; video: VideoRef | null; pins: { productId: number; atSec: number; product: PinProduct | null }[] }[];
  issues: { position: number | null; code: string; message: string }[];
  durationSec: number;
  productCount: number;
}

export interface DraftPin {
  key: string;
  productId: number;
  /** Văn bản người dùng nhập: "75", "1:15", "0:01:15" */
  at: string;
  product: PinProduct | null;
}

export interface DraftItem {
  key: string;
  videoId: number;
  video: VideoRef | null;
  pins: DraftPin[];
}

export interface Draft {
  name: string;
  note: string;
  liveTitle: string;
  liveDescription: string;
  coverKey: string | null;
  loop: boolean;
  expectedDurationMin: string;
  replyMode: ReplyMode;
  items: DraftItem[];
}

export const MAX_PINS = 50;
export const NAME_MAX = 100;
export const NOTE_MAX = 1000;
export const LIVE_TITLE_MAX = 200;
export const LIVE_DESC_MAX = 1000;

let seq = 0;
export const newKey = () => `k${++seq}`;

// ───────────── Chuyển đổi ─────────────
export function emptyDraft(): Draft {
  return { name: '', note: '', liveTitle: '', liveDescription: '', coverKey: null, loop: true, expectedDurationMin: '', replyMode: 'inherit', items: [] };
}

export function fmtAt(sec: number): string {
  return Number.isInteger(sec) ? String(sec) : String(Math.round(sec * 10) / 10);
}

export function draftFromFull(full: TemplateFull): Draft {
  const t = full.template;
  return {
    name: t.name,
    note: t.note ?? '',
    liveTitle: t.liveTitle ?? '',
    liveDescription: t.liveDescription ?? '',
    coverKey: t.coverKey,
    loop: t.loop,
    expectedDurationMin: t.expectedDurationMin ? String(t.expectedDurationMin) : '',
    replyMode: t.replyMode,
    items: full.items.map((it) => ({
      key: newKey(),
      videoId: it.videoId,
      video: it.video,
      pins: it.pins.map((p) => ({ key: newKey(), productId: p.productId, at: fmtAt(p.atSec), product: p.product })),
    })),
  };
}

export function videoRefOf(v: Video): VideoRef {
  return { id: v.id, name: v.name, durationSec: v.durationSec, status: v.status, sizeBytes: v.sizeBytes, failReason: v.failReason };
}

/** "75" → 75, "1:15" → 75, "1:02:03" → 3723; rỗng → 0; sai → NaN */
export function parseAt(s: string): number {
  const t = s.trim().replace(',', '.');
  if (!t) return 0;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  let m = /^(\d+):([0-5]?\d)(\.\d+)?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0);
  m = /^(\d+):([0-5]?\d):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return NaN;
}

export function toPayload(d: Draft) {
  const exp = d.expectedDurationMin.trim() ? Math.round(Number(d.expectedDurationMin)) : null;
  return {
    name: d.name.trim(),
    note: d.note,
    liveTitle: d.liveTitle.trim() || null,
    liveDescription: d.liveDescription.trim() || null,
    coverKey: d.coverKey,
    loop: d.loop,
    expectedDurationMin: exp && Number.isFinite(exp) ? exp : null,
    replyMode: d.replyMode,
    items: d.items.map((i) => ({ videoId: i.videoId, pins: i.pins.map((p) => ({ productId: p.productId, atSec: parseAt(p.at) })) })),
  };
}

export const serialize = (d: Draft) => JSON.stringify(toPayload(d));

/** Sắp xếp mốc ghim tăng dần (mốc sai để cuối) */
export function sortPins(pins: DraftPin[]): DraftPin[] {
  return [...pins].sort((a, b) => {
    const x = parseAt(a.at);
    const y = parseAt(b.at);
    if (Number.isNaN(x)) return 1;
    if (Number.isNaN(y)) return -1;
    return x - y;
  });
}

/** Mốc gợi ý cho sản phẩm ghim mới: 0 nếu chưa có; sau đó lấy giữa mốc cuối và hết video */
export function suggestAt(pins: DraftPin[], duration: number | null): number {
  const ats = pins.map((p) => parseAt(p.at)).filter((x) => Number.isFinite(x));
  if (!ats.length) return 0;
  const last = Math.max(...ats);
  let next = duration && duration > last + 1 ? Math.floor((last + duration) / 2) : last + 30;
  if (duration && next >= duration) next = Math.max(0, Math.floor(duration) - 1);
  while (ats.includes(next)) next++;
  return next;
}

// ───────────── Kiểm tra ─────────────
export type Level = 'error' | 'warn' | 'info';
export interface Issue {
  level: Level;
  text: string;
}
export interface ItemAnalysis {
  video: VideoRef | null;
  issues: Issue[];
  pins: Map<string, Issue[]>;
}
export interface Analysis {
  items: Map<string, ItemAnalysis>;
  global: Issue[];
  errors: number;
  warnings: number;
  totalSec: number;
  productCount: number;
  unknownDuration: number;
}

/**
 * Kiểm tra bản nháp. Lỗi (error) chặn lưu; cảnh báo (warn) vẫn cho lưu.
 * lib = thư viện video hiện tại (để biết trạng thái mới nhất); null khi chưa tải.
 */
export function analyze(d: Draft, lib: Map<number, Video> | null): Analysis {
  const items = new Map<string, ItemAnalysis>();
  const global: Issue[] = [];
  let errors = 0;
  let warnings = 0;
  let totalSec = 0;
  let unknownDuration = 0;
  const products = new Set<number>();
  const push = (arr: Issue[], level: Level, text: string) => {
    arr.push({ level, text });
    if (level === 'error') errors++;
    else if (level === 'warn') warnings++;
  };

  if (!d.items.length) push(global, 'warn', 'Mẫu chưa có video nào.');
  if (d.items.length > LIMITS.templateVideosMax) push(global, 'error', `Mẫu tối đa ${LIMITS.templateVideosMax} video (hiện ${d.items.length}).`);

  for (const it of d.items) {
    const lv = lib?.get(it.videoId);
    const video = lv ? videoRefOf(lv) : lib ? null : it.video;
    const issues: Issue[] = [];
    const pinIssues = new Map<string, Issue[]>();
    const dur = video?.durationSec ?? null;
    if (dur) totalSec += dur;
    else if (video) unknownDuration++;

    if (!video) push(issues, 'warn', 'Video đã bị xóa khỏi thư viện — hãy đổi video khác hoặc xóa dòng này.');
    else if (video.status !== 'ready') {
      const why =
        video.status === 'missing_file'
          ? 'Video chưa có file (nhập từ hệ thống cũ) — tải lại đúng file gốc trong Thư viện video.'
          : video.status === 'failed'
            ? `Video lỗi: ${videoFailText(video.failReason) ?? 'không dùng được'}`
            : video.status === 'uploading'
              ? 'Video đang tải lên hoặc tải dở.'
              : 'Video đang được xử lý.';
      push(issues, 'warn', `${why} Video chưa sẵn sàng sẽ bị bỏ qua khi phát.`);
    }
    if (!it.pins.length) push(issues, 'warn', 'Chưa gán sản phẩm ghim — khi phát video này sẽ không có sản phẩm nào được ghim.');
    if (it.pins.length > MAX_PINS) push(issues, 'error', `Mỗi video tối đa ${MAX_PINS} sản phẩm ghim.`);
    if (video && !dur && it.pins.length > 1) push(issues, 'info', 'Chưa rõ thời lượng video nên chưa kiểm tra được các mốc ghim.');

    const seen = new Map<number, number>();
    for (const p of it.pins) {
      const arr: Issue[] = [];
      const at = parseAt(p.at);
      if (Number.isNaN(at) || at < 0) push(arr, 'error', 'Mốc thời gian không hợp lệ (nhập số giây, hoặc phút:giây như 1:30).');
      else {
        if (dur && at >= dur) push(arr, 'error', `Mốc phải nhỏ hơn thời lượng video (${fmtClock(dur)}).`);
        seen.set(at, (seen.get(at) ?? 0) + 1);
      }
      products.add(p.productId);
      if (!p.product) push(arr, 'warn', 'Sản phẩm không còn trong danh mục.');
      else if (p.product.removed) push(arr, 'warn', 'Sản phẩm đã bị gỡ khỏi Shopee — sẽ không được ghim.');
      else if ((p.product.stock ?? 0) <= 0) push(arr, 'warn', 'Sản phẩm đã hết hàng.');
      pinIssues.set(p.key, arr);
    }
    for (const p of it.pins) {
      const at = parseAt(p.at);
      if (!Number.isNaN(at) && (seen.get(at) ?? 0) > 1) push(pinIssues.get(p.key)!, 'error', 'Trùng mốc thời gian với sản phẩm khác trong cùng video.');
    }
    items.set(it.key, { video, issues, pins: pinIssues });
  }

  const exp = Number(d.expectedDurationMin);
  if (d.expectedDurationMin.trim() && (!Number.isFinite(exp) || exp < 1 || exp > 24 * 60)) push(global, 'error', 'Thời lượng dự kiến phải từ 1 đến 1440 phút.');
  else if (exp > 0 && !d.loop && d.items.length && totalSec > 0 && totalSec < exp * 60)
    push(global, 'warn', `Danh sách dài ${fmtClock(totalSec)}, ngắn hơn thời lượng dự kiến ${exp} phút — bật “Phát lặp danh sách” để không hết video giữa chừng.`);

  return { items, global, errors, warnings, totalSec, productCount: products.size, unknownDuration };
}
