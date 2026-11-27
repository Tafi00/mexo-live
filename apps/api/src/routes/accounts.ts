import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { PERMISSIONS, vnDate, type Role } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, activityLogs, memberShops, shops } from '../db/schema.js';
import { actorRef, isStaff, requireActor, revokeAllLogins, type Actor } from '../auth/auth.js';
import { hashPassword, tempPassword } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import { dateStr, idOf, parse, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { refreshSearchText } from './shops.js';

type AccountRow = typeof accounts.$inferSelect;

const USERNAME = z
  .string()
  .trim()
  .min(3, 'Tên đăng nhập 3–64 ký tự')
  .max(64)
  .regex(/^[a-zA-Z0-9._@-]+$/, 'Tên đăng nhập chỉ gồm chữ, số và . _ @ -');

/** Actor có được quản lý tài khoản đích không */
function canManage(a: Actor, target: AccountRow): boolean {
  if (a.id === target.id) return false;
  if (a.role === 'sysadmin') return true;
  if (a.role === 'admin') return target.role === 'owner' || target.role === 'member';
  if (a.role === 'owner') return target.role === 'member' && target.parentId === a.id;
  return false;
}

function canCreateRole(a: Actor, role: Role): boolean {
  // Nhân viên (member) luôn thuộc một chủ shop → chỉ chủ shop tạo được
  if (a.role === 'sysadmin') return role !== 'member';
  if (a.role === 'admin') return role === 'owner';
  if (a.role === 'owner') return role === 'member';
  return false;
}

async function loadTarget(a: Actor, id: number): Promise<AccountRow> {
  const [t] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!t) throw err.notFound('Không tìm thấy tài khoản');
  if (a.role === 'owner' && !(t.role === 'member' && t.parentId === a.id) && t.id !== a.id) throw err.notFound('Không tìm thấy tài khoản');
  if (a.role === 'member') throw err.forbidden();
  return t;
}

async function activeSysadminCount(excludeId?: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(accounts)
    .where(and(eq(accounts.role, 'sysadmin'), eq(accounts.status, 'active'), excludeId ? sql`${accounts.id} <> ${excludeId}` : sql`true`));
  return Number(r?.n ?? 0);
}

