import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { OPEN_SESSION_STATES, type SessionState } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, liveSessions, products, scheduleRuns, sessionEvents, sessionMetricSamples, shops, streamJobs, type PlaylistEntry } from '../db/schema.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { AppError, err } from '../lib/errors.js';
import { shopServiceState } from '../auth/auth.js';
import { raiseAlert, resolveAlert } from './alerts.js';
import { audit, SYSTEM_ACTOR, type ActorRef } from './audit.js';
import { publish } from './events.js';
import { getSetting, isFrozen } from './settings.js';
import * as shopee from './shopee/index.js';
import { ShopeeError } from './shopee/index.js';
import { readFile } from './storage.js';
import { ACTIVE_JOB_STATES, pickServer } from './streamers.js';
import { pool } from '../lib/pool.js';
import { buildPlaylist, desiredPin, loadTemplateFull } from './templates.js';

type ShopRow = typeof shops.$inferSelect;
export type SessionRow = typeof liveSessions.$inferSelect;
type JobRow = typeof streamJobs.$inferSelect;

const RUNNING_STATES: SessionState[] = ['preparing', 'connecting', 'live', 'disconnected'];

// ───────────── Tiện ích ─────────────

export async function logEvent(sessionId: number, level: 'info' | 'warn' | 'error', code: string, message: string, data?: unknown): Promise<void> {
  await db.insert(sessionEvents).values({ sessionId, level, code, message, data: data ?? null });
}

async function patchSession(id: number, patch: Partial<typeof liveSessions.$inferInsert>): Promise<void> {
  await db.update(liveSessions).set({ ...patch, updatedAt: new Date() }).where(eq(liveSessions.id, id));
}

function notify(s: { id: number; shopId: number }) {
  publish({ type: 'session', shopId: s.shopId, sessionId: s.id });
}

export function sessionDto(s: SessionRow) {
  const { pushUrlEnc, ...rest } = s;
  return { ...rest, hasPushUrl: Boolean(pushUrlEnc) };
}

export async function getOpenSession(shopId: number): Promise<SessionRow | null> {
  const [s] = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.shopId, shopId), ne(liveSessions.state, 'ended')))
    .orderBy(desc(liveSessions.id))
    .limit(1);
  return s ?? null;
}

export async function activeJob(sessionId: number): Promise<JobRow | null> {
  const [j] = await db
    .select()
    .from(streamJobs)
    .where(and(eq(streamJobs.sessionId, sessionId), eq(streamJobs.desired, 'run')))
    .orderBy(desc(streamJobs.id))
    .limit(1);
  return j ?? null;
}

function shopeeErrorToApp(e: unknown, fallback: string): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ShopeeError) {
    const map: Record<string, string> = {
      auth: 'Shop cần cấp quyền lại trên Shopee',
      permission: 'Shopee từ chối quyền (kiểm tra quyền Livestream của ứng dụng)',
      rate_limit: 'Shopee đang giới hạn tần suất, vui lòng thử lại sau ít giây',
      server: 'Shopee đang lỗi, vui lòng thử lại sau',
      timeout: 'Shopee không phản hồi',
      network: 'Không kết nối được tới Shopee',
      session_invalid: 'Phiên không còn tồn tại trên Shopee',
      session_ended: 'Phiên đã kết thúc trên Shopee',
      circuit_open: e.message,
      not_configured: e.message,
    };
    return new AppError(`shopee_${e.kind}`, `${fallback}: ${map[e.kind] ?? e.message}`, 502, { shopeeCode: e.code, requestId: e.requestId, ref: e.ref, raw: e.message });
  }
  return new AppError('internal', fallback, 500);
}

// ───────────── Tạo phiên ─────────────

export interface CreateSessionInput {
  title: string;
  description?: string;
  coverKey: string;
  templateId?: number | null;
  origin?: 'manual' | 'schedule';
  scheduleRunId?: number | null;
}

async function ownerConcurrentCheck(shop: ShopRow): Promise<void> {
  if (!shop.ownerId) return;
  const [owner] = await db.select().from(accounts).where(eq(accounts.id, shop.ownerId));
  if (!owner?.concurrentLimit) return;
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(liveSessions)
    .innerJoin(shops, eq(shops.id, liveSessions.shopId))
    .where(and(eq(shops.ownerId, owner.id), inArray(liveSessions.state, RUNNING_STATES)));
  if (Number(r?.n ?? 0) >= owner.concurrentLimit)
    throw err.conflict('concurrent_limit', `Tài khoản đã đạt giới hạn ${owner.concurrentLimit} phiên livestream đồng thời`);
}

