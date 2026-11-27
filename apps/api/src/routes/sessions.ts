import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { LIMITS, type Permission } from '@mexo/shared';
import { db } from '../db/client.js';
import { comments, liveSessions, products, sessionEvents, sessionMetricSamples, servers, streamJobs } from '../db/schema.js';
import { actorRef, requireActor, requireShop, visibleShopIds, type ShopMode } from '../auth/auth.js';
import { err } from '../lib/errors.js';
import { idOf, parse, z } from '../lib/http.js';
import { replyToComment, manualReply } from '../services/comments.js';
import { parseItemRefs } from '../services/products.js';
import * as svc from '../services/sessions.js';
import { buildShopViews } from '../services/shopView.js';

async function loadSession(req: FastifyRequest, perm: Permission = 'shop.view', mode: ShopMode = 'read') {
  const sid = idOf(req.params, 'sid');
  const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, sid));
  if (!s) throw err.notFound('Không tìm thấy phiên');
  const { actor, shop } = await requireShop(req, s.shopId, perm, mode);
  return { actor, shop, s };
}

export async function sessionRoutes(app: FastifyInstance) {
  // Phiên của 1 shop (hiện tại + lịch sử)
  app.get('/api/shops/:id/sessions', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().max(200).default(30) }), req.query);
    const open = await svc.getOpenSession(shop.id);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(liveSessions).where(and(eq(liveSessions.shopId, shop.id), eq(liveSessions.state, 'ended')))) as [{ n: number }];
    const ended = await db
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.shopId, shop.id), eq(liveSessions.state, 'ended')))
      .orderBy(desc(liveSessions.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { open: open ? svc.sessionDto(open) : null, items: ended.map(svc.sessionDto), total: Number(n), page: q.page, pageSize: q.pageSize };
  });

  // Phòng điều khiển: mọi phiên đang mở mà tài khoản được thấy
  app.get('/api/live', async (req) => {
    const a = requireActor(req);
    const ids = await visibleShopIds(a);
    const views = await buildShopViews(ids);
    const withSession = views.filter((v) => v.session);
    const sids = withSession.map((v) => v.session!.id);
    const rows = sids.length ? await db.select().from(liveSessions).where(inArray(liveSessions.id, sids)) : [];
    const rmap = new Map(rows.map((r) => [r.id, r]));
    const pinned = rows.filter((r) => r.pinnedItemId).map((r) => ({ shopId: r.shopId, itemId: r.pinnedItemId! }));
    const prows = pinned.length ? await db.select({ shopId: products.shopId, itemId: products.itemId, name: products.name, imageUrl: products.imageUrl }).from(products).where(inArray(products.itemId, pinned.map((p) => p.itemId))) : [];
    const srvRows = await db.select({ id: servers.id, name: servers.name }).from(servers);
    const smap = new Map(srvRows.map((s) => [s.id, s.name]));
    return {
      items: withSession.map((v) => {
        const r = rmap.get(v.session!.id)!;
        const p = prows.find((x) => x.shopId === r.shopId && x.itemId === r.pinnedItemId);
        return {
          shop: { id: v.id, name: v.name, shopeeShopId: v.shopeeShopId, status: v.status, issues: v.issues, service: v.service },
          session: { ...v.session!, metrics: r.metrics, serverName: r.serverId ? smap.get(r.serverId) ?? null : null, pinned: p ? { name: p.name, imageUrl: p.imageUrl } : null, positionSec: r.videoPositionSec, videoDuration: r.videoIndex !== null && r.playlist ? r.playlist[r.videoIndex]?.durationSec ?? null : null },
        };
      }),
    };
  });

  app.post('/api/shops/:id/sessions', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'session.create', 'write');
    const body = parse(
      z.object({
        title: z.string().trim().min(1, 'Cần nhập tên phiên').max(200),
        description: z.string().max(1000).default(''),
        coverKey: z.string().min(1, 'Cần ảnh bìa'),
        templateId: z.number().int().nullable().optional(),
      }),
      req.body,
    );
    const s = await svc.createLiveSession(actorRef(actor), shop, body);
    return svc.sessionDto(s);
  });

  app.get('/api/sessions/:sid', async (req) => {
    const { shop, s } = await loadSession(req);
    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, s.id)).orderBy(desc(sessionEvents.id)).limit(200);
    const samples = await db.select().from(sessionMetricSamples).where(eq(sessionMetricSamples.sessionId, s.id)).orderBy(asc(sessionMetricSamples.at)).limit(2000);
    const job = await svc.activeJob(s.id);
    const [server] = s.serverId ? await db.select({ id: servers.id, name: servers.name }).from(servers).where(eq(servers.id, s.serverId)) : [];
    let pinned = null;
    if (s.pinnedItemId) {
      const [p] = await db.select().from(products).where(and(eq(products.shopId, shop.id), eq(products.itemId, s.pinnedItemId)));
      pinned = p ? { itemId: p.itemId, name: p.name, imageUrl: p.imageUrl, sku: p.sku, stock: p.stock, price: p.price } : { itemId: s.pinnedItemId, name: String(s.pinnedItemId), imageUrl: null };
    }
    return {
      session: svc.sessionDto(s),
      shop: { id: shop.id, name: shop.alias || shop.shopeeName, shopeeShopId: shop.shopeeShopId, connection: shop.connection, cartLimit: shop.cartLimit, replyEnabled: shop.replyEnabled },
      job: job ? { id: job.id, state: job.state, restarts: job.restarts, lastReportAt: job.lastReportAt, error: job.error } : null,
      server: server ?? null,
      pinned,
      events,
      samples,
    };
  });

  app.patch('/api/sessions/:sid', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'session.create', 'write');
    const body = parse(z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(1000).default(''), coverKey: z.string().nullable().optional() }), req.body);
    await svc.updateSessionInfo(actorRef(actor), shop, s, body);
    return { ok: true };
  });

  app.post('/api/sessions/:sid/preflight', async (req) => {
    const { shop, s } = await loadSession(req, 'session.control', 'read');
    const body = parse(z.object({ templateId: z.number().int(), serverId: z.number().int().nullable().optional() }), req.body);
    const r = await svc.preflight(shop, s, body.templateId, body.serverId);
    return { ok: r.ok, checks: r.checks, playlist: r.playlist, missingInCart: r.missingInCart, server: r.server ? { id: r.server.id, name: r.server.name } : null };
  });

  app.post('/api/sessions/:sid/stream', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'session.control', 'write');
    const body = parse(z.object({ templateId: z.number().int(), serverId: z.number().int().nullable().optional() }), req.body);
    const job = await svc.startAutoPlay(actorRef(actor), shop, s, body.templateId, body.serverId);
    return { ok: true, jobId: job.id };
  });

  app.post('/api/sessions/:sid/stream/stop', async (req) => {
    const { actor, s } = await loadSession(req, 'session.control', 'end');
    await svc.stopFeed(actorRef(actor), s);
    return { ok: true };
  });

  app.post('/api/sessions/:sid/stream/skip', async (req) => {
    const { actor, s } = await loadSession(req, 'session.control', 'write');
    const body = parse(z.object({ index: z.number().int().min(0) }), req.body);
    await svc.skipVideo(actorRef(actor), s, body.index);
    return { ok: true };
  });

  app.post('/api/sessions/:sid/end', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'session.control', 'end');
    const r = await svc.endLiveSession(actorRef(actor), shop, s, 'manual');
    return { ok: true, result: r };
  });

  app.post('/api/sessions/:sid/sync', async (req) => {
    const { s } = await loadSession(req);
    const status = await svc.reconcileSession(s, { withMetrics: true });
    if (status === null) throw err.unavailable('sync_failed', 'Chưa đồng bộ được với Shopee, vui lòng thử lại sau');
    return { ok: true, shopeeStatus: status };
  });

  app.post('/api/sessions/:sid/release', async (req) => {
    const { actor, s } = await loadSession(req, 'session.control', 'end');
    if (actor.role !== 'sysadmin' && actor.role !== 'admin') throw err.forbidden('Chỉ quản trị viên được giải phóng khóa phiên');
    const body = parse(z.object({ force: z.boolean().default(false), note: z.string().max(300).default('') }), req.body);
    if (body.force && actor.role !== 'sysadmin') throw err.forbidden('Chỉ quản trị hệ thống được giải phóng bắt buộc');
    if (body.force && !body.note.trim()) throw err.badRequest('note_required', 'Cần ghi lý do khi giải phóng bắt buộc');
    return svc.releaseLock(actorRef(actor), s, body.force, body.note);
  });

  app.post('/api/sessions/bulk', async (req) => {
    const a = requireActor(req);
    const body = parse(z.object({ ids: z.array(z.number().int()).min(1).max(500), action: z.enum(['end', 'stop_feed', 'sync']) }), req.body);
    const results: { id: number; ok: boolean; message?: string }[] = [];
    for (const id of body.ids) {
      try {
        const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, id));
        if (!s) throw err.notFound();
        const { shop } = await requireShop(req, s.shopId, body.action === 'sync' ? 'shop.view' : 'session.control', body.action === 'sync' ? 'read' : 'end');
        if (body.action === 'end') await svc.endLiveSession(actorRef(a), shop, s, 'manual');
        else if (body.action === 'stop_feed') await svc.stopFeed(actorRef(a), s, 'Dừng hàng loạt');
        else await svc.reconcileSession(s, { withMetrics: true });
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  });

  // ───── Giỏ live & ghim ─────
  app.get('/api/sessions/:sid/cart', async (req) => {
    const { shop, s } = await loadSession(req);
    return svc.cartView(shop, s);
  });

  app.post('/api/sessions/:sid/cart/add', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'product.manage', 'write');
    const body = parse(z.object({ itemIds: z.array(z.number().int()).max(LIMITS.pasteMaxItems).optional(), text: z.string().max(200000).optional() }), req.body);
    const ids = body.itemIds ?? parseItemRefs(body.text ?? '', LIMITS.pasteMaxItems);
    if (!ids.length) throw err.badRequest('empty', 'Chưa chọn sản phẩm');
    return svc.cartAdd(actorRef(actor), shop, s, ids);
  });

  app.post('/api/sessions/:sid/cart/remove', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'product.manage', 'end');
    const body = parse(z.object({ itemIds: z.array(z.number().int()).min(1).max(500) }), req.body);
    await svc.cartRemove(actorRef(actor), shop, s, body.itemIds);
    return { ok: true };
  });

  app.post('/api/sessions/:sid/cart/plan', async (req) => {
    const { shop, s } = await loadSession(req);
    const body = parse(z.object({ templateId: z.number().int() }), req.body);
    return svc.cartPlanFromTemplate(shop, s, body.templateId);
  });

  app.post('/api/sessions/:sid/pin', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'product.pin', 'write');
    const body = parse(z.object({ itemId: z.number().int() }), req.body);
    await svc.manualPin(actorRef(actor), shop, s, body.itemId);
    return { ok: true };
  });

  // ───── Bình luận ─────
  app.get('/api/sessions/:sid/comments', async (req) => {
    const { s } = await loadSession(req);
    const q = parse(z.object({ after: z.coerce.number().int().optional(), limit: z.coerce.number().int().max(500).default(100) }), req.query);
    const conds: SQL[] = [eq(comments.sessionId, s.id)];
    if (q.after) conds.push(gt(comments.id, q.after));
    const rows = await db.select().from(comments).where(and(...conds)).orderBy(desc(comments.id)).limit(q.limit);
    return { items: rows.reverse() };
  });

  app.post('/api/sessions/:sid/comments', async (req) => {
    const { actor, shop, s } = await loadSession(req, 'comment.reply', 'write');
    const body = parse(z.object({ text: z.string().trim().min(1).max(300), force: z.boolean().default(false), commentId: z.number().int().optional() }), req.body);
    if (body.commentId) await replyToComment(actorRef(actor), shop, s, body.commentId, body.text, body.force);
    else await manualReply(actorRef(actor), shop, s, body.text, body.force);
    return { ok: true };
  });

  app.get('/api/sessions/:sid/events', async (req) => {
    const { s } = await loadSession(req);
    const rows = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, s.id)).orderBy(desc(sessionEvents.id)).limit(500);
    return { items: rows };
  });

  app.get('/api/sessions/:sid/jobs', async (req) => {
    const { s } = await loadSession(req);
    const rows = await db.select().from(streamJobs).where(eq(streamJobs.sessionId, s.id)).orderBy(desc(streamJobs.id));
    return { items: rows };
  });

}
