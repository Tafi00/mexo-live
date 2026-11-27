/**
 * Shopee Open Platform GIẢ LẬP — chỉ bật khi SHOPEE_MODE=mock.
 * Mục đích: chạy thử trọn luồng (kết nối, đồng bộ, tạo phiên, đẩy hình, ghim, bình luận) khi chưa có Partner ID thật.
 * Client thật (ký HMAC, retry, log) gọi HTTP vào đây y như gọi Shopee.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { liveSessions, products, shops } from '../db/schema.js';
import { env } from '../env.js';
import { hmacSha256Hex, randomToken } from '../lib/crypto.js';

const ERROR_RATE = Number(process.env.MOCK_SHOPEE_ERROR_RATE ?? '0.01');

interface MockSession {
  id: number;
  shopId: number;
  title: string;
  description: string;
  cover: string;
  status: 0 | 1 | 2;
  createdAt: number;
  startAt: number | null;
  endAt: number | null;
  items: number[];
  show: number | null;
  comments: { comment_id: string; user_id: string; username: string; content: string; create_time: number }[];
  commentSeq: number;
  metrics: { ccu: number; peak_ccu: number; views: number; likes: number; comments: number; orders: number; gmv: number };
}

const codes = new Map<string, number>(); // code → shop_id
const tokens = new Map<string, { shopId: number; exp: number }>();
const refreshTokens = new Map<string, number>();
const sessions = new Map<number, MockSession>();
let seq = 47000000 + Math.floor(Math.random() * 100000);

const VIEWERS = ['ngoclan.99', 'tuananh_hn', 'minhthu2k', 'hoangyen', 'quanghuy.sg', 'baongoc_88', 'thanhtam', 'phuongvy', 'ducmanh91', 'kimchi.le'];
const COMMENTS = [
  'Shop ơi sản phẩm này còn hàng không ạ?',
  'Giá bao nhiêu vậy shop',
  'Ship về Hà Nội mất mấy ngày ạ',
  'Có màu đen không shop',
  'Chất liệu gì vậy ạ',
  'Size M còn không shop ơi',
  'Mua 2 cái có giảm không',
  'Sản phẩm có bảo hành không ạ',
  'Đổi trả được không shop',
  'Hàng có sẵn không hay phải đặt',
  'Đẹp quá ạ ❤️',
  'Cho mình xem lại sản phẩm số 3 với',
  'inbox zalo cho mình nhé 0912345678',
  'Freeship không shop',
  'Có voucher không ạ',
];

function ok(response: unknown) {
  return { error: '', message: '', request_id: randomToken(8), response };
}
function fail(error: string, message: string) {
  return { error, message, request_id: randomToken(8) };
}

async function shopNameOf(shopeeShopId: number): Promise<string> {
  const [s] = await db.select({ name: shops.shopeeName }).from(shops).where(eq(shops.shopeeShopId, shopeeShopId));
  return s?.name || `Shop Demo ${shopeeShopId}`;
}

const NAMES = ['Áo thun cotton basic', 'Quần jean ống suông', 'Váy hoa nhí vintage', 'Áo sơ mi linen', 'Túi tote canvas', 'Giày sneaker trắng', 'Mũ bucket', 'Kính mát thời trang', 'Đồng hồ dây da', 'Son kem lì', 'Kem chống nắng SPF50', 'Serum vitamin C', 'Bình giữ nhiệt 500ml', 'Tai nghe bluetooth', 'Sạc dự phòng 10000mAh', 'Ốp lưng điện thoại', 'Bàn phím cơ mini', 'Chuột không dây', 'Đèn ngủ cảm ứng', 'Gối tựa lưng'];

async function catalogOf(shopeeShopId: number) {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.shopeeShopId, shopeeShopId));
  if (shop) {
    const rows = await db.select().from(products).where(eq(products.shopId, shop.id));
    if (rows.length) {
      return rows.map((p) => ({
        item_id: p.itemId,
        item_name: p.name,
        item_sku: p.sku ?? '',
        image_url: p.imageUrl,
        price: p.price ?? 0,
        original_price: p.originalPrice ?? p.price ?? 0,
        stock: p.stock ?? 0,
        sold: p.sold ?? 0,
        likes: p.likes ?? 0,
        rating: p.rating ?? 0,
      }));
    }
  }
  return NAMES.map((n, i) => {
    const price = (Math.floor(((shopeeShopId % 97) * 7 + i * 13) % 50) + 5) * 10000;
    return {
      item_id: shopeeShopId * 100 + i + 1,
      item_name: `${n} ${['cao cấp', 'hàng chính hãng', 'phong cách Hàn Quốc', 'mẫu mới 2026'][i % 4]}`,
      item_sku: `SKU-${(shopeeShopId % 10000).toString().padStart(4, '0')}-${(i + 1).toString().padStart(3, '0')}`,
      image_url: `https://picsum.photos/seed/${shopeeShopId}-${i}/300/300`,
      price,
      original_price: Math.round(price * 1.2),
      stock: i % 9 === 0 ? 0 : (i * 37) % 200,
      sold: (i * 53) % 1000,
      likes: (i * 11) % 300,
      rating: 4 + ((i % 10) / 10),
    };
  });
}

async function sessionOf(id: number): Promise<MockSession | null> {
  const s = sessions.get(id);
  if (s) return s;
  // Sau khi API khởi động lại: dựng lại phiên giả lập từ DB
  const [row] = await db.select().from(liveSessions).where(eq(liveSessions.shopeeSessionId, id));
  if (!row) return null;
  const [shop] = await db.select().from(shops).where(eq(shops.id, row.shopId));
  const restored: MockSession = {
    id,
    shopId: shop?.shopeeShopId ?? 0,
    title: row.title,
    description: row.description,
    cover: row.coverUrl ?? '',
    status: row.state === 'ended' ? 2 : row.startedAt ? 1 : 0,
    createdAt: row.createdAt.getTime(),
    startAt: row.startedAt?.getTime() ?? null,
    endAt: row.endedAt?.getTime() ?? null,
    items: [...new Set((row.playlist ?? []).flatMap((p) => p.pins.map((x) => x.itemId)))],
    show: row.pinnedItemId ?? null,
    comments: [],
    commentSeq: 1,
    metrics: { ccu: 0, peak_ccu: 0, views: 0, likes: 0, comments: 0, orders: 0, gmv: 0, ...(row.metrics as object) } as MockSession['metrics'],
  };
  sessions.set(id, restored);
  return restored;
}

function tick(s: MockSession) {
  if (s.status !== 1) return;
  const m = s.metrics;
  const drift = Math.round((Math.random() - 0.45) * 6);
  m.ccu = Math.max(0, Math.min(400, m.ccu + drift + (m.ccu < 5 ? 2 : 0)));
  m.peak_ccu = Math.max(m.peak_ccu, m.ccu);
  m.views += Math.max(0, Math.round(Math.random() * 4));
  m.likes += Math.round(Math.random() * 8);
  if (Math.random() < 0.05) {
    m.orders += 1;
    m.gmv += (Math.floor(Math.random() * 40) + 5) * 10000;
  }
  const n = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const c = COMMENTS[Math.floor(Math.random() * COMMENTS.length)]!;
    const u = VIEWERS[Math.floor(Math.random() * VIEWERS.length)]!;
    s.comments.push({ comment_id: `${s.id}-${s.commentSeq++}`, user_id: String(100000 + VIEWERS.indexOf(u)), username: u, content: c, create_time: Math.floor(Date.now() / 1000) });
    m.comments++;
  }
  if (s.comments.length > 500) s.comments.splice(0, s.comments.length - 500);
}

export async function mockShopeeRoutes(app: FastifyInstance) {
  if (env.shopee.mode !== 'mock') return;

  // Trang cấp quyền giả lập
  app.get('/api/mock-shopee/api/v2/shop/auth_partner', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const existing = await db.select({ id: shops.shopeeShopId, name: shops.shopeeName }).from(shops).limit(300);
    const suggestion = 800000000 + Math.floor(Math.random() * 99999999);
    const opts = existing.map((s) => `<option value="${s.id}">${s.name.replace(/</g, '&lt;')} (${s.id})</option>`).join('');
    reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopee Open Platform (giả lập)</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fff;border-radius:12px;box-shadow:0 4px 24px #0001;padding:32px;max-width:440px;width:calc(100% - 32px)}h1{color:#ee4d2d;font-size:20px;margin:0 0 4px}p{color:#555;font-size:14px;line-height:1.5}label{display:block;font-size:13px;font-weight:600;margin:16px 0 6px}input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px}button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#ee4d2d;color:#fff;font-weight:600;font-size:15px;cursor:pointer}.tag{display:inline-block;background:#fff3e0;color:#b45309;font-size:12px;padding:2px 8px;border-radius:99px;margin-bottom:12px}</style></head>
<body><main><span class="tag">MÔI TRƯỜNG GIẢ LẬP</span><h1>Shopee — Cấp quyền ứng dụng</h1><p>Ứng dụng <b>MEXO Live</b> yêu cầu quyền truy cập Shop, Sản phẩm và Livestream. Đây là trang giả lập để chạy thử, không kết nối Shopee thật.</p>
<form method="get" action="/api/mock-shopee/authorize/confirm"><input type="hidden" name="redirect" value="${(q.redirect ?? '').replace(/"/g, '&quot;')}">
<label>Chọn shop có sẵn</label><select name="pick"><option value="">— Shop mới —</option>${opts}</select>
<label>Hoặc nhập Shop ID mới</label><input name="shop_id" value="${suggestion}">
<button type="submit">Đồng ý cấp quyền</button></form></main></body></html>`);
  });

  app.get('/api/mock-shopee/authorize/confirm', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const shopId = Number(q.pick || q.shop_id);
    const code = randomToken(12);
    codes.set(code, shopId);
    const u = new URL(q.redirect!);
    u.searchParams.set('code', code);
    u.searchParams.set('shop_id', String(shopId));
    reply.redirect(u.toString());
  });

  app.all('/api/mock-shopee/api/v2/*', async (req, reply) => {
    const path = '/api/v2/' + (req.params as { '*': string })['*'];
    const api = path.replace('/api/v2/', '');
    const q = req.query as Record<string, string>;
    const body = (typeof req.body === 'object' && req.body ? req.body : {}) as Record<string, any>;
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 120));

    // Kiểm tra chữ ký
    const ts = Number(q.timestamp);
    if (Math.abs(Date.now() / 1000 - ts) > 300) return reply.send(fail('error_sign', 'timestamp expired'));
    const isPublic = api.startsWith('auth/');
    const base = isPublic ? `${q.partner_id}${path}${q.timestamp}` : `${q.partner_id}${path}${q.timestamp}${q.access_token}${q.shop_id}`;
    if (hmacSha256Hex(env.shopee.partnerKey, base) !== q.sign) return reply.send(fail('error_sign', 'Wrong sign'));

    if (!isPublic) {
      const t = tokens.get(q.access_token ?? '');
      if (!t || t.exp < Date.now() || t.shopId !== Number(q.shop_id)) {
        // Token cấp trước khi API khởi động lại: chấp nhận nếu đúng định dạng mock
        if (!(q.access_token ?? '').startsWith(`mock_at_${q.shop_id}_`)) return reply.send(fail('invalid_access_token', 'Invalid access_token'));
      }
      if (Math.random() < ERROR_RATE && api !== 'livestream/create_session' && api !== 'livestream/post_comment') {
        return Math.random() < 0.5 ? reply.code(500).send(fail('error_server', 'Internal error')) : reply.code(429).send(fail('error_busi_frequency', 'Too many request'));
      }
    }
    const shopId = Number(q.shop_id);

    switch (api) {
      case 'auth/token/get': {
        const sid = codes.get(body.code);
        if (!sid || sid !== Number(body.shop_id)) return reply.send(fail('error_auth', 'Invalid code'));
        codes.delete(body.code);
        return reply.send(issueTokens(sid));
      }
      case 'auth/access_token/get': {
        const sid = refreshTokens.get(body.refresh_token) ?? (String(body.refresh_token).startsWith(`mock_rt_${body.shop_id}_`) ? Number(body.shop_id) : null);
        if (!sid) return reply.send(fail('error_auth', 'Invalid refresh_token'));
        return reply.send(issueTokens(sid));
      }
      case 'shop/get_shop_info':
        return reply.send({
          ...ok(null),
          response: undefined,
          shop_name: await shopNameOf(shopId),
          region: 'VN',
          status: 'NORMAL',
          auth_time: Math.floor(Date.now() / 1000),
          expire_time: Math.floor(Date.now() / 1000) + 365 * 86400,
        });
      case 'product/get_item_list': {
        const cat = await catalogOf(shopId);
        const offset = Number(q.offset ?? 0);
        const size = Number(q.page_size ?? 100);
        const page = cat.slice(offset, offset + size);
        return reply.send(ok({ item: page.map((x) => ({ item_id: x.item_id, item_status: 'NORMAL' })), total_count: cat.length, has_next_page: offset + size < cat.length, next_offset: offset + size }));
      }
      case 'product/get_item_base_info': {
        const ids = String(q.item_id_list ?? '').split(',').map(Number);
        const cat = await catalogOf(shopId);
        const list = cat.filter((x) => ids.includes(Number(x.item_id)));
        return reply.send(
          ok({
            item_list: list.map((x) => ({
              item_id: x.item_id,
              item_name: x.item_name,
              item_sku: x.item_sku,
              item_status: 'NORMAL',
              has_model: false,
              image: { image_url_list: x.image_url ? [x.image_url] : [] },
              price_info: [{ current_price: x.price, original_price: x.original_price, currency: 'VND' }],
              stock_info_v2: { summary_info: { total_available_stock: x.stock } },
            })),
          }),
        );
      }
      case 'product/get_item_extra_info': {
        const ids = String(q.item_id_list ?? '').split(',').map(Number);
        const cat = await catalogOf(shopId);
        return reply.send(ok({ item_list: cat.filter((x) => ids.includes(Number(x.item_id))).map((x) => ({ item_id: x.item_id, sale: x.sold, likes: x.likes, rating_star: x.rating, views: x.sold * 7 })) }));
      }
      case 'product/get_model_list':
        return reply.send(ok({ tier_variation: [], model: [] }));
      case 'livestream/upload_image':
        return reply.send(ok({ image_url: `https://picsum.photos/seed/cover-${randomToken(4)}/720/1280` }));
      case 'livestream/create_session': {
        for (const s of sessions.values()) if (s.shopId === shopId && s.status !== 2 && s.status === 1) return reply.send(fail('error_param', 'Shop already has an ongoing session'));
        const id = ++seq;
        sessions.set(id, {
          id,
          shopId,
          title: body.title,
          description: body.description ?? '',
          cover: body.cover_image_url ?? '',
          status: 0,
          createdAt: Date.now(),
          startAt: null,
          endAt: null,
          items: [],
          show: null,
          comments: [],
          commentSeq: 1,
          metrics: { ccu: 0, peak_ccu: 0, views: 0, likes: 0, comments: 0, orders: 0, gmv: 0 },
        });
        return reply.send(ok({ session_id: id }));
      }
    }

    // Các API theo phiên
    const sid = Number(body.session_id ?? q.session_id);
    const s = await sessionOf(sid);
    if (!s || s.shopId !== shopId) return reply.send(fail('error_param', 'session not exist'));
    tick(s);
    switch (api) {
      case 'livestream/update_session':
        if (s.status !== 0) return reply.send(fail('error_param', 'session already started'));
        Object.assign(s, { title: body.title, description: body.description, cover: body.cover_image_url });
        return reply.send(ok({}));
      case 'livestream/get_session_detail':
        return reply.send(
          ok({
            session_id: s.id,
            title: s.title,
            description: s.description,
            cover_image_url: s.cover,
            status: s.status,
            share_url: `https://live.shopee.vn/share?from=live&session=${s.id}`,
            create_time: Math.floor(s.createdAt / 1000),
            start_time: s.startAt ? Math.floor(s.startAt / 1000) : 0,
            end_time: s.endAt ? Math.floor(s.endAt / 1000) : 0,
            stream_url_list: [{ push_url: `rtmp://127.0.0.1:1935/live`, push_key: `mock-${s.id}-${randomToken(6)}`, play_url: '', domain_id: 1 }],
          }),
        );
      case 'livestream/start_session':
        if (s.status === 2) return reply.send(fail('error_param', 'session has ended'));
        if (s.status === 0) {
          s.status = 1;
          s.startAt = Date.now();
          s.metrics.ccu = 3;
        }
        return reply.send(ok({}));
      case 'livestream/end_session':
        if (s.status === 2) return reply.send(fail('error_param', 'session has ended'));
        s.status = 2;
        s.endAt = Date.now();
        s.metrics.ccu = 0;
        return reply.send(ok({}));
      case 'livestream/get_session_metric':
        return reply.send(ok({ ...s.metrics, avg_viewing_duration: 45 + (s.metrics.views % 60) }));
      case 'livestream/add_item_list': {
        const cat = await catalogOf(shopId);
        for (const it of (body.item_list ?? []) as { item_id: number }[]) {
          const p = cat.find((x) => Number(x.item_id) === Number(it.item_id));
          if (!p) return reply.send(fail('error_param', `item ${it.item_id} not found`));
          if (!s.items.includes(Number(it.item_id))) s.items.push(Number(it.item_id));
        }
        return reply.send(ok({}));
      }
      case 'livestream/delete_item_list': {
        const ids = ((body.item_list ?? []) as { item_id: number }[]).map((x) => Number(x.item_id));
        s.items = s.items.filter((x) => !ids.includes(x));
        if (s.show && ids.includes(s.show)) s.show = null;
        return reply.send(ok({}));
      }
      case 'livestream/get_item_list': {
        const offset = Number(q.offset ?? 0);
        const size = Number(q.page_size ?? 50);
        const page = s.items.slice(offset, offset + size);
        return reply.send(ok({ item_list: page.map((id) => ({ item_id: id, shop_id: shopId })), more: offset + size < s.items.length, next_offset: offset + size }));
      }
      case 'livestream/get_item_count':
        return reply.send(ok({ total_count: s.items.length }));
      case 'livestream/get_recent_item_list':
        return reply.send(ok({ item_list: s.items.slice(-20).map((id) => ({ item_id: id, shop_id: shopId })) }));
      case 'livestream/update_show_item': {
        if (s.status !== 1) return reply.send(fail('error_param', 'session is not ongoing'));
        const id = Number(body.item?.item_id);
        if (!s.items.includes(id)) return reply.send(fail('error_param', 'item not in session item list'));
        const cat = await catalogOf(shopId);
        const p = cat.find((x) => Number(x.item_id) === id);
        if (p && Number(p.stock) <= 0) return reply.send(fail('error_param', 'item out of stock'));
        s.show = id;
        return reply.send(ok({}));
      }
      case 'livestream/get_show_item':
        return reply.send(ok({ item: s.show ? { item_id: s.show, shop_id: shopId } : null }));
      case 'livestream/post_comment':
        if (s.status !== 1) return reply.send(fail('error_param', 'session is not ongoing'));
        s.comments.push({ comment_id: `${s.id}-${s.commentSeq++}`, user_id: '0', username: 'Shop', content: String(body.comment ?? ''), create_time: Math.floor(Date.now() / 1000) });
        return reply.send(ok({}));
      case 'livestream/get_latest_comment_list': {
        const after = q.offset ? String(q.offset) : null;
        let list = s.comments.filter((c) => c.user_id !== '0');
        if (after) {
          const idx = list.findIndex((c) => c.comment_id === after);
          list = idx >= 0 ? list.slice(idx + 1) : list.slice(-20);
        } else list = list.slice(-20);
        return reply.send(ok({ comment_list: list, next_offset: list.length ? list[list.length - 1]!.comment_id : after }));
      }
    }
    return reply.code(404).send(fail('error_not_found', `API ${api} không có trong giả lập`));
  });
}

function issueTokens(shopId: number) {
  const at = `mock_at_${shopId}_${randomToken(12)}`;
  const rt = `mock_rt_${shopId}_${randomToken(12)}`;
  tokens.set(at, { shopId, exp: Date.now() + 4 * 3600 * 1000 });
  refreshTokens.set(rt, shopId);
  return { access_token: at, refresh_token: rt, expire_in: 14400, request_id: randomToken(8), error: '', message: '' };
}