export async function createLiveSession(actor: ActorRef, shop: ShopRow, input: CreateSessionInput): Promise<SessionRow> {
  if (await isFrozen()) throw err.locked('frozen', 'Hệ thống đang đóng băng, tạm thời không tạo phiên mới');
  const svc = shopServiceState(shop);
  if (svc.state === 'expired') throw err.locked('shop_expired', 'Shop đã hết hạn dùng');
  if (svc.state === 'suspended') throw err.locked('shop_suspended', 'Shop đã ngưng dịch vụ');
  if (shop.connection !== 'ok' && shop.connection !== 'expiring') throw err.conflict('shop_disconnected', 'Shop chưa kết nối Shopee hoặc cần cấp quyền lại');
  const open = await getOpenSession(shop.id);
  if (open) throw err.conflict('session_open', 'Shop đang có một phiên chưa kết thúc. Mỗi shop chỉ có 1 phiên mở tại một thời điểm.', { sessionId: open.id });
  await ownerConcurrentCheck(shop);

  let coverUrl: string;
  try {
    const data = await readFile(input.coverKey);
    const mime = input.coverKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
    coverUrl = await shopee.uploadImage(shop, data, input.coverKey.split('/').pop()!, mime);
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') throw err.badRequest('cover_missing', 'Không tìm thấy ảnh bìa');
    throw shopeeErrorToApp(e, 'Không tải được ảnh bìa lên Shopee');
  }

  let shopeeSessionId: number;
  try {
    shopeeSessionId = await shopee.createSession(shop, { title: input.title, description: input.description ?? '', coverUrl });
  } catch (e) {
    throw shopeeErrorToApp(e, 'Shopee không tạo được phiên');
  }

  let detail: Awaited<ReturnType<typeof shopee.getSessionDetail>> | null = null;
  try {
    detail = await shopee.getSessionDetail(shop, shopeeSessionId);
  } catch {
    /* lấy lại sau khi đối soát */
  }

  let tplName: string | null = null;
  if (input.templateId) {
    const full = await loadTemplateFull(input.templateId);
    tplName = full?.template.name ?? null;
  }

  const [row] = await db
    .insert(liveSessions)
    .values({
      shopId: shop.id,
      shopeeSessionId,
      origin: input.origin ?? 'manual',
      title: input.title,
      description: input.description ?? '',
      coverKey: input.coverKey,
      coverUrl,
      templateId: input.templateId ?? null,
      templateName: tplName,
      scheduleRunId: input.scheduleRunId ?? null,
      createdBy: actor.id,
      createdByName: actor.name,
      state: 'not_started',
      shopeeStatus: detail?.status ?? 'not_started',
      shareUrl: detail?.shareUrl ?? `https://live.shopee.vn/share?from=live&session=${shopeeSessionId}`,
      pushUrlEnc: detail?.pushUrl ? encrypt(detail.pushUrl) : null,
      domainId: detail?.domainId ?? null,
      lastShopeeSyncAt: new Date(),
    })
    .returning();
  await logEvent(row!.id, 'info', 'created', `Đã tạo phiên trên Shopee (Session ID ${shopeeSessionId})`);
  await audit(actor, 'session_created', { shopId: shop.id, params: { sessionId: shopeeSessionId, title: input.title } });
  notify(row!);
  return row!;
}

export async function updateSessionInfo(actor: ActorRef, shop: ShopRow, s: SessionRow, input: { title: string; description: string; coverKey?: string | null }) {
  if (s.state !== 'not_started') throw err.conflict('session_started', 'Chỉ sửa được phiên chưa bắt đầu');
  const coverKey = input.coverKey || s.coverKey;
  if (!coverKey) throw err.badRequest('cover_required', 'Shopee yêu cầu gửi lại ảnh bìa khi sửa tiêu đề hoặc mô tả');
  try {
    const data = await readFile(coverKey);
    const coverUrl = await shopee.uploadImage(shop, data, coverKey.split('/').pop()!, coverKey.endsWith('.png') ? 'image/png' : 'image/jpeg');
    await shopee.updateSession(shop, s.shopeeSessionId!, { title: input.title, description: input.description, coverUrl });
    await patchSession(s.id, { title: input.title, description: input.description, coverKey, coverUrl });
  } catch (e) {
    throw shopeeErrorToApp(e, 'Không cập nhật được phiên');
  }
  await logEvent(s.id, 'info', 'updated', 'Đã sửa thông tin phiên');
  notify(s);
}

// ───────────── Kiểm tra trước khi phát ─────────────

export interface PreflightCheck {
  key: string;
  ok: boolean;
  label: string;
  detail?: string;
}

export async function preflight(shop: ShopRow, s: SessionRow, templateId: number, serverId?: number | null) {
  const checks: PreflightCheck[] = [];
  const job = await activeJob(s.id);
  checks.push({
    key: 'session',
    ok: s.state !== 'ended' && s.state !== 'ending' && !job,
    label: 'Phiên chưa kết thúc và không có việc phát khác',
    detail: job ? 'Phiên đang được một máy chủ phát' : s.state === 'ended' ? 'Phiên đã kết thúc' : undefined,
  });
  const svc = shopServiceState(shop);
  checks.push({ key: 'service', ok: svc.state === 'active' || svc.state === 'expiring', label: 'Shop còn hạn dùng', detail: svc.state === 'expired' ? 'Đã hết hạn' : undefined });
  checks.push({ key: 'connection', ok: shop.connection === 'ok' || shop.connection === 'expiring', label: 'Kết nối Shopee còn hiệu lực' });
  checks.push({ key: 'frozen', ok: !(await isFrozen()), label: 'Hệ thống không bị đóng băng' });

  const full = await loadTemplateFull(templateId);
  if (!full || full.template.shopId !== shop.id) {
    checks.push({ key: 'template', ok: false, label: 'Mẫu phát hợp lệ', detail: 'Không tìm thấy mẫu phát' });
    return { ok: false, checks, playlist: [] as PlaylistEntry[], missingInCart: [] as number[], server: null, full: null };
  }
  const vidIssues = full.issues.filter((i) => i.code === 'video_missing' || i.code === 'video_not_ready' || i.code === 'empty');
  checks.push({
    key: 'videos',
    ok: vidIssues.length === 0,
    label: `Mẫu có video và mọi video đã sẵn sàng (${full.items.length} video)`,
    detail: vidIssues.map((i) => i.message).join('; ') || undefined,
  });
  const pinIssues = full.issues.filter((i) => ['no_pin', 'product_missing', 'product_removed', 'product_out'].includes(i.code));
  checks.push({
    key: 'pins',
    ok: pinIssues.length === 0,
    label: 'Mọi video có sản phẩm ghim còn hàng, còn trong danh mục',
    detail: pinIssues.slice(0, 5).map((i) => i.message).join('; ') || undefined,
  });

  const server = await pickServer(serverId ?? null);
  checks.push({
    key: 'server',
    ok: Boolean(server),
    label: 'Máy chủ phát đang kết nối và còn luồng trống',
    detail: server ? `Sẽ dùng máy ${server.name}` : serverId ? 'Máy đã chọn không sẵn sàng hoặc đã đầy' : 'Không có máy chủ phát nào sẵn sàng',
  });

  const playlist = buildPlaylist(full);
  const needed = [...new Set(playlist.flatMap((p) => p.pins.map((x) => x.itemId)))];
  let missingInCart: number[] = [];
  let cartOk = true;
  let cartDetail: string | undefined;
  if (s.shopeeSessionId && (shop.connection === 'ok' || shop.connection === 'expiring')) {
    try {
      const cart = await shopee.getCartItems(shop, s.shopeeSessionId);
      missingInCart = needed.filter((id) => !cart.includes(id));
      cartOk = cart.length + missingInCart.length <= shop.cartLimit;
      cartDetail = `Giỏ hiện có ${cart.length}/${shop.cartLimit}, sẽ thêm ${missingInCart.length} sản phẩm ghim`;
    } catch (e) {
      cartOk = false;
      cartDetail = e instanceof Error ? `Không đọc được giỏ live: ${e.message}` : undefined;
    }
  }
  checks.push({ key: 'cart', ok: cartOk, label: 'Giỏ live còn đủ chỗ cho sản phẩm ghim', detail: cartDetail });
  return { ok: checks.every((c) => c.ok), checks, playlist, missingInCart, server, full };
}

