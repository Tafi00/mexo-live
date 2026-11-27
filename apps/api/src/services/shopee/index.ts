import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { shops } from '../../db/schema.js';
import { env } from '../../env.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { raiseAlert, resolveAlert } from '../alerts.js';
import { shopeeCall, ShopeeError, type ApiName, type CallOptions } from './client.js';
import { rc } from '../runtimeConfig.js';

export { ShopeeError, buildAuthUrl, API_NAMES, API_SPECS, flushApiLogs, breakerStates } from './client.js';

type ShopRow = typeof shops.$inferSelect;

// ───────────── Token ─────────────

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expireIn: number;
}

function toTokenSet(r: any): TokenSet {
  return { accessToken: r.access_token, refreshToken: r.refresh_token, expireIn: Number(r.expire_in ?? 14400) };
}

/** Đổi mã cấp quyền (code) lấy access token + refresh token */
export async function exchangeCode(code: string, shopeeShopId: number): Promise<TokenSet> {
  const r = await shopeeCall('auth/token/get', { shopeeShopId }, { body: { code, shop_id: shopeeShopId, partner_id: rc().partnerId } });
  if (!r?.access_token) throw new ShopeeError('bad_request', 'Shopee không trả về access token', 'auth/token/get');
  return toTokenSet(r);
}

export async function saveTokens(shopId: number, t: TokenSet): Promise<void> {
  await db
    .update(shops)
    .set({
      accessTokenEnc: encrypt(t.accessToken),
      refreshTokenEnc: encrypt(t.refreshToken),
      accessExpiresAt: new Date(Date.now() + t.expireIn * 1000),
      tokenRefreshedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shopId));
}

const refreshing = new Map<number, Promise<string>>();

/** Làm mới access token (gộp các yêu cầu đồng thời của cùng shop) */
export function refreshAccessToken(shopId: number): Promise<string> {
  const existing = refreshing.get(shopId);
  if (existing) return existing;
  const p = (async () => {
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
    if (!shop) throw new ShopeeError('auth', 'Không tìm thấy shop', 'auth/access_token/get');
    const refreshToken = decrypt(shop.refreshTokenEnc);
    if (!refreshToken) {
      await markNeedsReauth(shop, 'Chưa có refresh token');
      throw new ShopeeError('auth', 'Shop cần cấp quyền lại', 'auth/access_token/get');
    }
    try {
      const r = await shopeeCall(
        'auth/access_token/get',
        { shopId: shop.id, shopeeShopId: shop.shopeeShopId },
        { body: { refresh_token: refreshToken, shop_id: shop.shopeeShopId, partner_id: rc().partnerId } },
      );
      const t = toTokenSet(r);
      await saveTokens(shop.id, t);
      if (shop.connection === 'error' || shop.connection === 'needs_reauth') {
        await db.update(shops).set({ connection: 'ok', connectionError: null }).where(eq(shops.id, shop.id));
      }
      await resolveAlert(`shop_reauth:${shop.id}`);
      return t.accessToken;
    } catch (e) {
      if (e instanceof ShopeeError && !e.retryable && e.kind !== 'circuit_open' && e.kind !== 'not_configured') {
        await markNeedsReauth(shop, e.message);
      }
      throw e;
    }
  })().finally(() => refreshing.delete(shopId));
  refreshing.set(shopId, p);
  return p;
}

async function markNeedsReauth(shop: ShopRow, reason: string): Promise<void> {
  await db.update(shops).set({ connection: 'needs_reauth', connectionError: reason.slice(0, 300), updatedAt: new Date() }).where(eq(shops.id, shop.id));
  await raiseAlert({
    key: `shop_reauth:${shop.id}`,
    type: 'shop_reauth',
    severity: 'warning',
    shopId: shop.id,
    message: `${shop.alias || shop.shopeeName}: ${reason}`,
  });
}

