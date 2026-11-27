import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { foldVi, vnDate } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, activityLogs, memberShops, oauthStates, shopNameHistory, shops } from '../db/schema.js';
import { shopeeRedirectUrl } from '../env.js';
import { actorRef, isStaff, requireActor, requireRole, requireShop, visibleShopIds, type Actor } from '../auth/auth.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, err } from '../lib/errors.js';
import { dateStr, idOf, paginate, parse, z } from '../lib/http.js';
import { audit, type ActorRef } from '../services/audit.js';
import { resolveAlert } from '../services/alerts.js';
import { publish } from '../services/events.js';
import { startProductSync } from '../services/products.js';
import { getOpenSession, stopFeed } from '../services/sessions.js';
import { buildShopViews, filterShopViews } from '../services/shopView.js';
import * as shopee from '../services/shopee/index.js';
import { ShopeeError } from '../services/shopee/index.js';

type ShopRow = typeof shops.$inferSelect;

export async function recordName(shopId: number, kind: 'shopee' | 'alias', name: string) {
  const [last] = await db
    .select()
    .from(shopNameHistory)
    .where(and(eq(shopNameHistory.shopId, shopId), eq(shopNameHistory.kind, kind)))
    .orderBy(desc(shopNameHistory.id))
    .limit(1);
  if (last?.name !== name) await db.insert(shopNameHistory).values({ shopId, kind, name });
}

export async function refreshSearchText(shopId: number) {
  const [s] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!s) return;
  const names = await db.select({ name: shopNameHistory.name }).from(shopNameHistory).where(eq(shopNameHistory.shopId, shopId));
  const text = foldVi([s.alias, s.shopeeName, s.shopeeShopId, ...names.map((n) => n.name), ...(s.tags ?? [])].filter(Boolean).join(' '));
  await db.update(shops).set({ searchText: text }).where(eq(shops.id, shopId));
}

async function nextShopNumber(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`coalesce(max(${shops.number}), 0)` }).from(shops);
  return Number(r?.n ?? 0) + 1;
}

// ───────────── Kết nối Shopee (OAuth) ─────────────

const CONNECT_ERRORS: Record<string, string> = {
  invalid_state: 'Liên kết cấp quyền đã hết hạn hoặc đã được dùng. Vui lòng tạo liên kết mới.',
  missing_params: 'Thiếu mã cấp quyền (code) hoặc shop_id',
  main_account: 'Bạn đã cấp quyền bằng tài khoản chính (main account). Hãy đăng nhập bằng tài khoản shop rồi cấp quyền lại.',
  code_rejected: 'Shopee từ chối mã cấp quyền (mã chỉ dùng được khoảng 10 phút và một lần)',
  shop_taken: 'Shop này đang thuộc tài khoản khác trên hệ thống',
  wrong_shop: 'Bạn cấp quyền cho shop khác với shop đang cần cấp quyền lại',
  shop_suspended: 'Shop đã ngưng dịch vụ, liên hệ quản trị viên để mở lại',
  shop_limit: 'Tài khoản đã đạt số shop tối đa được phép',
  expiry_required: 'Cần nhập hạn dùng theo hợp đồng',
  expiry_past: 'Hạn dùng đã qua',
  account_expired: 'Tài khoản đã hết hạn sử dụng',
};

function connectError(code: string, status = 400) {
  return new AppError(code, CONNECT_ERRORS[code] ?? code, status);
}