// ───────────── Phát tự động ─────────────

export async function startAutoPlay(actor: ActorRef, shop: ShopRow, s: SessionRow, templateId: number, serverId?: number | null) {
  const pf = await preflight(shop, s, templateId, serverId);
  if (!pf.ok) throw err.conflict('preflight_failed', 'Chưa đạt kiểm tra trước khi phát', { checks: pf.checks });
  // Thêm sản phẩm ghim còn thiếu vào giỏ (theo lô)
  for (let i = 0; i < pf.missingInCart.length; i += 20) {
    try {
      await shopee.addItems(shop, s.shopeeSessionId!, pf.missingInCart.slice(i, i + 20));
    } catch (e) {
      throw shopeeErrorToApp(e, 'Không thêm được sản phẩm ghim vào giỏ live');
    }
  }
  // Lấy lại địa chỉ đẩy luồng mới nhất
  let pushUrl = decrypt(s.pushUrlEnc);
  try {
    const d = await shopee.getSessionDetail(shop, s.shopeeSessionId!);
    if (d.status === 'ended') {
      await markEnded(s, 'ended_on_shopee');
      throw err.conflict('session_ended', 'Phiên đã kết thúc trên Shopee');
    }
    if (d.pushUrl) pushUrl = d.pushUrl;
    await patchSession(s.id, { pushUrlEnc: pushUrl ? encrypt(pushUrl) : null, domainId: d.domainId, shareUrl: d.shareUrl ?? s.shareUrl, shopeeStatus: d.status });
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (!pushUrl) throw shopeeErrorToApp(e, 'Không lấy được thông tin đẩy luồng');
  }
  if (!pushUrl) throw err.conflict('no_push_url', 'Shopee chưa cấp địa chỉ đẩy luồng cho phiên này');

  const full = pf.full!;
  const [job] = await db
    .insert(streamJobs)
    .values({ sessionId: s.id, shopId: shop.id, serverId: pf.server!.id, desired: 'run', state: 'waiting_server', resumeIndex: 0 })
    .returning();
  const wasLive = s.state === 'live';
  await patchSession(s.id, {
    templateId,
    templateName: full.template.name,
    playlist: pf.playlist,
    loop: full.template.loop,
    serverId: pf.server!.id,
    streamState: 'waiting_server',
    state: wasLive ? 'live' : 'preparing',
    videoIndex: 0,
    videoPositionSec: 0,
    feedSince: null,
    feedLostAt: null,
    pinState: 'off',
    pinError: null,
    manualPinVideoIndex: null,
    lastError: null,
    replyState: shop.replyEnabled && full.template.replyMode !== 'off' ? 'ok' : full.template.replyMode === 'on' ? 'ok' : 'off',
  });
  await logEvent(s.id, 'info', 'stream_assigned', `Giao việc phát cho máy ${pf.server!.name} (${pf.playlist.length} video, ${full.template.loop ? 'lặp vòng' : 'phát 1 lượt'})`, { jobId: job!.id });
  await audit(actor, 'stream_started', { shopId: shop.id, params: { sessionId: s.shopeeSessionId, template: full.template.name, server: pf.server!.name } });
  notify(s);
  return job!;
}

export async function stopFeed(actor: ActorRef, s: SessionRow, reason = 'Dừng theo yêu cầu') {
  const job = await activeJob(s.id);
  if (!job) throw err.conflict('no_stream', 'Phiên không có việc phát nào đang chạy');
  await db.update(streamJobs).set({ desired: 'stop', stoppedAt: new Date() }).where(eq(streamJobs.id, job.id));
  await patchSession(s.id, { streamState: 'stopped', feedSince: null, pinState: 'off' });
  await logEvent(s.id, 'warn', 'stream_stopped', `Dừng đẩy hình: ${reason}`);
  await audit(actor, 'stream_stopped', { shopId: s.shopId, params: { sessionId: s.shopeeSessionId, reason } });
  notify(s);
}

export async function skipVideo(actor: ActorRef, s: SessionRow, index: number) {
  const job = await activeJob(s.id);
  if (!job) throw err.conflict('no_stream', 'Phiên không có việc phát nào đang chạy');
  const pl = s.playlist ?? [];
  if (index < 0 || index >= pl.length) throw err.badRequest('bad_index', 'Vị trí video không hợp lệ');
  const seq = (job.command?.seq ?? 0) + 1;
  await db.update(streamJobs).set({ command: { seq, type: 'skip', index } }).where(eq(streamJobs.id, job.id));
  await logEvent(s.id, 'info', 'skip', `Chuyển sang video ${index + 1}: ${pl[index]!.name}`);
  await audit(actor, 'stream_started', { shopId: s.shopId, params: { action: 'skip', index } });
  notify(s);
}

// ───────────── Kết thúc phiên ─────────────