async function getAccessToken(shop: ShopRow): Promise<string> {
  const token = decrypt(shop.accessTokenEnc);
  if (token && shop.accessExpiresAt && shop.accessExpiresAt.getTime() > Date.now() + 5 * 60000) return token;
  return refreshAccessToken(shop.id);
}

/** Gọi API theo shop: tự gắn token, tự làm mới token 1 lần khi bị từ chối, đánh dấu mất quyền */
export async function shopApi<T = any>(shop: ShopRow, api: ApiName, opts: CallOptions & { sessionId?: number } = {}): Promise<T> {
  let token = await getAccessToken(shop);
  const ctx = { shopId: shop.id, shopeeShopId: shop.shopeeShopId, accessToken: token, sessionId: opts.sessionId };
  try {
    return await shopeeCall<T>(api, ctx, opts);
  } catch (e) {
    if (e instanceof ShopeeError && e.kind === 'auth') {
      token = await refreshAccessToken(shop.id);
      return await shopeeCall<T>(api, { ...ctx, accessToken: token }, opts);
    }
    if (e instanceof ShopeeError && e.kind === 'permission' && api !== 'livestream/post_comment') {
      await db.update(shops).set({ connection: 'revoked', connectionError: e.message.slice(0, 300) }).where(eq(shops.id, shop.id));
      await raiseAlert({
        key: `shop_reauth:${shop.id}`,
        type: 'shop_reauth',
        severity: 'critical',
        shopId: shop.id,
        message: `${shop.alias || shop.shopeeName}: Shopee từ chối quyền (${e.message})`,
      });
    }
    throw e;
  }
}

// ───────────── Shop ─────────────

export async function getShopInfo(shop: ShopRow) {
  const r = await shopApi(shop, 'shop/get_shop_info');
  return {
    shopName: String(r.shop_name ?? ''),
    region: String(r.region ?? 'VN'),
    status: String(r.status ?? ''),
    authExpiresAt: r.expire_time ? new Date(Number(r.expire_time) * 1000) : null,
  };
}

// ───────────── Sản phẩm ─────────────

export async function getItemIdPage(shop: ShopRow, offset: number, pageSize = 100) {
  const r = await shopApi(shop, 'product/get_item_list', { query: { offset, page_size: pageSize, item_status: 'NORMAL' } });
  return {
    itemIds: ((r.item ?? []) as any[]).map((x) => Number(x.item_id)),
    total: Number(r.total_count ?? 0),
    hasNext: Boolean(r.has_next_page),
    nextOffset: Number(r.next_offset ?? offset + pageSize),
  };
}

export interface ItemBase {
  itemId: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  stock: number | null;
  status: string;
  hasModel: boolean;
}

export async function getItemBaseInfo(shop: ShopRow, itemIds: number[]): Promise<ItemBase[]> {
  const r = await shopApi(shop, 'product/get_item_base_info', { query: { item_id_list: itemIds.join(',') } });
  return ((r.item_list ?? []) as any[]).map((x) => {
    const pi = (x.price_info ?? [])[0] ?? {};
    const stock = x.stock_info_v2?.summary_info?.total_available_stock ?? x.stock_info?.[0]?.current_stock ?? null;
    return {
      itemId: Number(x.item_id),
      name: String(x.item_name ?? ''),
      sku: x.item_sku || null,
      imageUrl: x.image?.image_url_list?.[0] ?? null,
      price: pi.current_price ?? null,
      originalPrice: pi.original_price ?? null,
      currency: pi.currency ?? 'VND',
      stock: stock === null ? null : Number(stock),
      status: String(x.item_status ?? 'NORMAL'),
      hasModel: Boolean(x.has_model),
    };
  });
}

export async function getItemExtraInfo(shop: ShopRow, itemIds: number[]) {
  const r = await shopApi(shop, 'product/get_item_extra_info', { query: { item_id_list: itemIds.join(',') } });
  return ((r.item_list ?? []) as any[]).map((x) => ({
    itemId: Number(x.item_id),
    sold: x.sale ?? null,
    views: x.views ?? null,
    likes: x.likes ?? null,
    rating: x.rating_star ?? null,
    comments: x.comment_count ?? null,
  }));
}