async function completeConnect(input: { code?: string; shopId?: string | number; state?: string; mainAccountId?: string }) {
  if (!input.state) throw connectError('invalid_state');
  const [st] = await db.select().from(oauthStates).where(eq(oauthStates.state, input.state));
  if (!st || st.usedAt || st.expiresAt.getTime() < Date.now()) throw connectError('invalid_state');
  if (input.mainAccountId && !input.shopId) throw connectError('main_account');
  if (!input.code || !input.shopId) throw connectError('missing_params');
  const shopeeShopId = Number(input.shopId);
  if (!Number.isFinite(shopeeShopId) || shopeeShopId <= 0) throw connectError('missing_params');

  const [actorAcc] = await db.select().from(accounts).where(eq(accounts.id, st.accountId));
  if (!actorAcc || actorAcc.status !== 'active') throw connectError('invalid_state');
  const actor: ActorRef = { id: actorAcc.id, name: actorAcc.name };

  const [existing] = await db.select().from(shops).where(eq(shops.shopeeShopId, shopeeShopId));
  if (st.mode === 'reauth' && existing?.id !== st.shopId) throw connectError('wrong_shop');
  if (existing?.suspendedAt) throw connectError('shop_suspended');
  if (st.mode === 'owner' && existing && existing.ownerId !== st.ownerId) throw connectError('shop_taken');
  if (st.mode === 'owner' && !existing) {
    const [owner] = await db.select().from(accounts).where(eq(accounts.id, st.ownerId!));
    const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(shops).where(eq(shops.ownerId, st.ownerId!));
    if (owner?.shopLimit !== null && owner?.shopLimit !== undefined && Number(cnt?.n ?? 0) >= owner.shopLimit) throw connectError('shop_limit');
  }

  let tokens: shopee.TokenSet;
  try {
    tokens = await shopee.exchangeCode(input.code, shopeeShopId);
  } catch (e) {
    if (e instanceof ShopeeError && !e.retryable) throw connectError('code_rejected');
    throw e;
  }
  // Đánh dấu đã dùng ngay sau khi đổi mã thành công
  await db.update(oauthStates).set({ usedAt: new Date() }).where(eq(oauthStates.state, st.state));

  let shopRow: ShopRow;
  if (existing) {
    shopRow = existing;
  } else {
    const [created] = await db
      .insert(shops)
      .values({
        number: await nextShopNumber(),
        shopeeShopId,
        shopeeName: '',
        ownerId: st.mode === 'owner' ? st.ownerId : (st.ownerId ?? null),
        serviceExpiresOn: st.serviceExpiresOn,
        connection: 'ok',
      })
      .returning();
    shopRow = created!;
  }
  await shopee.saveTokens(shopRow.id, tokens);
  await db.update(shops).set({ connection: 'ok', connectionError: null, updatedAt: new Date() }).where(eq(shops.id, shopRow.id));
  [shopRow] = await db.select().from(shops).where(eq(shops.id, shopRow.id)) as [ShopRow];

  try {
    const info = await shopee.getShopInfo(shopRow);
    await db.update(shops).set({ shopeeName: info.shopName, region: info.region, authExpiresAt: info.authExpiresAt, lastCheckedAt: new Date() }).where(eq(shops.id, shopRow.id));
    await recordName(shopRow.id, 'shopee', info.shopName);
  } catch {
    /* tên shop sẽ cập nhật ở lần kiểm tra sau */
  }
  await refreshSearchText(shopRow.id);
  await resolveAlert(`shop_reauth:${shopRow.id}`);
  await resolveAlert(`auth_expired:${shopRow.id}`);
  await resolveAlert(`auth_expiring:${shopRow.id}`);
  await audit(actor, existing ? 'reconnected' : 'connected', { shopId: shopRow.id, params: { role: actorAcc.role } });
  if (!existing && st.serviceExpiresOn) await audit(actor, 'service_expiry_set', { shopId: shopRow.id, params: { from: 'none', to: st.serviceExpiresOn } });
  const [fresh] = await db.select().from(shops).where(eq(shops.id, shopRow.id));
  void startProductSync(fresh!, actor);
  await db.update(oauthStates).set({ result: { shopId: shopRow.id, created: !existing } }).where(eq(oauthStates.state, st.state));
  publish({ type: 'shop', shopId: shopRow.id });
  return { shopId: shopRow.id, created: !existing, shopName: fresh?.shopeeName || String(shopeeShopId) };
}