async function stopJobs(sessionId: number) {
  await db
    .update(streamJobs)
    .set({ desired: 'stop', stoppedAt: new Date() })
    .where(and(eq(streamJobs.sessionId, sessionId), eq(streamJobs.desired, 'run')));
}

async function captureFinalMetrics(shop: ShopRow, s: SessionRow) {
  if (!s.shopeeSessionId) return;
  try {
    const m = await shopee.getSessionMetric(shop, s.shopeeSessionId);
    const prev = s.metrics ?? {};
    await patchSession(s.id, { metrics: { ...prev, ...m, peakViewers: Math.max(prev.peakViewers ?? 0, m.peakViewers, m.viewers) } });
  } catch {
    /* bỏ qua */
  }
}

export async function markEnded(s: SessionRow, reason: string, endedAt?: Date | null) {
  await stopJobs(s.id);
  await db
    .update(liveSessions)
    .set({ state: 'ended', shopeeStatus: 'ended', streamState: 'stopped', endedAt: endedAt ?? new Date(), endedReason: reason, stuck: false, pinState: 'off', replyState: 'off', updatedAt: new Date() })
    .where(and(eq(liveSessions.id, s.id), ne(liveSessions.state, 'ended')));
  await logEvent(s.id, 'info', 'ended', `Phiên đã kết thúc (${reason})`);
  await resolveAlert(`session_stuck:${s.id}`);
  await resolveAlert(`feed_lost:${s.id}`);
  await resolveAlert(`pin_failed:${s.id}`);
  // Lịch đang chạy phiên này → đánh dấu xong
  if (s.scheduleRunId) {
    await db
      .update(scheduleRuns)
      .set({ status: 'done', endedAt: new Date(), issue: reason === 'schedule_ended' ? null : 'ended_manually' })
      .where(and(eq(scheduleRuns.id, s.scheduleRunId), inArray(scheduleRuns.status, ['live', 'ending', 'starting'])));
  }
  notify(s);
}

export async function endLiveSession(actor: ActorRef, shop: ShopRow, s: SessionRow, reason = 'manual'): Promise<'ended' | 'already_ended'> {
  if (s.state === 'ended') return 'already_ended';
  if (s.origin === 'external') throw err.conflict('external_session', 'Phiên mở từ app Shopee hoặc Shopee Live PC, MEXO không điều khiển được');
  if (s.endRequestedAt && Date.now() - s.endRequestedAt.getTime() < 15000 && s.state === 'ending')
    throw err.conflict('end_pending', 'Đã gửi lệnh kết thúc, đang chờ Shopee xác nhận. Vui lòng đợi ít giây.');
  const prevState = s.state;
  await patchSession(s.id, { state: 'ending', endRequestedAt: new Date() });
  notify(s);
  if (!s.shopeeSessionId) {
    await markEnded(s, reason);
    return 'ended';
  }
  try {
    // Phiên đã kết thúc ở nơi khác thì không gửi lệnh
    const d = await shopee.getSessionDetail(shop, s.shopeeSessionId).catch(() => null);
    if (d?.status === 'ended') {
      await markEnded(s, 'ended_on_shopee', d.endTime);
      return 'already_ended';
    }
    await shopee.endSession(shop, s.shopeeSessionId);
  } catch (e) {
    if (e instanceof ShopeeError && (e.kind === 'session_ended' || e.kind === 'session_invalid')) {
      await markEnded(s, 'ended_on_shopee');
      return 'already_ended';
    }
    await patchSession(s.id, { state: prevState, lastError: e instanceof Error ? e.message : String(e) });
    await logEvent(s.id, 'error', 'end_failed', `Shopee chưa cho kết thúc phiên: ${e instanceof Error ? e.message : e}`);
    notify(s);
    throw shopeeErrorToApp(e, 'Không kết thúc được phiên');
  }
  await captureFinalMetrics(shop, s);
  await markEnded(s, reason);
  await audit(actor, 'session_ended', { shopId: shop.id, params: { sessionId: s.shopeeSessionId, reason } });
  return 'ended';
}

// ───────────── Đối soát & chống treo ─────────────

const syncing = new Set<number>();