export async function getModelList(shop: ShopRow, itemId: number) {
  const r = await shopApi(shop, 'product/get_model_list', { query: { item_id: itemId } });
  const tiers = (r.tier_variation ?? []) as any[];
  return ((r.model ?? []) as any[]).map((m) => {
    const idx: number[] = m.tier_index ?? [];
    const name = idx.map((i, t) => tiers[t]?.option_list?.[i]?.option).filter(Boolean).join(' / ') || m.model_name || '';
    return {
      modelId: Number(m.model_id),
      name,
      sku: m.model_sku || null,
      price: m.price_info?.[0]?.current_price ?? null,
      stock: m.stock_info_v2?.summary_info?.total_available_stock ?? null,
    };
  });
}

// ───────────── Livestream ─────────────

export type ShopeeLiveStatus = 'not_started' | 'ongoing' | 'ended' | 'unknown';

function mapStatus(s: unknown): ShopeeLiveStatus {
  const n = Number(s);
  if (n === 0) return 'not_started';
  if (n === 1) return 'ongoing';
  if (n === 2 || n === 3) return 'ended';
  return 'unknown';
}

export async function uploadImage(shop: ShopRow, data: Buffer, fileName: string, mime: string): Promise<string> {
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(data)], { type: mime }), fileName);
  const r = await shopApi(shop, 'livestream/upload_image', { form });
  const url = r.image_url ?? r.url;
  if (!url) throw new ShopeeError('bad_request', 'Shopee không trả về URL ảnh', 'livestream/upload_image');
  return String(url);
}

export async function createSession(shop: ShopRow, p: { title: string; description: string; coverUrl: string }) {
  const r = await shopApi(shop, 'livestream/create_session', {
    body: { title: p.title, description: p.description, cover_image_url: p.coverUrl, is_test: false },
  });
  const id = Number(r.session_id);
  if (!id) throw new ShopeeError('bad_request', 'Shopee không trả về session_id', 'livestream/create_session');
  return id;
}

export async function updateSession(shop: ShopRow, sessionId: number, p: { title: string; description: string; coverUrl: string }) {
  await shopApi(shop, 'livestream/update_session', {
    sessionId,
    body: { session_id: sessionId, title: p.title, description: p.description, cover_image_url: p.coverUrl },
  });
}

export async function getSessionDetail(shop: ShopRow, sessionId: number) {
  const r = await shopApi(shop, 'livestream/get_session_detail', { sessionId, query: { session_id: sessionId } });
  const stream = (Array.isArray(r.stream_url_list) ? r.stream_url_list[0] : r.stream_url_list) ?? {};
  return {
    status: mapStatus(r.status),
    title: r.title as string | undefined,
    shareUrl: (r.share_url as string | undefined) ?? null,
    startTime: r.start_time ? new Date(Number(r.start_time) * (Number(r.start_time) > 1e12 ? 1 : 1000)) : null,
    endTime: r.end_time ? new Date(Number(r.end_time) * (Number(r.end_time) > 1e12 ? 1 : 1000)) : null,
    pushUrl: stream.push_url ? `${String(stream.push_url).replace(/\/$/, '')}/${stream.push_key ?? ''}`.replace(/\/$/, '') : null,
    domainId: stream.domain_id ? Number(stream.domain_id) : null,
  };
}

export async function startSession(shop: ShopRow, sessionId: number, domainId: number | null) {
  await shopApi(shop, 'livestream/start_session', { sessionId, body: { session_id: sessionId, domain_id: domainId ?? undefined } });
}

export async function endSession(shop: ShopRow, sessionId: number) {
  await shopApi(shop, 'livestream/end_session', { sessionId, body: { session_id: sessionId } });
}