async function makeLink(actor: Actor, mode: 'admin' | 'owner' | 'reauth', extra: { shopId?: number; serviceExpiresOn?: string | null; ownerId?: number | null }) {
  const state = randomToken(18);
  const expiresAt = new Date(Date.now() + 15 * 60000);
  await db.insert(oauthStates).values({ state, accountId: actor.id, mode, shopId: extra.shopId ?? null, serviceExpiresOn: extra.serviceExpiresOn ?? null, ownerId: extra.ownerId ?? null, expiresAt });
  const redirect = `${shopeeRedirectUrl()}?state=${state}`;
  return { url: shopee.buildAuthUrl(redirect), expiresAt, state };
}

/**
 * Kiểm tra người phụ trách hợp lệ: quản trị giao cho nhân viên vận hành; chủ shop chỉ giao cho nhân viên của mình.
 * Giao cho nhân viên (member) thì tự cấp quyền truy cập shop đó.
 */
async function checkAssignee(actor: Actor, accountId: number, shopId: number) {
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!acc || acc.status !== 'active') throw err.badRequest('bad_assignee', 'Không tìm thấy người phụ trách');
  if (isStaff(actor)) {
    if (acc.role !== 'admin' && acc.role !== 'sysadmin') {
      const [shop] = await db.select({ ownerId: shops.ownerId }).from(shops).where(eq(shops.id, shopId));
      if (!(acc.role === 'member' && acc.parentId && acc.parentId === shop?.ownerId)) throw err.badRequest('bad_assignee', 'Người phụ trách phải là nhân viên vận hành hoặc nhân viên của chủ shop');
    }
  } else if (!(acc.role === 'member' && acc.parentId === actor.id) && acc.id !== actor.id) {
    throw err.forbidden('Chỉ giao cho nhân viên của bạn');
  }
  if (acc.role === 'member') await db.insert(memberShops).values({ accountId: acc.id, shopId }).onConflictDoNothing();
}