/** Đối soát 1 phiên với Shopee. Trả về trạng thái Shopee hoặc null nếu không xác minh được */
export async function reconcileSession(s: SessionRow, opts: { withMetrics?: boolean } = {}): Promise<string | null> {
  if (!s.shopeeSessionId || syncing.has(s.id)) return null;
  syncing.add(s.id);
  try {
    const [shop] = await db.select().from(shops).where(eq(shops.id, s.shopId));
    if (!shop || !(shop.connection === 'ok' || shop.connection === 'expiring')) return null;
    let d: Awaited<ReturnType<typeof shopee.getSessionDetail>>;
    try {
      d = await shopee.getSessionDetail(shop, s.shopeeSessionId);
    } catch (e) {
      const fails = s.syncFailures + 1;
      if (e instanceof ShopeeError && e.kind === 'session_invalid' && fails >= 2) {
        await markEnded(s, 'not_found_on_shopee');
        return 'ended';
      }
      await patchSession(s.id, { syncFailures: fails, lastError: e instanceof Error ? e.message : String(e), ...(fails >= 5 && s.state !== 'ended' ? { state: 'sync_error' } : {}) });
      if (fails === 5) await logEvent(s.id, 'error', 'sync_error', 'Không đồng bộ được trạng thái với Shopee (5 lần liên tiếp)');
      return null;
    }
    const patch: Partial<typeof liveSessions.$inferInsert> = {
      shopeeStatus: d.status,
      lastShopeeSyncAt: new Date(),
      syncFailures: 0,
      stuck: false,
      shareUrl: d.shareUrl ?? s.shareUrl,
    };
    if (d.status === 'ended') {
      await patchSession(s.id, patch);
      if (s.state !== 'ended') await markEnded({ ...s }, s.state === 'ending' ? 'manual' : 'ended_on_shopee', d.endTime);
      return 'ended';
    }
    if (d.status === 'ongoing') {
      if (['not_started', 'unknown', 'sync_error', 'connecting', 'preparing'].includes(s.state)) {
        patch.state = 'live';
        patch.startedAt = s.startedAt ?? d.startTime ?? new Date();
        if (s.state === 'unknown' || s.state === 'sync_error') {
          await logEvent(s.id, 'info', 'verified', 'Đã xác minh: phiên đang live trên Shopee');
          patch.lastError = null;
        }
      }
    }
    if (d.status === 'not_started' && (s.state === 'unknown' || s.state === 'sync_error')) patch.state = 'not_started';
    // Kiểm tra kết quả ghim từ Shopee (khoảng 1 phút/lần với phiên đang phát tự động)
    if (d.status === 'ongoing' && s.state === 'live' && s.pinnedItemId && (!s.pinVerifiedAt || Date.now() - s.pinVerifiedAt.getTime() > 60000)) {
      const shown = await shopee.getShowItem(shop, s.shopeeSessionId).catch(() => undefined);
      if (shown !== undefined) {
        patch.pinVerifiedAt = new Date();
        if (shown !== s.pinnedItemId) {
          patch.pinState = 'attn';
          patch.pinError = shown ? `Shopee đang ghim sản phẩm khác (${shown})` : 'Shopee không còn ghim sản phẩm nào';
          patch.pinnedItemId = shown;
          await logEvent(s.id, 'warn', 'pin_mismatch', patch.pinError);
        }
      }
    }
    if (opts.withMetrics && d.status === 'ongoing') {
      try {
        const m = await shopee.getSessionMetric(shop, s.shopeeSessionId);
        const prev = s.metrics ?? {};
        patch.metrics = { ...prev, ...m, peakViewers: Math.max(prev.peakViewers ?? 0, m.peakViewers, m.viewers) };
        await db.insert(sessionMetricSamples).values({ sessionId: s.id, viewers: m.viewers, likes: m.likes, comments: m.comments, orders: m.orders });
      } catch {
        /* chỉ số không bắt buộc */
      }
    }
    await patchSession(s.id, patch);
    await resolveAlert(`session_stuck:${s.id}`);
    notify(s);
    return d.status;
  } finally {
    syncing.delete(s.id);
  }
}

export async function releaseLock(actor: ActorRef & { role?: string }, s: SessionRow, force: boolean, note: string) {
  const result = await reconcileSession(s);
  if (result === 'ended') {
    await audit(actor, 'session_lock_released', { shopId: s.shopId, params: { sessionId: s.shopeeSessionId, verified: true } });
    return { released: true, verified: true };
  }
  if (result === 'ongoing') throw err.conflict('still_live', 'Shopee xác nhận phiên vẫn đang live — hãy kết thúc phiên thay vì giải phóng khóa');
  if (!force) throw err.conflict('unverified', 'Chưa xác minh được phiên đã kết thúc trên Shopee. Chỉ quản trị hệ thống mới được giải phóng bắt buộc.');
  await markEnded(s, 'lock_released');
  await logEvent(s.id, 'warn', 'lock_released', `Giải phóng khóa phiên bắt buộc: ${note}`);
  await audit(actor, 'session_lock_released', { shopId: s.shopId, params: { sessionId: s.shopeeSessionId, verified: false, note } });
  return { released: true, verified: false };
}

// ───────────── Ghim & giỏ live ─────────────

const pinInflight = new Set<number>();
const pinFailAt = new Map<string, number>();

