import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { PERMISSIONS, type Permission, type Role, vnDate } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, authSessions, memberShops, shops } from '../db/schema.js';
import { env } from '../env.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import type { ActorRef } from '../services/audit.js';

export const COOKIE = 'mexo_sid';

export interface Actor {
  id: number;
  username: string;
  name: string;
  role: Role;
  parentId: number | null;
  permissions: Permission[];
  mustChangePassword: boolean;
  sessionId: string;
  ip: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export function actorRef(a: Actor): ActorRef {
  return { id: a.id, name: a.name, ip: a.ip };
}

export async function createLogin(reply: FastifyReply, req: FastifyRequest, accountId: number): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 86400000);
  await db.insert(authSessions).values({
    id: sha256(token),
    accountId,
    expiresAt,
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
  });
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Sau proxy HTTPS (Traefik) req.protocol lấy từ X-Forwarded-Proto; truy cập http thì không gắn Secure để vẫn đăng nhập được
    secure: env.cookieSecure && req.protocol === 'https',
    expires: expiresAt,
  });
}

export async function destroyLogin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[COOKIE];
  if (token) await db.delete(authSessions).where(eq(authSessions.id, sha256(token)));
  reply.clearCookie(COOKIE, { path: '/' });
}

/** Đăng xuất mọi thiết bị của tài khoản (trừ phiên hiện tại nếu truyền vào) */
export async function revokeAllLogins(accountId: number, exceptSessionId?: string): Promise<void> {
  const all = await db.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.accountId, accountId));
  const ids = all.map((r) => r.id).filter((id) => id !== exceptSessionId);
  if (ids.length) await db.delete(authSessions).where(inArray(authSessions.id, ids));
}

/** Hook: đọc cookie → nạp actor */
export async function loadActor(req: FastifyRequest): Promise<void> {
  const token = req.cookies?.[COOKIE];
  if (!token) return;
  const sid = sha256(token);
  const [row] = await db
    .select({ s: authSessions, a: accounts })
    .from(authSessions)
    .innerJoin(accounts, eq(accounts.id, authSessions.accountId))
    .where(and(eq(authSessions.id, sid), gt(authSessions.expiresAt, new Date())));
  if (!row || row.a.status !== 'active') return;
  // Nhân viên: chủ shop bị khóa thì nhân viên cũng không vào được
  if (row.a.role === 'member' && row.a.parentId) {
    const [parent] = await db.select({ status: accounts.status }).from(accounts).where(eq(accounts.id, row.a.parentId));
    if (!parent || parent.status !== 'active') return;
  }
  const now = Date.now();
  if (now - row.s.lastSeenAt.getTime() > 5 * 60000) {
    await db
      .update(authSessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(now + env.sessionTtlDays * 86400000) })
      .where(eq(authSessions.id, sid));
  }
  const role = row.a.role as Role;
  req.actor = {
    id: row.a.id,
    username: row.a.username,
    name: row.a.name,
    role,
    parentId: row.a.parentId,
    permissions: role === 'member' ? ((row.a.permissions ?? []) as Permission[]) : [...PERMISSIONS],
    mustChangePassword: row.a.mustChangePassword,
    sessionId: sid,
    ip: req.ip,
  };
}

export async function purgeExpiredLogins(): Promise<void> {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}

// ───────────── Guards ─────────────

export function requireActor(req: FastifyRequest, opts: { allowMustChange?: boolean } = {}): Actor {
  const a = req.actor;
  if (!a) throw err.unauthorized();
  if (a.mustChangePassword && !opts.allowMustChange) throw err.forbidden('Bạn cần đổi mật khẩu trước khi tiếp tục');
  return a;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): Actor {
  const a = requireActor(req);
  if (!roles.includes(a.role)) throw err.forbidden();
  return a;
}

export const isStaff = (a: Actor) => a.role === 'sysadmin' || a.role === 'admin';

/** Chủ sở hữu dữ liệu (tenant) của actor: owner → chính họ, member → owner cha */
export function tenantOf(a: Actor): number | null {
  if (a.role === 'owner') return a.id;
  if (a.role === 'member') return a.parentId;
  return null;
}

/** Danh sách shop actor được thấy. null = tất cả */
export async function visibleShopIds(a: Actor, perm?: Permission): Promise<number[] | null> {
  if (isStaff(a)) return null;
  if (a.role === 'owner') {
    const r = await db.select({ id: shops.id }).from(shops).where(eq(shops.ownerId, a.id));
    return r.map((x) => x.id);
  }
  if (perm && !a.permissions.includes(perm)) return [];
  if (!a.permissions.includes('shop.view')) return [];
  const r = await db
    .select({ id: shops.id })
    .from(memberShops)
    .innerJoin(shops, eq(shops.id, memberShops.shopId))
    .where(and(eq(memberShops.accountId, a.id), eq(shops.ownerId, a.parentId ?? -1)));
  return r.map((x) => x.id);
}

export type ShopRow = typeof shops.$inferSelect;

export type ShopMode = 'read' | 'write' | 'end';

export function shopServiceState(shop: Pick<ShopRow, 'serviceExpiresOn' | 'suspendedAt'>, expiringDays = 7) {
  if (shop.suspendedAt) return { state: 'suspended' as const, daysLeft: null as number | null };
  if (!shop.serviceExpiresOn) return { state: 'active' as const, daysLeft: null as number | null };
  const today = vnDate();
  const daysLeft = Math.round((Date.parse(shop.serviceExpiresOn + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  if (daysLeft < 0) return { state: 'expired' as const, daysLeft };
  if (daysLeft <= expiringDays) return { state: 'expiring' as const, daysLeft };
  return { state: 'active' as const, daysLeft };
}

/**
 * Kiểm tra quyền trên 1 shop (tại backend). mode:
 * - read: xem dữ liệu (vẫn được khi hết hạn; chủ shop không vào được shop đã ngưng)
 * - write: thao tác (cần còn hạn, chưa ngưng)
 * - end: kết thúc phiên (được phép cả khi hết hạn)
 */
export async function requireShop(req: FastifyRequest, shopId: number, perm: Permission = 'shop.view', mode: ShopMode = 'read'): Promise<{ actor: Actor; shop: ShopRow }> {
  const actor = requireActor(req);
  if (!Number.isInteger(shopId)) throw err.notFound('Không tìm thấy shop');
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
  if (!shop) throw err.notFound('Không tìm thấy shop');
  if (!isStaff(actor)) {
    const tenant = tenantOf(actor);
    if (shop.ownerId !== tenant) throw err.notFound('Không tìm thấy shop');
    if (actor.role === 'member') {
      const [m] = await db
        .select()
        .from(memberShops)
        .where(and(eq(memberShops.accountId, actor.id), eq(memberShops.shopId, shopId)));
      if (!m || !actor.permissions.includes('shop.view')) throw err.notFound('Không tìm thấy shop');
      if (!actor.permissions.includes(perm)) throw err.forbidden('Tài khoản của bạn chưa được cấp quyền này');
    }
    if (shop.suspendedAt) throw err.forbidden('Shop đã ngưng dịch vụ');
  }
  if (mode !== 'read') {
    const svc = shopServiceState(shop);
    if (svc.state === 'suspended') throw err.locked('shop_suspended', 'Shop đã ngưng dịch vụ');
    if (mode === 'write' && svc.state === 'expired') throw err.locked('shop_expired', 'Shop đã hết hạn dùng — chỉ xem dữ liệu và kết thúc phiên đang live');
  }
  return { actor, shop };
}

export function hasPerm(a: Actor, p: Permission): boolean {
  return a.permissions.includes(p);
}
