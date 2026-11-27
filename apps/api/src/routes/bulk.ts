import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { liveSessions } from '../db/schema.js';
import { actorRef, requireActor, requireShop } from '../auth/auth.js';
import { err } from '../lib/errors.js';
import { idOf, parse, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { publish } from '../services/events.js';
import { goLive } from '../services/sessions.js';

const goLiveSchema = z.object({
  templateId: z.number().int(),
  title: z.string().trim().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  coverKey: z.string().optional().nullable(),
  serverId: z.number().int().optional().nullable(),
  dryRun: z.boolean().default(false),
});

/**
 * Luồng lên live:
 *  - POST /api/shops/:id/go-live  : Phát ngay 1 bước (dryRun = chỉ kiểm tra)
 *  - POST /api/sessions/bulk-start: Phát ngay cho nhiều shop
 *  - PATCH /api/sessions/:sid/reply: bật/tắt trả lời tự động riêng cho phiên
 */
export async function bulkRoutes(app: FastifyInstance) {
  app.post('/api/shops/:id/go-live', async (req) => {
    const body = parse(goLiveSchema, req.body);
    const { actor, shop } = await requireShop(req, idOf(req.params), 'session.control', body.dryRun ? 'read' : 'write');
    if (!actor.permissions.includes('session.create')) throw err.forbidden('Tài khoản chưa được cấp quyền tạo phiên livestream');
    return goLive(actorRef(actor), shop, body);
  });

  app.post('/api/sessions/bulk-start', async (req) => {
    const a = requireActor(req);
    const body = parse(
      z.object({
        items: z.array(z.object({ shopId: z.number().int(), templateId: z.number().int() })).min(1).max(200),
        title: z.string().trim().max(200).optional(),
        description: z.string().max(1000).optional(),
        coverKey: z.string().optional(),
        dryRun: z.boolean().default(false),
      }),
      req.body,
    );
    const results: { shopId: number; ok: boolean; sessionId?: number | null; message?: string; checks?: unknown }[] = [];
    for (const it of body.items) {
      try {
        const { shop } = await requireShop(req, it.shopId, 'session.control', 'write');
        if (!a.permissions.includes('session.create')) throw err.forbidden('Thiếu quyền tạo phiên livestream');
        const r = await goLive(actorRef(a), shop, { templateId: it.templateId, title: body.title, description: body.description, coverKey: body.coverKey, dryRun: body.dryRun });
        const failed = r.checks.filter((c) => !c.ok);
        results.push({
          shopId: shop.id,
          ok: r.ok,
          sessionId: r.sessionId,
          message: r.ok ? (body.dryRun ? `Sẵn sàng phát "${r.summary.title}"` : undefined) : 'error' in r && r.error ? String(r.error) : failed.map((c) => c.label + (c.detail ? ` — ${c.detail}` : '')).join('; '),
          checks: failed.length ? failed : undefined,
        });
      } catch (e) {
        results.push({ shopId: it.shopId, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  });

  app.patch('/api/sessions/:sid/reply', async (req) => {
    const sid = idOf(req.params, 'sid');
    const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, sid));
    if (!s) throw err.notFound('Không tìm thấy phiên');
    const { actor, shop } = await requireShop(req, s.shopId, 'comment.reply', 'end');
    const body = parse(z.object({ mode: z.enum(['inherit', 'on', 'off']) }), req.body);
    await db
      .update(liveSessions)
      .set({ replyMode: body.mode, replyState: body.mode === 'off' ? 'off' : body.mode === 'on' ? 'ok' : s.replyState, updatedAt: new Date() })
      .where(eq(liveSessions.id, sid));
    await audit(actorRef(actor), 'reply_settings', { shopId: shop.id, params: { sessionId: s.shopeeSessionId, mode: body.mode } });
    publish({ type: 'session', shopId: shop.id, sessionId: sid });
    return { ok: true };
  });
}