async function doPin(shop: ShopRow, s: SessionRow, itemId: number, manual: boolean): Promise<void> {
  if (pinInflight.has(s.id)) return;
  pinInflight.add(s.id);
  try {
    try {
      await shopee.updateShowItem(shop, s.shopeeSessionId!, itemId);
    } catch (e) {
      // Sản phẩm không còn trong giỏ live (bị gỡ ở nơi khác) → tự thêm lại rồi ghim lại một lần
      if (e instanceof ShopeeError && /item list|not in (the )?(session|cart)/i.test(e.message)) {
        await shopee.addItems(shop, s.shopeeSessionId!, [itemId]);
        await logEvent(s.id, 'warn', 'cart_readd', `Sản phẩm ${itemId} không còn trong giỏ — đã tự thêm lại`);
        await shopee.updateShowItem(shop, s.shopeeSessionId!, itemId);
      } else throw e;
    }
    await patchSession(s.id, { pinnedItemId: itemId, pinState: 'ok', pinError: null, pinVerifiedAt: new Date(), ...(manual ? { manualPinVideoIndex: s.videoIndex ?? -1 } : {}) });
    await resolveAlert(`pin_failed:${s.id}`);
    const [p] = await db.select({ name: products.name }).from(products).where(and(eq(products.shopId, shop.id), eq(products.itemId, itemId)));
    await logEvent(s.id, 'info', manual ? 'pin_manual' : 'pin', `Ghim: ${p?.name ?? itemId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const outOfStock = /stock/i.test(msg);
    pinFailAt.set(`${s.id}:${itemId}`, Date.now());
    await patchSession(s.id, { pinState: 'attn', pinError: outOfStock ? 'Sản phẩm hết hàng, không ghim được' : msg.slice(0, 200) });
    await logEvent(s.id, 'error', 'pin_failed', `Ghim lỗi (${itemId}): ${msg}`);
    await raiseAlert({ key: `pin_failed:${s.id}`, type: 'pin_failed', severity: 'warning', shopId: shop.id, sessionId: s.id, message: `${shop.alias || shop.shopeeName}: ${outOfStock ? 'ghim lỗi do hết hàng' : msg}` });
    if (manual) throw shopeeErrorToApp(e, 'Không ghim được sản phẩm');
  } finally {
    pinInflight.delete(s.id);
    notify(s);
  }
}

export async function manualPin(actor: ActorRef, shop: ShopRow, s: SessionRow, itemId: number) {
  if (s.state !== 'live') throw err.conflict('not_live', 'Chỉ ghim được khi phiên đang live');
  if (await isFrozen()) throw err.locked('frozen', 'Hệ thống đang đóng băng');
  const [p] = await db.select().from(products).where(and(eq(products.shopId, shop.id), eq(products.itemId, itemId)));
  if (p && (p.stock ?? 0) <= 0) throw err.conflict('out_of_stock', 'Không ghim được sản phẩm hết hàng');
  await doPin(shop, s, itemId, true);
  await audit(actor, 'pin_changed', { shopId: shop.id, params: { sessionId: s.shopeeSessionId, itemId } });
}

export async function cartView(shop: ShopRow, s: SessionRow) {
  if (!s.shopeeSessionId) return { items: [], count: 0, limit: shop.cartLimit, pinned: null };
  const ids = await shopee.getCartItems(shop, s.shopeeSessionId);
  const rows = ids.length ? await db.select().from(products).where(and(eq(products.shopId, shop.id), inArray(products.itemId, ids))) : [];
  const map = new Map(rows.map((r) => [r.itemId, r]));
  let pinned: number | null = s.pinnedItemId;
  if (s.state === 'live') pinned = await shopee.getShowItem(shop, s.shopeeSessionId).catch(() => s.pinnedItemId);
  return {
    items: ids.map((id, i) => {
      const p = map.get(id);
      return { itemId: id, position: i + 1, product: p ? { id: p.id, name: p.name, sku: p.sku, imageUrl: p.imageUrl, price: p.price, stock: p.stock } : null };
    }),
    count: ids.length,
    limit: shop.cartLimit,
    pinned,
  };
}

export async function cartAdd(actor: ActorRef, shop: ShopRow, s: SessionRow, itemIds: number[]) {
  if (!s.shopeeSessionId || s.state === 'ended') throw err.conflict('session_ended', 'Phiên đã kết thúc');
  const current = await shopee.getCartItems(shop, s.shopeeSessionId);
  const catalog = itemIds.length ? await db.select().from(products).where(and(eq(products.shopId, shop.id), inArray(products.itemId, itemIds))) : [];
  const cmap = new Map(catalog.map((p) => [p.itemId, p]));
  const skipped: { itemId: number; reason: string }[] = [];
  const toAdd: number[] = [];
  for (const id of itemIds) {
    const p = cmap.get(id);
    if (current.includes(id) || toAdd.includes(id)) skipped.push({ itemId: id, reason: 'Đã có trong giỏ' });
    else if (!p || p.removed) skipped.push({ itemId: id, reason: 'Không có trong danh mục của shop' });
    else if ((p.stock ?? 0) <= 0) skipped.push({ itemId: id, reason: 'Hết hàng' });
    else if (current.length + toAdd.length >= shop.cartLimit) skipped.push({ itemId: id, reason: `Giỏ đã đủ ${shop.cartLimit} sản phẩm` });
    else toAdd.push(id);
  }
  const added: number[] = [];
  let failed: { itemIds: number[]; error: string } | null = null;
  for (let i = 0; i < toAdd.length; i += 20) {
    const batch = toAdd.slice(i, i + 20);
    try {
      await shopee.addItems(shop, s.shopeeSessionId, batch);
      added.push(...batch);
    } catch (e) {
      failed = { itemIds: toAdd.slice(i), error: e instanceof Error ? e.message : String(e) };
      break;
    }
  }
  if (added.length) {
    await logEvent(s.id, 'info', 'cart_add', `Thêm ${added.length} sản phẩm vào giỏ live`);
    await audit(actor, 'cart_changed', { shopId: shop.id, params: { added: added.length } });
  }
  notify(s);
  return { added, skipped, failed };
}

export async function cartRemove(actor: ActorRef, shop: ShopRow, s: SessionRow, itemIds: number[]) {
  if (!s.shopeeSessionId || s.state === 'ended') throw err.conflict('session_ended', 'Phiên đã kết thúc');
  try {
    await shopee.deleteItems(shop, s.shopeeSessionId, itemIds);
  } catch (e) {
    throw shopeeErrorToApp(e, 'Không gỡ được sản phẩm khỏi giỏ');
  }
  if (s.pinnedItemId && itemIds.includes(s.pinnedItemId)) await patchSession(s.id, { pinnedItemId: null, pinState: 'off' });
  await logEvent(s.id, 'info', 'cart_remove', `Gỡ ${itemIds.length} sản phẩm khỏi giỏ live`);
  await audit(actor, 'cart_changed', { shopId: shop.id, params: { removed: itemIds.length } });
  notify(s);
}

/** Kế hoạch nạp giỏ từ mẫu phát: chỉ thêm, không xóa, theo thứ tự video */
export async function cartPlanFromTemplate(shop: ShopRow, s: SessionRow, templateId: number) {
  const full = await loadTemplateFull(templateId);
  if (!full || full.template.shopId !== shop.id) throw err.notFound('Không tìm thấy mẫu phát');
  const ordered: number[] = [];
  for (const it of full.items) for (const p of it.pins) if (p.product && !ordered.includes(p.product.itemId)) ordered.push(p.product.itemId);
  const current = s.shopeeSessionId ? await shopee.getCartItems(shop, s.shopeeSessionId) : [];
  return { ordered, alreadyIn: ordered.filter((x) => current.includes(x)), toAdd: ordered.filter((x) => !current.includes(x)), cartCount: current.length, limit: shop.cartLimit };
}

// ───────────── Báo cáo từ máy phát & vòng điều khiển ─────────────

export interface StreamReport {
  jobId: number;
  state: 'preparing' | 'pushing' | 'error' | 'stopped';
  videoIndex?: number | null;
  positionSec?: number | null;
  loops?: number;
  error?: string | null;
  commandSeq?: number | null;
}

export async function onStreamReport(job: JobRow, r: StreamReport): Promise<void> {
  const now = new Date();
  const jobPatch: Partial<typeof streamJobs.$inferInsert> = { lastReportAt: now, state: r.state === 'stopped' ? 'stopped' : r.state, error: r.error ?? null };
  if (r.videoIndex !== undefined && r.videoIndex !== null) {
    jobPatch.videoIndex = r.videoIndex;
    jobPatch.resumeIndex = r.videoIndex;
  }
  if (r.positionSec !== undefined) jobPatch.positionSec = r.positionSec ?? null;
  if (r.state === 'pushing' && !job.startedAt) jobPatch.startedAt = now;
  if (r.state === 'error' && job.state !== 'error') jobPatch.restarts = job.restarts + 1;
  await db.update(streamJobs).set(jobPatch).where(eq(streamJobs.id, job.id));
  if (job.desired !== 'run') return;

  const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, job.sessionId));
  if (!s || s.state === 'ended') return;
  const patch: Partial<typeof liveSessions.$inferInsert> = {
    streamState: r.state === 'stopped' ? 'stopped' : r.state,
    videoIndex: r.videoIndex ?? s.videoIndex,
    videoPositionSec: r.positionSec ?? s.videoPositionSec,
    loops: r.loops ?? s.loops,
  };
  if (r.state === 'pushing') {
    if (!s.feedSince) {
      patch.feedSince = now;
      await logEvent(s.id, 'info', 'feed_on', 'Máy chủ đã đẩy hình lên Shopee');
    }
    if (s.feedLostAt) {
      patch.feedLostAt = null;
      await resolveAlert(`feed_lost:${s.id}`);
      await logEvent(s.id, 'info', 'feed_restored', 'Hình đã trở lại');
    }
    if (s.state === 'preparing') patch.state = 'connecting';
    if (s.state === 'disconnected') patch.state = 'live';
  } else if (r.state === 'error') {
    patch.lastError = r.error ?? 'Máy phát lỗi đẩy hình (đang tự chạy lại)';
    if (s.streamState !== 'error') await logEvent(s.id, 'error', 'feed_error', `Máy lỗi đẩy hình: ${r.error ?? ''} (tự chạy lại)`);
  }
  if (r.videoIndex !== undefined && r.videoIndex !== null && r.videoIndex !== s.videoIndex) {
    const name = s.playlist?.[r.videoIndex]?.name;
    if (name) await logEvent(s.id, 'info', 'video', `Đang phát video ${r.videoIndex + 1}/${s.playlist!.length}: ${name}`);
    patch.manualPinVideoIndex = null;
  }
  await patchSession(s.id, patch);
  notify(s);
}

/** Vòng điều khiển (2 giây/lần): bắt đầu phiên khi Shopee đã nhận hình, ghim theo video, phát hiện mất hình */
export async function engineTick(): Promise<void> {
  const limits = await getSetting('limits');
  const frozen = await isFrozen();
  const list = await db
    .select()
    .from(liveSessions)
    .where(and(inArray(liveSessions.state, ['preparing', 'connecting', 'live', 'disconnected']), isNotNull(liveSessions.serverId)));
  if (!list.length) return;
  const shopIds = [...new Set(list.map((s) => s.shopId))];
  const shopRows = await db.select().from(shops).where(inArray(shops.id, shopIds));
  const shopMap = new Map(shopRows.map((x) => [x.id, x]));
  const now = Date.now();

  await pool(list, 16, async (s) => {
    const shop = shopMap.get(s.shopId);
    if (!shop || !s.shopeeSessionId) return;
    const job = await activeJob(s.id);
    if (!job) return;

    // Mất hình: máy không báo về
    const lastReport = job.lastReportAt?.getTime() ?? job.createdAt.getTime();
    if (now - lastReport > 20000 && job.state !== 'waiting_server') {
      if (!s.feedLostAt) {
        await patchSession(s.id, { feedLostAt: new Date(), streamState: 'lost', ...(s.state === 'live' ? { state: 'disconnected' } : {}) });
        await db.update(streamJobs).set({ state: 'lost' }).where(eq(streamJobs.id, job.id));
        await logEvent(s.id, 'error', 'feed_lost', 'Máy chủ phát không báo về — mất hình');
        notify(s);
      } else if (now - s.feedLostAt.getTime() > 30000) {
        await raiseAlert({ key: `feed_lost:${s.id}`, type: 'feed_lost', severity: 'critical', shopId: shop.id, sessionId: s.id, message: `${shop.alias || shop.shopeeName}: mất hình ${Math.round((now - s.feedLostAt.getTime()) / 1000)} giây` });
      }
      return;
    }

    if (frozen) return;

    // Shopee đã nhận hình → bắt đầu phiên
    if (s.state === 'connecting' && s.feedSince && now - s.feedSince.getTime() >= limits.feedStartDelaySec * 1000) {
      try {
        await shopee.startSession(shop, s.shopeeSessionId, s.domainId);
        await patchSession(s.id, { state: 'live', shopeeStatus: 'ongoing', startedAt: new Date(), lastError: null });
        await logEvent(s.id, 'info', 'started', 'Đã bắt đầu phiên trên Shopee — người xem đã thấy hình');
        await audit(SYSTEM_ACTOR, 'session_started', { shopId: shop.id, params: { sessionId: s.shopeeSessionId } });
        notify(s);
      } catch (e) {
        if (e instanceof ShopeeError && (e.kind === 'session_ended' || e.kind === 'session_invalid')) {
          await markEnded(s, 'ended_on_shopee');
          return;
        }
        await patchSession(s.id, { lastError: `Shopee chưa nhận lệnh bắt đầu: ${e instanceof Error ? e.message : e}` });
        await logEvent(s.id, 'error', 'start_failed', `Shopee chưa nhận lệnh bắt đầu: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }

    // Ghim sản phẩm theo video đang phát
    if (s.state === 'live' && s.streamState === 'pushing') {
      if (s.manualPinVideoIndex !== null && s.manualPinVideoIndex === s.videoIndex) return;
      const want = desiredPin(s.playlist, s.videoIndex, s.videoPositionSec);
      if (want && want !== s.pinnedItemId) {
        const failedAt = pinFailAt.get(`${s.id}:${want}`);
        if (failedAt && now - failedAt < 30000) return;
        await doPin(shop, s, want, false);
      }
    }
  });
}

