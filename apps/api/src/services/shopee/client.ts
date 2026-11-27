import { sql } from 'drizzle-orm';
import { vnDate } from '@mexo/shared';
import { db } from '../../db/client.js';
import { apiCalls, apiDaily } from '../../db/schema.js';
import { rc, shopeeHost } from '../runtimeConfig.js';
import { hmacSha256Hex, refCode } from '../../lib/crypto.js';

/**
 * Danh sách 22 API Shopee theo Brief mục XII (+ update_session, auth_partner).
 * retry: safe = idempotent, được thử lại khi lỗi mạng/5xx/429.
 *        unsafe = có thể tạo trùng (tạo phiên, gửi bình luận) → chỉ thử lại khi Shopee chắc chắn chưa xử lý (429).
 * counted: có tính vào tỷ lệ gọi API thành công của App hay không.
 */
export const API_SPECS = {
  'auth/token/get': { method: 'POST', auth: 'public', retry: 'unsafe', group: 'auth' },
  'auth/access_token/get': { method: 'POST', auth: 'public', retry: 'safe', group: 'auth' },
  'shop/get_shop_info': { method: 'GET', auth: 'shop', retry: 'safe', group: 'shop' },
  'product/get_item_list': { method: 'GET', auth: 'shop', retry: 'safe', group: 'product' },
  'product/get_item_base_info': { method: 'GET', auth: 'shop', retry: 'safe', group: 'product' },
  'product/get_model_list': { method: 'GET', auth: 'shop', retry: 'safe', group: 'product' },
  'product/get_item_extra_info': { method: 'GET', auth: 'shop', retry: 'safe', group: 'product' },
  'livestream/create_session': { method: 'POST', auth: 'shop', retry: 'unsafe', group: 'livestream' },
  'livestream/update_session': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/start_session': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/end_session': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/get_session_detail': { method: 'GET', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/get_session_metric': { method: 'GET', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/upload_image': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/add_item_list': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/delete_item_list': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/get_item_list': { method: 'GET', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/get_item_count': { method: 'GET', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/get_recent_item_list': { method: 'GET', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/update_show_item': { method: 'POST', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/get_show_item': { method: 'GET', auth: 'shop', retry: 'safe', group: 'livestream' },
  'livestream/post_comment': { method: 'POST', auth: 'shop', retry: 'unsafe', group: 'comment' },
  'livestream/get_latest_comment_list': { method: 'GET', auth: 'shop', retry: 'safe', group: 'comment' },
} as const satisfies Record<string, { method: 'GET' | 'POST'; auth: 'public' | 'shop'; retry: 'safe' | 'unsafe'; group: string }>;

export type ApiName = keyof typeof API_SPECS;
export const API_NAMES = Object.keys(API_SPECS) as ApiName[];

export type ShopeeErrorKind =
  | 'auth' // token hết hạn/không hợp lệ
  | 'permission' // shop mất quyền / app không có quyền API
  | 'rate_limit'
  | 'server' // 5xx
  | 'timeout'
  | 'network'
  | 'session_invalid'
  | 'session_ended'
  | 'bad_request'
  | 'circuit_open'
  | 'not_configured';

export class ShopeeError extends Error {
  constructor(
    public kind: ShopeeErrorKind,
    message: string,
    public api: string,
    public code: string | null = null,
    public httpStatus: number | null = null,
    public requestId: string | null = null,
    public ref: string | null = null,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return ['rate_limit', 'server', 'timeout', 'network'].includes(this.kind);
  }
}

export interface CallContext {
  shopId?: number; // id nội bộ (để ghi log)
  shopeeShopId?: number;
  accessToken?: string;
  sessionId?: number; // Shopee session id (để ghi log)
}

export interface CallOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  form?: FormData;
  timeoutMs?: number;
  maxAttempts?: number;
}

// ───────────── Ký request ─────────────

export function signPublic(path: string, ts: number): string {
  return hmacSha256Hex(rc().partnerKey, `${rc().partnerId}${path}${ts}`);
}

export function signShop(path: string, ts: number, accessToken: string, shopId: number): string {
  return hmacSha256Hex(rc().partnerKey, `${rc().partnerId}${path}${ts}${accessToken}${shopId}`);
}

export function apiPath(api: string): string {
  return `/api/v2/${api}`;
}

/** URL cấp quyền chính thức (shop/auth_partner) */
export function buildAuthUrl(redirect: string): string {
  const path = apiPath('shop/auth_partner');
  const ts = Math.floor(Date.now() / 1000);
  const u = new URL(shopeeHost() + path);
  u.searchParams.set('partner_id', String(rc().partnerId));
  u.searchParams.set('timestamp', String(ts));
  u.searchParams.set('sign', signPublic(path, ts));
  u.searchParams.set('redirect', redirect);
  return u.toString();
}

// ───────────── Giới hạn tần suất & circuit breaker ─────────────

const cooldownUntil = new Map<string, number>(); // key: shop:group
let inFlight = 0;
const MAX_IN_FLIGHT = 64;
const waiters: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  inFlight++;
}
function releaseSlot(): void {
  inFlight--;
  const w = waiters.shift();
  if (w) w();
}

interface Breaker {
  results: { at: number; fail: boolean }[];
  openUntil: number;
}
const breakers = new Map<string, Breaker>();

function breakerFor(api: string): Breaker {
  let b = breakers.get(api);
  if (!b) {
    b = { results: [], openUntil: 0 };
    breakers.set(api, b);
  }
  return b;
}

function recordBreaker(api: string, fail: boolean): void {
  const b = breakerFor(api);
  const now = Date.now();
  b.results.push({ at: now, fail });
  b.results = b.results.filter((r) => now - r.at < 60000).slice(-200);
  const fails = b.results.filter((r) => r.fail).length;
  if (b.results.length >= 10 && fails / b.results.length >= 0.5) {
    b.openUntil = now + 30000;
    b.results = [];
  }
}

export function breakerStates(): { api: string; open: boolean; openUntil: number | null }[] {
  const now = Date.now();
  return [...breakers.entries()].map(([api, b]) => ({ api, open: b.openUntil > now, openUntil: b.openUntil > now ? b.openUntil : null }));
}

// ───────────── Nhật ký gọi API (ghi theo lô) ─────────────

type CallLog = typeof apiCalls.$inferInsert;
let buffer: CallLog[] = [];

export function flushApiLogs(): Promise<void> {
  const batch = buffer;
  buffer = [];
  if (!batch.length) return Promise.resolve();
  return (async () => {
    try {
      for (let i = 0; i < batch.length; i += 200) await db.insert(apiCalls).values(batch.slice(i, i + 200));
      const agg = new Map<string, { day: string; api: string; shopId: number; total: number; success: number; totalMs: number }>();
      for (const c of batch) {
        if (c.counted === false) continue;
        const day = vnDate(c.at as Date);
        for (const shopId of [0, c.shopId ?? 0]) {
          const k = `${day}|${c.api}|${shopId}`;
          const a = agg.get(k) ?? { day, api: c.api, shopId, total: 0, success: 0, totalMs: 0 };
          a.total++;
          if (c.success) a.success++;
          a.totalMs += c.durationMs;
          agg.set(k, a);
          if (shopId === 0 && !c.shopId) break;
        }
      }
      for (const a of agg.values()) {
        await db
          .insert(apiDaily)
          .values(a)
          .onConflictDoUpdate({
            target: [apiDaily.day, apiDaily.api, apiDaily.shopId],
            set: {
              total: sql`${apiDaily.total} + ${a.total}`,
              success: sql`${apiDaily.success} + ${a.success}`,
              totalMs: sql`${apiDaily.totalMs} + ${a.totalMs}`,
            },
          });
      }
    } catch (e) {
      console.error('[shopee] ghi log lỗi', e);
    }
  })();
}

/** Bỏ dữ liệu nhạy cảm khỏi thông điệp lỗi */
function sanitize(msg: string | null | undefined): string | null {
  if (!msg) return null;
  return msg
    .replace(/(access_token|refresh_token|sign|partner_key|push_key|key)=([^&\s"]+)/gi, '$1=***')
    .replace(/"(access_token|refresh_token|push_key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
    .slice(0, 500);
}

// ───────────── Gọi API ─────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(api: string, httpStatus: number | null, code: string | null, message: string): ShopeeErrorKind {
  const m = `${code ?? ''} ${message}`.toLowerCase();
  if (httpStatus === 429 || m.includes('too_many') || m.includes('rate limit') || m.includes('error_busi_frequency')) return 'rate_limit';
  if (httpStatus && httpStatus >= 500) return 'server';
  if (m.includes('invalid_access_token') || m.includes('invalid access_token') || m.includes('error_auth') || m.includes('access_token expired') || m.includes('invalid_acceess_token'))
    return 'auth';
  if (m.includes('error_permission') || m.includes('no permission') || m.includes('not authorized') || m.includes('shop_not_found') || m.includes('error_shop'))
    return 'permission';
  if (api.startsWith('livestream/') && m.includes('session')) {
    if (m.includes('ended') || m.includes('has been end') || m.includes('already end')) return 'session_ended';
    if (m.includes('not exist') || m.includes('not found') || m.includes('invalid')) return 'session_invalid';
  }
  if (httpStatus === 401) return 'auth';
  if (httpStatus === 403) return 'permission';
  return 'bad_request';
}

export async function shopeeCall<T = any>(api: ApiName, ctx: CallContext, opts: CallOptions = {}): Promise<T> {
  const spec = API_SPECS[api];
  if (rc().shopeeMode !== 'mock' && (!rc().partnerId || !rc().partnerKey)) {
    throw new ShopeeError('not_configured', 'Chưa cấu hình Partner ID / Partner Key — nhập tại Cấu hình hệ thống → Kết nối & tích hợp', api);
  }
  const b = breakerFor(api);
  if (b.openUntil > Date.now()) {
    throw new ShopeeError('circuit_open', 'Tạm ngắt gọi API do Shopee lỗi kéo dài, sẽ thử lại sau ít giây', api);
  }
  const coolKey = `${ctx.shopeeShopId ?? 0}:${spec.group}`;
  const cool = cooldownUntil.get(coolKey);
  if (cool && cool > Date.now()) await sleep(Math.min(cool - Date.now(), 10000));

  const maxAttempts = opts.maxAttempts ?? (spec.retry === 'safe' ? 3 : 2);
  const path = apiPath(api);
  let attempt = 0;
  const started = Date.now();
  let lastErr: ShopeeError | null = null;

  while (attempt < maxAttempts) {
    attempt++;
    const ts = Math.floor(Date.now() / 1000);
    const u = new URL(shopeeHost() + path);
    u.searchParams.set('partner_id', String(rc().partnerId));
    u.searchParams.set('timestamp', String(ts));
    if (spec.auth === 'public') {
      u.searchParams.set('sign', signPublic(path, ts));
    } else {
      if (!ctx.accessToken || !ctx.shopeeShopId) throw new ShopeeError('auth', 'Shop chưa có access token', api);
      u.searchParams.set('access_token', ctx.accessToken);
      u.searchParams.set('shop_id', String(ctx.shopeeShopId));
      u.searchParams.set('sign', signShop(path, ts, ctx.accessToken, ctx.shopeeShopId));
    }
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? rc().timeoutMs);
    let httpStatus: number | null = null;
    let requestId: string | null = null;
    let payload: any = null;
    const t0 = Date.now();
    await acquireSlot();
    try {
      const res = await fetch(u, {
        method: spec.method,
        signal: ac.signal,
        headers: opts.form ? undefined : { 'content-type': 'application/json' },
        body: spec.method === 'POST' ? (opts.form ?? JSON.stringify(opts.body ?? {})) : undefined,
      });
      httpStatus = res.status;
      const text = await res.text();
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { error: 'invalid_json', message: text.slice(0, 200) };
      }
      requestId = payload?.request_id ?? res.headers.get('x-request-id');
      const errorCode: string | null = payload?.error ? String(payload.error) : null;
      if (res.ok && !errorCode) {
        recordBreaker(api, false);
        buffer.push({
          at: new Date(t0),
          api,
          shopId: ctx.shopId ?? null,
          shopeeShopId: ctx.shopeeShopId ?? null,
          sessionId: ctx.sessionId ?? null,
          httpStatus,
          requestId,
          durationMs: Date.now() - t0,
          retries: attempt - 1,
          success: true,
          counted: true,
        });
        return (payload?.response ?? payload) as T;
      }
      const message = String(payload?.message ?? payload?.msg ?? `HTTP ${res.status}`);
      const kind = classify(api, httpStatus, errorCode, message);
      lastErr = new ShopeeError(kind, message, api, errorCode, httpStatus, requestId);
      if (kind === 'rate_limit') {
        const ra = Number(res.headers.get('retry-after'));
        cooldownUntil.set(coolKey, Date.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * attempt));
      }
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      lastErr = new ShopeeError(aborted ? 'timeout' : 'network', aborted ? 'Shopee không phản hồi (timeout)' : `Lỗi mạng: ${e?.message ?? e}`, api, null, null, null);
    } finally {
      clearTimeout(timer);
      releaseSlot();
    }

    // Ghi log lần thử thất bại
    const ref = refCode();
    lastErr.ref = ref;
    const errorClass = lastErr.kind === 'timeout' || lastErr.kind === 'network' ? 'network' : 'shopee';
    recordBreaker(api, lastErr.kind === 'server' || lastErr.kind === 'timeout' || lastErr.kind === 'network');
    buffer.push({
      at: new Date(t0),
      api,
      shopId: ctx.shopId ?? null,
      shopeeShopId: ctx.shopeeShopId ?? null,
      sessionId: ctx.sessionId ?? null,
      httpStatus: lastErr.httpStatus,
      errorCode: lastErr.code ?? lastErr.kind,
      errorMessage: sanitize(lastErr.message),
      errorClass,
      requestId: lastErr.requestId,
      durationMs: Date.now() - t0,
      retries: attempt - 1,
      success: false,
      counted: true,
      ref,
    });

    const canRetry =
      attempt < maxAttempts &&
      (spec.retry === 'safe' ? lastErr.retryable : lastErr.kind === 'rate_limit' || (lastErr.kind === 'server' && lastErr.httpStatus === 503));
    if (!canRetry) break;
    const backoff = Math.min(8000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 300);
    if (Date.now() - started + backoff > 45000) break;
    await sleep(backoff);
  }
  throw lastErr ?? new ShopeeError('network', 'Lỗi không xác định', api);
}