async function accountDto(rows: AccountRow[], a: Actor) {
  const ids = rows.map((r) => r.id);
  const owned = ids.length ? await db.select({ ownerId: shops.ownerId, n: sql<number>`count(*)` }).from(shops).where(inArray(shops.ownerId, ids)).groupBy(shops.ownerId) : [];
  const ownedMap = new Map(owned.map((o) => [o.ownerId, Number(o.n)]));
  const assigned = ids.length ? await db.select({ accountId: memberShops.accountId, shopId: memberShops.shopId }).from(memberShops).where(inArray(memberShops.accountId, ids)) : [];
  const parents = [...new Set(rows.map((r) => r.parentId).filter(Boolean))] as number[];
  const parentRows = parents.length ? await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(inArray(accounts.id, parents)) : [];
  const pmap = new Map(parentRows.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    status: r.status,
    parentId: r.parentId,
    parentName: r.parentId ? pmap.get(r.parentId) ?? null : null,
    permissions: r.permissions,
    shopLimit: r.shopLimit,
    concurrentLimit: r.concurrentLimit,
    storageQuotaBytes: r.storageQuotaBytes,
    serviceExpiresOn: r.serviceExpiresOn,
    shopCount: r.role === 'owner' ? ownedMap.get(r.id) ?? 0 : assigned.filter((x) => x.accountId === r.id).length,
    shopIds: r.role === 'member' ? assigned.filter((x) => x.accountId === r.id).map((x) => x.shopId) : undefined,
    mustChangePassword: r.mustChangePassword,
    lastLoginAt: r.lastLoginAt,
    lockedUntil: r.lockedUntil,
    note: r.note,
    createdAt: r.createdAt,
    isSelf: r.id === a.id,
    canEdit: canManage(a, r),
  }));
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async (req) => {
    const a = requireActor(req);
    if (a.role === 'member') throw err.forbidden();
    let rows: AccountRow[];
    if (a.role === 'owner') rows = await db.select().from(accounts).where(or(eq(accounts.parentId, a.id), eq(accounts.id, a.id))).orderBy(accounts.id);
    else rows = await db.select().from(accounts).orderBy(accounts.id);
    const items = await accountDto(rows, a);
    return {
      items,
      counts: {
        all: items.length,
        sysadmin: items.filter((i) => i.role === 'sysadmin').length,
        admin: items.filter((i) => i.role === 'admin').length,
        owner: items.filter((i) => i.role === 'owner').length,
        member: items.filter((i) => i.role === 'member').length,
        locked: items.filter((i) => i.status !== 'active').length,
      },
      canCreate: (['sysadmin', 'admin', 'owner', 'member'] as Role[]).filter((r) => canCreateRole(a, r)),
    };
  });

  app.post('/api/accounts', async (req) => {
    const a = requireActor(req);
    const limits = await getSetting('limits');
    const body = parse(
      z.object({
        username: USERNAME,
        name: z.string().trim().min(1).max(80),
        email: z.string().email().max(120).nullable().optional(),
        phone: z.string().max(20).nullable().optional(),
        role: z.enum(['sysadmin', 'admin', 'owner', 'member']),
        permissions: z.array(z.enum(PERMISSIONS)).optional(),
        shopIds: z.array(z.number().int()).optional(),
        shopLimit: z.number().int().min(0).max(10000).nullable().optional(),
        concurrentLimit: z.number().int().min(0).max(10000).nullable().optional(),
        storageQuotaGb: z.number().min(0).max(100000).nullable().optional(),
        serviceExpiresOn: dateStr.nullable().optional(),
        note: z.string().max(500).optional(),
      }),
      req.body,
    );
    if (!canCreateRole(a, body.role)) throw err.forbidden('Bạn không được tạo tài khoản vai trò này');
    const [dup] = await db.select({ id: accounts.id }).from(accounts).where(eq(sql`lower(${accounts.username})`, body.username.toLowerCase()));
    if (dup) throw err.conflict('username_taken', 'Tên đăng nhập đã tồn tại');
    if (body.role === 'owner' && body.serviceExpiresOn === undefined) throw err.badRequest('expiry_required', 'Cần nhập hạn dùng cho tài khoản chủ shop');
    if (body.role === 'owner' && body.serviceExpiresOn === null && a.role !== 'sysadmin') throw err.forbidden('Chỉ quản trị hệ thống được đặt "không thời hạn"');
    const pwd = tempPassword();
    const [row] = await db
      .insert(accounts)
      .values({
        username: body.username,
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        role: body.role,
        passwordHash: hashPassword(pwd),
        mustChangePassword: true,
        parentId: body.role === 'member' ? (a.role === 'owner' ? a.id : null) : null,
        permissions: body.role === 'member' ? (body.permissions ?? ['shop.view']) : [],
        shopLimit: body.role === 'owner' ? (body.shopLimit ?? limits.defaultShopLimit) : null,
        concurrentLimit: body.role === 'owner' ? (body.concurrentLimit ?? limits.defaultConcurrentLimit) : null,
        storageQuotaBytes: body.role === 'owner' ? Math.round((body.storageQuotaGb ?? limits.defaultStorageQuotaGb) * 1024 ** 3) : null,
        serviceExpiresOn: body.role === 'owner' ? (body.serviceExpiresOn ?? null) : null,
        note: body.note ?? null,
      })
      .returning();
    if (body.role === 'member' && body.shopIds?.length) {
      const own = await db.select({ id: shops.id }).from(shops).where(and(inArray(shops.id, body.shopIds), eq(shops.ownerId, a.id)));
      if (own.length) await db.insert(memberShops).values(own.map((s) => ({ accountId: row!.id, shopId: s.id })));
    }
    await audit(actorRef(a), 'account_created', { targetAccountId: row!.id, params: { username: body.username, role: body.role } });
    return { id: row!.id, tempPassword: pwd };
  });

  app.patch('/api/accounts/:id', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    if (!canManage(a, t)) throw err.forbidden();
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        email: z.string().email().max(120).nullable().optional(),
        phone: z.string().max(20).nullable().optional(),
        permissions: z.array(z.enum(PERMISSIONS)).optional(),
        shopLimit: z.number().int().min(0).max(10000).nullable().optional(),
        concurrentLimit: z.number().int().min(0).max(10000).nullable().optional(),
        storageQuotaGb: z.number().min(0).max(100000).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
      }),
      req.body,
    );
    const patch: Partial<AccountRow> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.email !== undefined) patch.email = body.email;
    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.note !== undefined) patch.note = body.note;
    if (body.permissions !== undefined && t.role === 'member') patch.permissions = body.permissions;
    if (t.role === 'owner' && isStaff(a)) {
      if (body.shopLimit !== undefined) {
        patch.shopLimit = body.shopLimit;
        await audit(actorRef(a), 'shop_limit_set', { targetAccountId: t.id, params: { from: t.shopLimit, to: body.shopLimit } });
      }
      if (body.concurrentLimit !== undefined) patch.concurrentLimit = body.concurrentLimit;
      if (body.storageQuotaGb !== undefined) patch.storageQuotaBytes = body.storageQuotaGb === null ? null : Math.round(body.storageQuotaGb * 1024 ** 3);
    }
    await db.update(accounts).set(patch).where(eq(accounts.id, t.id));
    await audit(actorRef(a), 'account_updated', { targetAccountId: t.id, params: { fields: Object.keys(body) } });
    return { ok: true };
  });

  app.post('/api/accounts/:id/lock', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    if (!canManage(a, t)) throw err.forbidden('Không thao tác được trên tài khoản này');
    if (t.role === 'sysadmin' && (await activeSysadminCount(t.id)) < 1) throw err.conflict('last_sysadmin', 'Hệ thống phải còn ít nhất 1 quản trị hệ thống đang hoạt động');
    await db.update(accounts).set({ status: 'locked', updatedAt: new Date() }).where(eq(accounts.id, t.id));
    await revokeAllLogins(t.id);
    await audit(actorRef(a), 'account_locked', { targetAccountId: t.id });
    return { ok: true };
  });

  app.post('/api/accounts/:id/unlock', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    if (!canManage(a, t)) throw err.forbidden();
    await db.update(accounts).set({ status: 'active', failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(accounts.id, t.id));
    await audit(actorRef(a), 'account_unlocked', { targetAccountId: t.id });
    return { ok: true };
  });

  app.post('/api/accounts/:id/reset-password', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    if (!canManage(a, t)) throw err.forbidden('Không đặt lại mật khẩu cho chính mình tại đây — dùng Đổi mật khẩu');
    const pwd = tempPassword();
    await db.update(accounts).set({ passwordHash: hashPassword(pwd), mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(accounts.id, t.id));
    await revokeAllLogins(t.id);
    await audit(actorRef(a), 'password_reset', { targetAccountId: t.id });
    return { tempPassword: pwd };
  });

  app.post('/api/accounts/:id/role', async (req) => {
    const a = requireActor(req);
    if (a.role !== 'sysadmin') throw err.forbidden('Chỉ quản trị hệ thống được đổi vai trò');
    const t = await loadTarget(a, idOf(req.params));
    if (t.id === a.id) throw err.forbidden('Không đổi vai trò của chính mình');
    const body = parse(z.object({ role: z.enum(['sysadmin', 'admin', 'owner']) }), req.body);
    if (t.role === 'sysadmin' && body.role !== 'sysadmin' && (await activeSysadminCount(t.id)) < 1) throw err.conflict('last_sysadmin', 'Hệ thống phải còn ít nhất 1 quản trị hệ thống');
    if (t.role === 'member') throw err.badRequest('member_role', 'Không đổi vai trò tài khoản nhân viên');
    const leavingOwner = t.role === 'owner' && body.role !== 'owner';
    await db.update(accounts).set({ role: body.role, updatedAt: new Date(), ...(body.role === 'owner' ? { shopLimit: 10, concurrentLimit: 10 } : {}) }).where(eq(accounts.id, t.id));
    if (leavingOwner) await db.update(shops).set({ ownerId: null }).where(eq(shops.ownerId, t.id));
    await revokeAllLogins(t.id);
    await audit(actorRef(a), 'role_changed', { targetAccountId: t.id, params: { from: t.role, to: body.role } });
    return { ok: true };
  });

  // Gia hạn tài khoản chủ shop → áp cho mọi shop đang gắn
  app.post('/api/accounts/:id/service-expiry', async (req) => {
    const a = requireActor(req);
    if (!isStaff(a)) throw err.forbidden();
    const t = await loadTarget(a, idOf(req.params));
    if (t.role !== 'owner') throw err.badRequest('not_owner', 'Chỉ gia hạn tài khoản chủ shop');
    const body = parse(z.object({ date: dateStr.nullable() }), req.body);
    if (body.date === null && a.role !== 'sysadmin') throw err.forbidden('Chỉ quản trị hệ thống được đặt "không thời hạn"');
    if (body.date && body.date < vnDate()) throw err.badRequest('expiry_past', 'Hạn dùng đã qua');
    await db.update(accounts).set({ serviceExpiresOn: body.date }).where(eq(accounts.id, t.id));
    const owned = await db.update(shops).set({ serviceExpiresOn: body.date }).where(eq(shops.ownerId, t.id)).returning({ id: shops.id });
    for (const s of owned) await audit(actorRef(a), 'service_expiry_set', { shopId: s.id, params: { to: body.date ?? 'none', via: 'account' } });
    await audit(actorRef(a), 'account_expiry_set', { targetAccountId: t.id, params: { from: t.serviceExpiresOn, to: body.date, shops: owned.length } });
    return { ok: true, shops: owned.length };
  });

  // Giao shop cho nhân viên (chủ shop) hoặc gắn shop cho chủ shop (quản trị)
  app.put('/api/accounts/:id/shops', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    if (!canManage(a, t)) throw err.forbidden();
    const body = parse(z.object({ shopIds: z.array(z.number().int()).max(5000), verification: z.string().max(300).optional() }), req.body);
    if (t.role === 'member') {
      const ownerId = t.parentId;
      const valid = body.shopIds.length ? await db.select({ id: shops.id }).from(shops).where(and(inArray(shops.id, body.shopIds), eq(shops.ownerId, ownerId ?? -1))) : [];
      await db.delete(memberShops).where(eq(memberShops.accountId, t.id));
      if (valid.length) await db.insert(memberShops).values(valid.map((s) => ({ accountId: t.id, shopId: s.id })));
      await audit(actorRef(a), 'shops_assigned', { targetAccountId: t.id, params: { count: valid.length } });
      return { ok: true, count: valid.length };
    }
    if (t.role === 'owner') {
      if (!isStaff(a)) throw err.forbidden();
      const current = await db.select({ id: shops.id }).from(shops).where(eq(shops.ownerId, t.id));
      const added = body.shopIds.filter((id) => !current.some((c) => c.id === id));
      if (added.length && !body.verification?.trim()) throw err.badRequest('verification_required', 'Bắt buộc ghi cách xác minh chủ shop khi gắn shop thủ công');
      if (t.shopLimit !== null && body.shopIds.length > t.shopLimit) throw err.conflict('shop_limit', `Vượt số shop tối đa (${t.shopLimit})`);
      const taken = added.length ? await db.select({ id: shops.id, ownerId: shops.ownerId }).from(shops).where(inArray(shops.id, added)) : [];
      const conflict = taken.find((s) => s.ownerId && s.ownerId !== t.id);
      if (conflict) throw err.conflict('shop_taken', 'Có shop đang thuộc chủ shop khác — hãy gỡ khỏi chủ cũ trước');
      await db.update(shops).set({ ownerId: null, assigneeId: null }).where(and(eq(shops.ownerId, t.id), body.shopIds.length ? sql`${shops.id} NOT IN (${sql.join(body.shopIds.map((x) => sql`${x}`), sql`, `)})` : sql`true`));
      if (body.shopIds.length) await db.update(shops).set({ ownerId: t.id, ...(t.serviceExpiresOn ? { serviceExpiresOn: t.serviceExpiresOn } : {}) }).where(inArray(shops.id, body.shopIds));
      for (const id of body.shopIds) await refreshSearchText(id);
      await audit(actorRef(a), 'shops_assigned', { targetAccountId: t.id, params: { count: body.shopIds.length, added: added.length, verification: body.verification ?? null } });
      return { ok: true, count: body.shopIds.length };
    }
    throw err.badRequest('bad_role', 'Tài khoản này không gắn shop');
  });

  app.delete('/api/accounts/:id', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    if (!canManage(a, t)) throw err.forbidden();
    if (t.role === 'sysadmin' && (await activeSysadminCount(t.id)) < 1) throw err.conflict('last_sysadmin', 'Hệ thống phải còn ít nhất 1 quản trị hệ thống');
    if (t.role === 'owner') {
      const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(shops).where(eq(shops.ownerId, t.id));
      if (Number(cnt?.n ?? 0) > 0) throw err.conflict('has_shops', 'Tài khoản đang gắn shop. Hãy gỡ shop hoặc khóa tài khoản thay vì xóa.');
      const members = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.parentId, t.id));
      if (members.length) throw err.conflict('has_members', 'Tài khoản còn nhân viên. Hãy xóa nhân viên trước.');
    }
    await revokeAllLogins(t.id);
    await db.delete(memberShops).where(eq(memberShops.accountId, t.id));
    await db.delete(accounts).where(eq(accounts.id, t.id));
    await db.update(shops).set({ assigneeId: null }).where(eq(shops.assigneeId, t.id));
    await audit(actorRef(a), 'account_deleted', { targetAccountId: t.id, params: { username: t.username } });
    return { ok: true };
  });

  app.get('/api/accounts/:id/activity', async (req) => {
    const a = requireActor(req);
    const t = await loadTarget(a, idOf(req.params));
    const items = await db
      .select()
      .from(activityLogs)
      .where(or(eq(activityLogs.targetAccountId, t.id), eq(activityLogs.actorId, t.id)))
      .orderBy(desc(activityLogs.at))
      .limit(300);
    return { items };
  });
}