/** Đối soát định kỳ mọi phiên mở + cảnh báo phiên treo */
const lastReconcile = new Map<number, number>();
export async function reconcileTick(): Promise<void> {
  const limits = await getSetting('limits');
  const open = await db.select().from(liveSessions).where(inArray(liveSessions.state, OPEN_SESSION_STATES));
  const now = Date.now();
  const due = open.filter((s) => now - (lastReconcile.get(s.id) ?? 0) >= (s.state === 'live' ? 15000 : s.state === 'ending' ? 10000 : 30000));
  await pool(due, 12, async (s) => {
    const interval = s.state === 'live' ? 15000 : s.state === 'ending' ? 10000 : 30000;
    if (now - (lastReconcile.get(s.id) ?? 0) < interval) return;
    lastReconcile.set(s.id, now);
    await reconcileSession(s, { withMetrics: s.state === 'live' });
    // Dữ liệu quá cũ → không giữ trạng thái "đang live" mà không cảnh báo
    const [fresh] = await db.select().from(liveSessions).where(eq(liveSessions.id, s.id));
    if (!fresh || fresh.state === 'ended') return;
    const last = fresh.lastShopeeSyncAt?.getTime() ?? fresh.createdAt.getTime();
    if (now - last > limits.stuckAfterMin * 60000 && fresh.origin !== 'legacy') {
      if (!fresh.stuck) {
        await patchSession(fresh.id, { stuck: true, ...(fresh.state === 'live' ? { state: 'unknown' } : {}) });
        await logEvent(fresh.id, 'warn', 'stuck', `Không xác minh được trạng thái hơn ${limits.stuckAfterMin} phút — phiên có vẻ bị treo`);
      }
      const [shop] = await db.select().from(shops).where(eq(shops.id, fresh.shopId));
      await raiseAlert({ key: `session_stuck:${fresh.id}`, type: 'session_stuck', severity: 'critical', shopId: fresh.shopId, sessionId: fresh.id, message: `${shop?.alias || shop?.shopeeName}: phiên có vẻ bị treo, cần đồng bộ hoặc giải phóng khóa` });
    }
  });
  for (const id of lastReconcile.keys()) if (!open.find((o) => o.id === id)) lastReconcile.delete(id);
}

