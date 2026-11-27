import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { env } from '../env.js';
import { actorRef, createLogin, destroyLogin, requireActor, revokeAllLogins } from '../auth/auth.js';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import { parse, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';

const PASSWORD_MESSAGES: Record<string, string> = {
  password_too_short: 'Mật khẩu cần ít nhất 8 ký tự',
  password_too_long: 'Mật khẩu quá dài',
  password_too_common: 'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác',
  password_contains_username: 'Mật khẩu không được chứa tên đăng nhập',
};

export function assertPassword(password: string, username: string) {
  const p = passwordProblem(password, username);
  if (p) throw err.badRequest(p, PASSWORD_MESSAGES[p] ?? 'Mật khẩu không hợp lệ');
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: true } }, async (req, reply) => {
    const body = parse(z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }), req.body);
    const [acc] = await db.select().from(accounts).where(eq(sql`lower(${accounts.username})`, body.username.trim().toLowerCase()));
    const fail = () => err.unauthorized('Tên đăng nhập hoặc mật khẩu không đúng');
    if (!acc) throw fail();
    if (acc.lockedUntil && acc.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((acc.lockedUntil.getTime() - Date.now()) / 60000);
      throw err.locked('login_locked', `Đăng nhập sai nhiều lần, vui lòng thử lại sau ${mins} phút`);
    }
    if (!verifyPassword(body.password, acc.passwordHash)) {
      const failed = acc.failedLogins + 1;
      await db
        .update(accounts)
        .set({ failedLogins: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 10 * 60000) : null })
        .where(eq(accounts.id, acc.id));
      await audit({ id: null, name: acc.username, ip: req.ip }, 'login_failed', { targetAccountId: acc.id });
      throw fail();
    }
    if (acc.status !== 'active') throw err.forbidden('Tài khoản đã bị khóa');
    if (acc.role === 'member' && acc.parentId) {
      const [parent] = await db.select().from(accounts).where(eq(accounts.id, acc.parentId));
      if (!parent || parent.status !== 'active') throw err.forbidden('Tài khoản chủ shop đang bị khóa');
    }
    await db.update(accounts).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(accounts.id, acc.id));
    await createLogin(reply, req, acc.id);
    await audit({ id: acc.id, name: acc.name, ip: req.ip }, 'login', { targetAccountId: acc.id });
    return { ok: true, mustChangePassword: acc.mustChangePassword };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.actor) await audit(actorRef(req.actor), 'logout', { targetAccountId: req.actor.id });
    await destroyLogin(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const a = requireActor(req, { allowMustChange: true });
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, a.id));
    const freeze = await getSetting('freeze');
    let owner: { serviceExpiresOn: string | null; shopLimit: number | null } | null = null;
    if (a.role === 'owner') owner = { serviceExpiresOn: acc!.serviceExpiresOn, shopLimit: acc!.shopLimit };
    return {
      user: {
        id: a.id,
        username: a.username,
        name: a.name,
        email: acc?.email ?? null,
        role: a.role,
        permissions: a.permissions,
        mustChangePassword: a.mustChangePassword,
        parentId: a.parentId,
        owner,
      },
      system: { frozen: freeze.frozen, freezeReason: freeze.reason, shopeeMode: env.shopee.mode },
    };
  });

  app.post('/api/auth/change-password', async (req) => {
    const a = requireActor(req, { allowMustChange: true });
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(128) }), req.body);
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, a.id));
    if (!acc || !verifyPassword(body.currentPassword, acc.passwordHash)) throw err.badRequest('wrong_password', 'Mật khẩu hiện tại không đúng');
    if (body.currentPassword === body.newPassword) throw err.badRequest('same_password', 'Mật khẩu mới phải khác mật khẩu cũ');
    assertPassword(body.newPassword, acc.username);
    await db.update(accounts).set({ passwordHash: hashPassword(body.newPassword), mustChangePassword: false, updatedAt: new Date() }).where(eq(accounts.id, a.id));
    await revokeAllLogins(a.id, a.sessionId);
    await audit(actorRef(a), 'password_changed', { targetAccountId: a.id });
    return { ok: true };
  });

  app.patch('/api/auth/profile', async (req) => {
    const a = requireActor(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().max(120).nullable().optional(), phone: z.string().max(20).nullable().optional() }), req.body);
    await db.update(accounts).set({ name: body.name, email: body.email ?? null, phone: body.phone ?? null, updatedAt: new Date() }).where(eq(accounts.id, a.id));
    return { ok: true };
  });
}