export async function getSessionMetric(shop: ShopRow, sessionId: number) {
  const r = await shopApi(shop, 'livestream/get_session_metric', { sessionId, query: { session_id: sessionId } });
  return {
    viewers: Number(r.ccu ?? r.engage_ccu_1m ?? 0),
    peakViewers: Number(r.peak_ccu ?? 0),
    views: Number(r.views ?? 0),
    avgViewSec: Number(r.avg_viewing_duration ?? 0),
    likes: Number(r.likes ?? 0),
    comments: Number(r.comments ?? 0),
    orders: Number(r.orders ?? r.placed_order ?? 0),
    gmv: Number(r.gmv ?? r.placed_gmv ?? 0),
    shares: Number(r.shares ?? 0),
  };
}

export async function addItems(shop: ShopRow, sessionId: number, itemIds: number[]) {
  await shopApi(shop, 'livestream/add_item_list', {
    sessionId,
    body: { session_id: sessionId, item_list: itemIds.map((id) => ({ item_id: id, shop_id: shop.shopeeShopId })) },
  });
}

export async function deleteItems(shop: ShopRow, sessionId: number, itemIds: number[]) {
  await shopApi(shop, 'livestream/delete_item_list', {
    sessionId,
    body: { session_id: sessionId, item_list: itemIds.map((id) => ({ item_id: id, shop_id: shop.shopeeShopId })) },
  });
}

export async function getCartItems(shop: ShopRow, sessionId: number): Promise<number[]> {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const r = await shopApi(shop, 'livestream/get_item_list', { sessionId, query: { session_id: sessionId, offset, page_size: 50 } });
    const list = (r.item_list ?? []) as any[];
    out.push(...list.map((x) => Number(x.item_id)));
    if (!r.more || !list.length) break;
    offset = Number(r.next_offset ?? offset + list.length);
  }
  return out;
}

export async function getItemCount(shop: ShopRow, sessionId: number): Promise<number> {
  const r = await shopApi(shop, 'livestream/get_item_count', { sessionId, query: { session_id: sessionId } });
  return Number(r.total_count ?? r.item_count ?? 0);
}

export async function getRecentItems(shop: ShopRow, sessionId: number): Promise<number[]> {
  const r = await shopApi(shop, 'livestream/get_recent_item_list', { sessionId, query: { session_id: sessionId, offset: 0, page_size: 50 } });
  return ((r.item_list ?? []) as any[]).map((x) => Number(x.item_id));
}

export async function updateShowItem(shop: ShopRow, sessionId: number, itemId: number) {
  await shopApi(shop, 'livestream/update_show_item', {
    sessionId,
    body: { session_id: sessionId, item: { item_id: itemId, shop_id: shop.shopeeShopId } },
  });
}

export async function getShowItem(shop: ShopRow, sessionId: number): Promise<number | null> {
  const r = await shopApi(shop, 'livestream/get_show_item', { sessionId, query: { session_id: sessionId } });
  const id = r.item?.item_id ?? r.item_id;
  return id ? Number(id) : null;
}

export async function postComment(shop: ShopRow, sessionId: number, comment: string) {
  await shopApi(shop, 'livestream/post_comment', { sessionId, body: { session_id: sessionId, comment } });
}

export interface LiveComment {
  commentId: string;
  userId: string | null;
  username: string | null;
  content: string;
  at: Date;
}

export async function getLatestComments(shop: ShopRow, sessionId: number, offset: string | null) {
  const r = await shopApi(shop, 'livestream/get_latest_comment_list', {
    sessionId,
    query: { session_id: sessionId, offset: offset ?? undefined, page_size: 50 },
    maxAttempts: 1,
  });
  const list = ((r.comment_list ?? r.comments ?? []) as any[]).map(
    (c): LiveComment => ({
      commentId: String(c.comment_id ?? c.id),
      userId: c.user_id ? String(c.user_id) : null,
      username: c.username ?? c.user_name ?? null,
      content: String(c.content ?? c.comment ?? ''),
      at: c.create_time ? new Date(Number(c.create_time) * (Number(c.create_time) > 1e12 ? 1 : 1000)) : new Date(),
    }),
  );
  return { comments: list, nextOffset: r.next_offset ? String(r.next_offset) : offset };
}