/** Máy chủ mất kết nối lâu → chuyển việc phát sang máy khác, phát tiếp từ video đang dở */
export async function failoverTick(): Promise<void> {
  const jobs = await db.select().from(streamJobs).where(and(eq(streamJobs.desired, 'run'), eq(streamJobs.state, 'lost')));
  for (const job of jobs) {
    const lastReport = job.lastReportAt?.getTime() ?? job.createdAt.getTime();
    if (Date.now() - lastReport < 60000) continue;
    const target = await pickServer(null, job.serverId);
    if (!target) continue;
    await db.update(streamJobs).set({ desired: 'stop', stoppedAt: new Date(), error: 'Chuyển sang máy khác do mất kết nối' }).where(eq(streamJobs.id, job.id));
    await db.insert(streamJobs).values({ sessionId: job.sessionId, shopId: job.shopId, serverId: target.id, desired: 'run', state: 'waiting_server', resumeIndex: job.resumeIndex });
    await patchSession(job.sessionId, { serverId: target.id, streamState: 'waiting_server' });
    await logEvent(job.sessionId, 'warn', 'failover', `Chuyển việc phát sang máy ${target.name}, phát tiếp từ video ${job.resumeIndex + 1}`);
  }
}

/** Phiên của shop hết hạn dùng → tự ngắt sau thời gian ân hạn */
export async function liveCutTick(): Promise<void> {
  if (await isFrozen()) return;
  const limits = await getSetting('limits');
  const open = await db
    .select({ s: liveSessions, shop: shops })
    .from(liveSessions)
    .innerJoin(shops, eq(shops.id, liveSessions.shopId))
    .where(inArray(liveSessions.state, ['live', 'connecting', 'preparing', 'not_started', 'disconnected']));
  for (const { s, shop } of open) {
    const svc = shopServiceState(shop);
    if (svc.state !== 'expired' && svc.state !== 'suspended') {
      if (s.liveCutAt) await patchSession(s.id, { liveCutAt: null });
      continue;
    }
    if (!s.liveCutAt) {
      const cut = new Date(Date.now() + limits.liveCutGraceMin * 60000);
      await patchSession(s.id, { liveCutAt: cut });
      await logEvent(s.id, 'warn', 'autocut_scheduled', `Shop hết hạn dùng — phiên sẽ tự ngắt lúc ${cut.toISOString()}`);
      await raiseAlert({ key: `session_autocut:${s.id}`, type: 'session_autocut', severity: 'warning', shopId: shop.id, sessionId: s.id, message: `${shop.alias || shop.shopeeName}: phiên sẽ tự ngắt sau ${limits.liveCutGraceMin} phút do hết hạn` });
      continue;
    }
    if (s.liveCutAt.getTime() <= Date.now()) {
      try {
        await endLiveSession(SYSTEM_ACTOR, shop, s, 'service_expired');
        await resolveAlert(`session_autocut:${s.id}`);
      } catch (e) {
        await raiseAlert({ key: `session_autocut_failed:${s.id}`, type: 'session_autocut_failed', severity: 'critical', shopId: shop.id, sessionId: s.id, message: `${shop.alias || shop.shopeeName}: không tự ngắt được (${e instanceof Error ? e.message : e})` });
      }
    }
  }
}