export async function shopRoutes(app: FastifyInstance) {
  // Danh sách shop (tổng quan)
  app.get('/api/shops', async (req) => {
    const a = requireActor(req);
    const q = parse(
      z.object({
        tab: z.string().optional(),
        q: z.string().optional(),
        assignee: z.string().optional(),
        owner: z.string().optional(),
        tag: z.string().optional(),
        sort: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
      }),
      req.query,
    );
    const ids = await visibleShopIds(a);
    const views = await buildShopViews(ids);
    const { items, counts } = filterShopViews(views, q);
    const tags = [...new Set(views.flatMap((v) => v.tags))].sort();
    const assignees = [...new Map(views.filter((v) => v.assignee).map((v) => [v.assignee!.id, v.assignee!])).values()];
    const owners = [...new Map(views.filter((v) => v.owner).map((v) => [v.owner!.id, v.owner!])).values()];
    return { ...paginate(items, q.page, q.pageSize), counts, tags, assignees, owners, updatedAt: new Date() };
  });

  // Gợi ý tìm shop nhanh (thanh trên cùng)
  app.get('/api/shops/suggest', async (req) => {
    const a = requireActor(req);
    const { q } = parse(z.object({ q: z.string().default('') }), req.query);
    const ids = await visibleShopIds(a);
    const f = foldVi(q);
    const rows = await db
      .select({ id: shops.id, alias: shops.alias, shopeeName: shops.shopeeName, shopeeShopId: shops.shopeeShopId, number: shops.number })
      .from(shops)
      .where(and(ids === null ? sql`true` : ids.length ? inArray(shops.id, ids) : sql`false`, f ? sql`(${shops.searchText} LIKE ${'%' + f + '%'} OR CAST(${shops.shopeeShopId} AS TEXT) LIKE ${'%' + f + '%'})` : sql`true`))
      .orderBy(shops.number)
      .limit(12);
    return { items: rows.map((r) => ({ id: r.id, name: r.alias || r.shopeeName, shopeeName: r.shopeeName, shopeeShopId: r.shopeeShopId, number: r.number })) };
  });

  app.get('/api/shops/:id', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const [view] = await buildShopViews([shop.id]);
    return {
      ...view,
      cartLimit: shop.cartLimit,
      accessExpiresAt: shop.accessExpiresAt,
      tokenRefreshedAt: shop.tokenRefreshedAt,
      lastCheckedAt: shop.lastCheckedAt,
      productSync: shop.productSync,
      replyUnmatched: shop.replyUnmatched,
      replyDisabledReason: shop.replyDisabledReason,
      commentPoll: shop.commentPoll,
      legacyId: shop.legacyId,
    };
  });

  app.patch('/api/shops/:id', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'shop.view', 'read');
    if (actor.role === 'member') throw err.forbidden();
    const body = parse(
      z.object({
        alias: z.string().trim().max(80).nullable().optional(),
        assigneeId: z.number().int().nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
        cartLimit: z.number().int().min(1).max(500).optional(),
      }),
      req.body,
    );
    const patch: Partial<ShopRow> = { updatedAt: new Date() };
    if (body.alias !== undefined) {
      patch.alias = body.alias || null;
      if (body.alias) await recordName(shop.id, 'alias', body.alias);
      await audit(actorRef(actor), body.alias ? 'alias_set' : 'alias_cleared', { shopId: shop.id, params: { alias: body.alias ?? '' } });
    }
    if (body.assigneeId !== undefined) {
      if (body.assigneeId) await checkAssignee(actor, body.assigneeId, shop.id);
      patch.assigneeId = body.assigneeId;
      await audit(actorRef(actor), 'assignee_set', { shopId: shop.id, params: { assigneeId: body.assigneeId } });
    }
    if (body.tags !== undefined) {
      patch.tags = [...new Set(body.tags)];
      await audit(actorRef(actor), 'tags_set', { shopId: shop.id, params: { tags: patch.tags } });
    }
    if (body.cartLimit !== undefined) {
      if (!isStaff(actor)) throw err.forbidden();
      patch.cartLimit = body.cartLimit;
    }
    await db.update(shops).set(patch).where(eq(shops.id, shop.id));
    await refreshSearchText(shop.id);
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/shops/:id/service-expiry', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ date: dateStr.nullable() }), req.body);
    if (body.date === null && a.role !== 'sysadmin') throw err.forbidden('Chỉ quản trị hệ thống được đặt hạn "không thời hạn"');
    await db.update(shops).set({ serviceExpiresOn: body.date, updatedAt: new Date() }).where(eq(shops.id, shop.id));
    await audit(actorRef(a), 'service_expiry_set', { shopId: shop.id, params: { from: shop.serviceExpiresOn ?? 'none', to: body.date ?? 'none' } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/shops/:id/suspend', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ reason: z.string().trim().min(1, 'Cần ghi lý do').max(300) }), req.body);
    const open = await getOpenSession(shop.id);
    if (open && open.streamState !== 'idle' && open.streamState !== 'stopped') await stopFeed(actorRef(a), open, 'Ngưng dịch vụ').catch(() => {});
    await db.update(shops).set({ suspendedAt: new Date(), suspendReason: body.reason, replyEnabled: false }).where(eq(shops.id, shop.id));
    await audit(actorRef(a), 'suspended', { shopId: shop.id, params: { reason: body.reason } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/shops/:id/reopen', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ serviceExpiresOn: dateStr }), req.body);
    if (body.serviceExpiresOn < vnDate()) throw connectError('expiry_past');
    await db.update(shops).set({ suspendedAt: null, suspendReason: null, serviceExpiresOn: body.serviceExpiresOn }).where(eq(shops.id, shop.id));
    await audit(actorRef(a), 'reopened', { shopId: shop.id, params: { to: body.serviceExpiresOn } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  // Gắn shop cho chủ shop (bắt buộc ghi cách xác minh)
  app.post('/api/shops/:id/owner', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ ownerId: z.number().int().nullable(), verification: z.string().trim().max(300).optional() }), req.body);
    if (body.ownerId) {
      if (!body.verification) throw err.badRequest('verification_required', 'Bắt buộc ghi cách xác minh chủ shop (vd: gọi đúng số đăng ký trên Shopee)');
      const [owner] = await db.select().from(accounts).where(eq(accounts.id, body.ownerId));
      if (!owner || owner.role !== 'owner') throw err.badRequest('bad_owner', 'Tài khoản không phải chủ shop');
      const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(shops).where(eq(shops.ownerId, owner.id));
      if (owner.shopLimit !== null && Number(cnt?.n ?? 0) >= owner.shopLimit && shop.ownerId !== owner.id) throw connectError('shop_limit');
      await db.update(shops).set({ ownerId: owner.id, serviceExpiresOn: owner.serviceExpiresOn ?? shop.serviceExpiresOn }).where(eq(shops.id, shop.id));
    } else {
      await db.update(shops).set({ ownerId: null, assigneeId: null }).where(eq(shops.id, shop.id));
    }
    await audit(actorRef(a), 'owner_set', { shopId: shop.id, targetAccountId: body.ownerId, params: { ownerId: body.ownerId, verification: body.verification ?? null } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  // Kiểm tra kết nối: 2 lệnh đọc nhẹ
  app.post('/api/shops/:id/check', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'shop.view', 'read');
    const result: { shop: { ok: boolean; message?: string }; product: { ok: boolean; message?: string }; authExpiresAt: Date | null } = {
      shop: { ok: false },
      product: { ok: false },
      authExpiresAt: shop.authExpiresAt,
    };
    try {
      const info = await shopee.getShopInfo(shop);
      result.shop = { ok: true, message: info.shopName };
      result.authExpiresAt = info.authExpiresAt;
      await db.update(shops).set({ shopeeName: info.shopName, authExpiresAt: info.authExpiresAt, lastCheckedAt: new Date() }).where(eq(shops.id, shop.id));
      if (info.shopName && info.shopName !== shop.shopeeName) {
        await recordName(shop.id, 'shopee', info.shopName);
        await refreshSearchText(shop.id);
      }
    } catch (e) {
      result.shop = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    try {
      await shopee.getItemIdPage(shop, 0, 1);
      result.product = { ok: true };
    } catch (e) {
      result.product = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    if (result.shop.ok && result.product.ok && shop.connection !== 'ok') {
      await db.update(shops).set({ connection: 'ok', connectionError: null }).where(eq(shops.id, shop.id));
      await resolveAlert(`shop_reauth:${shop.id}`);
    }
    void actor;
    publish({ type: 'shop', shopId: shop.id });
    return result;
  });

  app.get('/api/shops/:id/activity', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const items = await db.select().from(activityLogs).where(eq(activityLogs.shopId, shop.id)).orderBy(desc(activityLogs.at)).limit(300);
    return { items };
  });

  app.get('/api/shops/:id/names', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const items = await db.select().from(shopNameHistory).where(eq(shopNameHistory.shopId, shop.id)).orderBy(desc(shopNameHistory.at));
    return { items };
  });

  // Thao tác hàng loạt theo quyền
  app.post('/api/shops/bulk', async (req) => {
    const a = requireActor(req);
    const body = parse(
      z.object({
        ids: z.array(z.number().int()).min(1).max(1000),
        action: z.enum(['assign', 'tags_add', 'tags_remove', 'expiry', 'stop_feed', 'sync_products', 'reply_on', 'reply_off']),
        value: z.any().optional(),
      }),
      req.body,
    );
    const visible = await visibleShopIds(a);
    const ids = visible === null ? body.ids : body.ids.filter((id) => visible.includes(id));
    const rows = ids.length ? await db.select().from(shops).where(inArray(shops.id, ids)) : [];
    const results: { id: number; ok: boolean; message?: string }[] = [];
    for (const shop of rows) {
      try {
        switch (body.action) {
          case 'assign':
            if (a.role === 'member') throw err.forbidden();
            if (body.value) await checkAssignee(a, Number(body.value), shop.id);
            await db.update(shops).set({ assigneeId: body.value ?? null }).where(eq(shops.id, shop.id));
            await audit(actorRef(a), 'assignee_set', { shopId: shop.id, params: { assigneeId: body.value ?? null } });
            break;
          case 'tags_add':
          case 'tags_remove': {
            if (a.role === 'member') throw err.forbidden();
            const tag = String(body.value ?? '').trim().slice(0, 30);
            if (!tag) throw err.badRequest('tag_required', 'Thiếu tên nhóm');
            const tags = body.action === 'tags_add' ? [...new Set([...shop.tags, tag])] : shop.tags.filter((t) => t !== tag);
            await db.update(shops).set({ tags }).where(eq(shops.id, shop.id));
            await refreshSearchText(shop.id);
            break;
          }
          case 'expiry':
            if (!isStaff(a)) throw err.forbidden();
            if (body.value === null && a.role !== 'sysadmin') throw err.forbidden();
            await db.update(shops).set({ serviceExpiresOn: body.value }).where(eq(shops.id, shop.id));
            await audit(actorRef(a), 'service_expiry_set', { shopId: shop.id, params: { from: shop.serviceExpiresOn ?? 'none', to: body.value ?? 'none' } });
            break;
          case 'stop_feed': {
            if (a.role === 'member' && !a.permissions.includes('session.control')) throw err.forbidden();
            const open = await getOpenSession(shop.id);
            if (open) await stopFeed(actorRef(a), open, 'Dừng hàng loạt');
            break;
          }
          case 'sync_products':
            if (a.role === 'member' && !a.permissions.includes('product.manage')) throw err.forbidden();
            if (shop.connection === 'ok' || shop.connection === 'expiring') await startProductSync(shop, actorRef(a));
            else throw err.conflict('shop_disconnected', 'Shop chưa kết nối');
            break;
          case 'reply_on':
          case 'reply_off':
            if (a.role === 'member' && !a.permissions.includes('comment.reply')) throw err.forbidden();
            await db.update(shops).set({ replyEnabled: body.action === 'reply_on', ...(body.action === 'reply_on' ? { replyDisabledReason: null } : {}) }).where(eq(shops.id, shop.id));
            await audit(actorRef(a), 'reply_settings', { shopId: shop.id, params: { enabled: body.action === 'reply_on' } });
            break;
        }
        results.push({ id: shop.id, ok: true });
        publish({ type: 'shop', shopId: shop.id });
      } catch (e) {
        results.push({ id: shop.id, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  });

  // ───── Kết nối ─────
  app.post('/api/connect/link', async (req) => {
    const a = requireActor(req);
    if (a.role === 'member' && !a.permissions.includes('shop.connect')) throw err.forbidden();
    const body = parse(z.object({ serviceExpiresOn: dateStr.nullable().optional(), ownerId: z.number().int().nullable().optional() }), req.body);
    if (isStaff(a)) {
      if (body.serviceExpiresOn === undefined) throw connectError('expiry_required');
      if (body.serviceExpiresOn === null && a.role !== 'sysadmin') throw connectError('expiry_required');
      if (body.serviceExpiresOn && body.serviceExpiresOn < vnDate()) throw connectError('expiry_past');
      if (body.ownerId) {
        const [o] = await db.select().from(accounts).where(eq(accounts.id, body.ownerId));
        if (!o || o.role !== 'owner') throw err.badRequest('bad_owner', 'Tài khoản không phải chủ shop');
      }
      return makeLink(a, 'admin', { serviceExpiresOn: body.serviceExpiresOn ?? null, ownerId: body.ownerId ?? null });
    }
    const ownerId = a.role === 'owner' ? a.id : a.parentId!;
    const [owner] = await db.select().from(accounts).where(eq(accounts.id, ownerId));
    if (owner?.serviceExpiresOn && owner.serviceExpiresOn < vnDate()) throw connectError('account_expired');
    const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(shops).where(eq(shops.ownerId, ownerId));
    if (owner?.shopLimit !== null && owner?.shopLimit !== undefined && Number(cnt?.n ?? 0) >= owner.shopLimit) throw connectError('shop_limit');
    return makeLink(a, 'owner', { ownerId, serviceExpiresOn: owner?.serviceExpiresOn ?? null });
  });

  app.post('/api/connect/reauth', async (req) => {
    const body = parse(z.object({ shopId: z.number().int() }), req.body);
    const { actor, shop } = await requireShop(req, body.shopId, 'shop.connect', 'read');
    if (shop.suspendedAt) throw connectError('shop_suspended');
    return makeLink(actor, 'reauth', { shopId: shop.id, ownerId: shop.ownerId, serviceExpiresOn: shop.serviceExpiresOn });
  });

  // Trang chuyển về sau khi chủ shop đồng ý (không cần đăng nhập — xác thực bằng state dùng một lần)
  app.post('/api/connect/callback', { config: { rateLimit: true } }, async (req) => {
    const body = parse(z.object({ code: z.string().optional(), shop_id: z.union([z.string(), z.number()]).optional(), state: z.string().optional(), main_account_id: z.string().optional() }), req.body);
    return completeConnect({ code: body.code, shopId: body.shop_id, state: body.state, mainAccountId: body.main_account_id });
  });

  // Dán địa chỉ có code + shop_id (+ state)
  app.post('/api/connect/paste', async (req) => {
    const a = requireActor(req);
    if (a.role === 'member' && !a.permissions.includes('shop.connect')) throw err.forbidden();
    const body = parse(z.object({ url: z.string().min(10).max(2000), serviceExpiresOn: dateStr.nullable().optional(), ownerId: z.number().int().nullable().optional(), shopId: z.number().int().optional() }), req.body);
    let u: URL;
    try {
      u = new URL(body.url.trim());
    } catch {
      throw connectError('missing_params');
    }
    let state = u.searchParams.get('state') ?? undefined;
    // Cấp quyền từ Console (không có state): tạo state tạm theo thông tin nhập trong hộp thoại
    if (!state) {
      if (body.shopId) {
        const { shop } = await requireShop(req, body.shopId, 'shop.connect', 'read');
        state = (await makeLink(a, 'reauth', { shopId: shop.id, ownerId: shop.ownerId, serviceExpiresOn: shop.serviceExpiresOn })).state;
      } else if (isStaff(a)) {
        if (body.serviceExpiresOn === undefined || (body.serviceExpiresOn === null && a.role !== 'sysadmin')) throw connectError('expiry_required');
        state = (await makeLink(a, 'admin', { serviceExpiresOn: body.serviceExpiresOn, ownerId: body.ownerId ?? null })).state;
      } else {
        const ownerId = a.role === 'owner' ? a.id : a.parentId!;
        const [owner] = await db.select().from(accounts).where(eq(accounts.id, ownerId));
        state = (await makeLink(a, 'owner', { ownerId, serviceExpiresOn: owner?.serviceExpiresOn ?? null })).state;
      }
    }
    return completeConnect({
      code: u.searchParams.get('code') ?? undefined,
      shopId: u.searchParams.get('shop_id') ?? undefined,
      state,
      mainAccountId: u.searchParams.get('main_account_id') ?? undefined,
    });
  });

  app.get('/api/connect/status', async (req) => {
    requireActor(req);
    const { state } = parse(z.object({ state: z.string() }), req.query);
    const [st] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
    if (!st) throw err.notFound();
    return { used: Boolean(st.usedAt), expired: st.expiresAt.getTime() < Date.now(), result: st.result };
  });

  // Theo dõi tên shop (sysadmin): tìm theo tên cũ vẫn ra đúng shop
  app.get('/api/shop-names', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const { q } = parse(z.object({ q: z.string().default('') }), req.query);
    const f = foldVi(q);
    const rows = await db
      .select({ shopId: shopNameHistory.shopId, kind: shopNameHistory.kind, name: shopNameHistory.name, at: shopNameHistory.at, alias: shops.alias, shopeeName: shops.shopeeName, shopeeShopId: shops.shopeeShopId })
      .from(shopNameHistory)
      .innerJoin(shops, eq(shops.id, shopNameHistory.shopId))
      .orderBy(desc(shopNameHistory.at))
      .limit(2000);
    const filtered = f ? rows.filter((r) => foldVi(r.name).includes(f) || foldVi(r.shopeeName).includes(f) || String(r.shopeeShopId).includes(f)) : rows;
    return { items: filtered.slice(0, 500) };
  });

}
