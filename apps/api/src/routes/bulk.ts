import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { templates } from '../db/schema.js';
import { actorRef, requireActor, requireShop } from '../auth/auth.js';
import { err } from '../lib/errors.js';
import { parse, z } from '../lib/http.js';
import { createLiveSession, getOpenSession, preflight, startAutoPlay } from '../services/sessions.js';

/**
 * Bắt đầu phát hàng loạt (Brief VII.2): với mỗi shop → tạo phiên (tiêu đề/ảnh bìa lấy từ mẫu hoặc dùng chung)
 * → kiểm tra trước khi phát → giao máy phát. Shop nào không đạt thì báo lý do, không ảnh hưởng shop khác.
 */
export async function bulkRoutes(app: FastifyInstance) {
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
    const results: { shopId: number; ok: boolean; sessionId?: number; message?: string; checks?: unknown }[] = [];
    for (const it of body.items) {
      try {
        const { shop } = await requireShop(req, it.shopId, 'session.control', 'write');
        if (!a.permissions.includes('session.create')) throw err.forbidden('Thiếu quyền tạo phiên livestream');
        const [tpl] = await db.select().from(templates).where(eq(templates.id, it.templateId));
        if (!tpl || tpl.shopId !== shop.id) throw err.badRequest('bad_template', 'Mẫu phát không thuộc shop này');
        const title = body.title || tpl.liveTitle || tpl.name;
        const coverKey = body.coverKey || tpl.coverKey;
        if (!coverKey) throw err.badRequest('cover_required', 'Mẫu chưa có ảnh bìa — chọn ảnh bìa dùng chung');
        const open = await getOpenSession(shop.id);
        if (open) throw err.conflict('session_open', `Shop đang có phiên "${open.title}" chưa kết thúc`);
        if (body.dryRun) {
          results.push({ shopId: shop.id, ok: true, message: `Sẽ tạo phiên "${title}"` });
          continue;
        }
        const s = await createLiveSession(actorRef(a), shop, { title, description: body.description ?? tpl.liveDescription ?? '', coverKey, templateId: tpl.id });
        const pf = await preflight(shop, s, tpl.id);
        if (!pf.ok) {
          results.push({ shopId: shop.id, ok: false, sessionId: s.id, message: 'Đã tạo phiên nhưng chưa đạt kiểm tra trước khi phát', checks: pf.checks.filter((c) => !c.ok) });
          continue;
        }
        await startAutoPlay(actorRef(a), shop, s, tpl.id);
        results.push({ shopId: shop.id, ok: true, sessionId: s.id });
      } catch (e) {
        results.push({ shopId: it.shopId, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  });
}
