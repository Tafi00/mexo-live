import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { addDays, vnDate, vnDateTime } from '@mexo/shared';
import { db } from '../db/client.js';
import { liveSessions, scheduleRuns, schedules, shops, templates } from '../db/schema.js';
import { actorRef, requireActor, requireShop, visibleShopIds } from '../auth/auth.js';
import { err } from '../lib/errors.js';
import { dateStr, idOf, parse, timeStr, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { publish } from '../services/events.js';
import { clearFutureRuns, materializeRuns, validateScheduleInput } from '../services/scheduler.js';

const scheduleSchema = z.object({
  title: z.string().trim().max(200).default(''),
  description: z.string().max(1000).default(''),
  templateId: z.number().int({ message: 'Cần chọn mẫu phát' }),
  coverKey: z.string().nullable().optional(),
  repeat: z.enum(['once', 'daily', 'weekly']),
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  startDate: dateStr,
  endDate: dateStr.nullable().default(null),
  startTime: timeStr,
  endTime: timeStr,
});

async function loadSchedule(req: FastifyRequest, write = true) {
  const id = idOf(req.params);
  const [s] = await db.select().from(schedules).where(eq(schedules.id, id));
  if (!s) throw err.notFound('Không tìm thấy lịch phát');
  const ctx = await requireShop(req, s.shopId, write ? 'schedule.manage' : 'shop.view', write ? 'write' : 'read');
  return { ...ctx, sch: s };
}

function scheduleDto(s: typeof schedules.$inferSelect, tplName?: string | null, tplCover?: string | null, tplTitle?: string | null) {
  // Tiêu đề / ảnh bìa để trống → hiển thị theo mẫu phát (giá trị thực tế khi chạy)
  return { ...s, title: s.title || tplTitle || tplName || '', titleFromTemplate: !s.title, templateName: tplName ?? null, hasCover: Boolean(s.coverKey || tplCover), coverFromTemplate: !s.coverKey && Boolean(tplCover) };
}

export async function scheduleRoutes(app: FastifyInstance) {
  app.get('/api/shops/:id/schedules', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const rows = await db
      .select({ s: schedules, tplName: templates.name, tplCover: templates.coverKey, tplTitle: templates.liveTitle })
      .from(schedules)
      .leftJoin(templates, eq(templates.id, schedules.templateId))
      .where(eq(schedules.shopId, shop.id))
      .orderBy(desc(schedules.id));
    const runs = await db
      .select()
      .from(scheduleRuns)
      .where(and(eq(scheduleRuns.shopId, shop.id), gte(scheduleRuns.startAt, new Date(Date.now() - 14 * 86400000)), lte(scheduleRuns.startAt, new Date(Date.now() + 14 * 86400000))))
      .orderBy(asc(scheduleRuns.startAt));
    const counts = { upcoming: 0, live: 0, done: 0, missed: 0, cancelled: 0, failed: 0 } as Record<string, number>;
    for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { schedules: rows.map((r) => scheduleDto(r.s, r.tplName, r.tplCover, r.tplTitle)), runs, counts, today: vnDate() };
  });

  // Lịch toàn hệ thống (Calendar) theo khoảng ngày
  app.get('/api/schedule-runs', async (req) => {
    const a = requireActor(req);
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), shopId: z.coerce.number().int().optional(), status: z.string().optional() }), req.query);
    const from = q.from ?? addDays(vnDate(), -3);
    const to = q.to ?? addDays(vnDate(), 14);
    const ids = await visibleShopIds(a);
    const allowed = q.shopId ? (ids === null || ids.includes(q.shopId) ? [q.shopId] : []) : ids;
    if (allowed !== null && allowed.length === 0) return { items: [], from, to };
    const conds = [gte(scheduleRuns.startAt, vnDateTime(from, '00:00')), lte(scheduleRuns.startAt, vnDateTime(addDays(to, 1), '00:00'))];
    if (allowed !== null) conds.push(inArray(scheduleRuns.shopId, allowed));
    if (q.status) conds.push(eq(scheduleRuns.status, q.status));
    const rows = await db
      .select({ r: scheduleRuns, title: schedules.title, repeat: schedules.repeat, weekdays: schedules.weekdays, templateId: schedules.templateId, scheduleState: schedules.state, shopAlias: shops.alias, shopName: shops.shopeeName, tplName: templates.name, tplTitle: templates.liveTitle })
      .from(scheduleRuns)
      .innerJoin(schedules, eq(schedules.id, scheduleRuns.scheduleId))
      .innerJoin(shops, eq(shops.id, scheduleRuns.shopId))
      .leftJoin(templates, eq(templates.id, schedules.templateId))
      .where(and(...conds))
      .orderBy(asc(scheduleRuns.startAt))
      .limit(5000);
    return {
      items: rows.map((x) => ({ ...x.r, title: x.title || x.tplTitle || x.tplName || 'Lịch phát', repeat: x.repeat, weekdays: x.weekdays, templateName: x.tplName, scheduleState: x.scheduleState, shopName: x.shopAlias || x.shopName })),
      from,
      to,
    };
  });

  app.post('/api/shops/:id/schedules', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'schedule.manage', 'write');
    const body = parse(scheduleSchema, req.body);
    await validateScheduleInput(shop.id, { ...body, coverKey: body.coverKey ?? null });
    const [row] = await db.insert(schedules).values({ ...body, shopId: shop.id, createdBy: actor.id }).returning();
    await materializeRuns(row!.id);
    await audit(actorRef(actor), 'schedule_created', { shopId: shop.id, params: { title: body.title, repeat: body.repeat, time: `${body.startTime}-${body.endTime}` } });
    publish({ type: 'shop', shopId: shop.id });
    return scheduleDto(row!);
  });

  // Tạo lịch cho nhiều shop cùng lúc (mỗi shop chọn mẫu của shop đó)
  app.post('/api/schedules/bulk', async (req) => {
    const a = requireActor(req);
    const body = parse(
      scheduleSchema.omit({ templateId: true }).extend({ items: z.array(z.object({ shopId: z.number().int(), templateId: z.number().int() })).min(1).max(500) }),
      req.body,
    );
    const results: { shopId: number; ok: boolean; message?: string; scheduleId?: number }[] = [];
    for (const it of body.items) {
      try {
        const { shop } = await requireShop(req, it.shopId, 'schedule.manage', 'write');
        const input = { ...body, templateId: it.templateId, coverKey: body.coverKey ?? null };
        await validateScheduleInput(shop.id, input);
        const { items: _items, ...rest } = body;
        const [row] = await db.insert(schedules).values({ ...rest, templateId: it.templateId, shopId: shop.id, createdBy: a.id }).returning();
        await materializeRuns(row!.id);
        await audit(actorRef(a), 'schedule_created', { shopId: shop.id, params: { title: body.title, bulk: true } });
        results.push({ shopId: it.shopId, ok: true, scheduleId: row!.id });
      } catch (e) {
        results.push({ shopId: it.shopId, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  });

  app.put('/api/schedules/:id', async (req) => {
    const { actor, shop, sch } = await loadSchedule(req);
    if (sch.state === 'cancelled') throw err.conflict('cancelled', 'Lịch đã hủy, không sửa được');
    const body = parse(scheduleSchema, req.body);
    await validateScheduleInput(shop.id, { ...body, coverKey: body.coverKey ?? null }, sch.id);
    await db.update(schedules).set({ ...body, updatedAt: new Date() }).where(eq(schedules.id, sch.id));
    await clearFutureRuns(sch.id);
    await materializeRuns(sch.id);
    await audit(actorRef(actor), 'schedule_updated', { shopId: shop.id, params: { title: body.title } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/schedules/:id/pause', async (req) => {
    const { actor, shop, sch } = await loadSchedule(req);
    if (sch.state !== 'active') throw err.conflict('not_active', 'Lịch không ở trạng thái hoạt động');
    await db.update(schedules).set({ state: 'paused', updatedAt: new Date() }).where(eq(schedules.id, sch.id));
    await clearFutureRuns(sch.id);
    await audit(actorRef(actor), 'schedule_paused', { shopId: shop.id, params: { title: sch.title } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/schedules/:id/resume', async (req) => {
    const { actor, shop, sch } = await loadSchedule(req);
    if (sch.state !== 'paused') throw err.conflict('not_paused', 'Lịch không ở trạng thái tạm dừng');
    await validateScheduleInput(shop.id, { ...sch, startDate: sch.startDate < vnDate() ? vnDate() : sch.startDate, templateId: sch.templateId }, sch.id).catch((e) => {
      if (e?.code === 'in_past') return;
      throw e;
    });
    await db.update(schedules).set({ state: 'active', updatedAt: new Date() }).where(eq(schedules.id, sch.id));
    await materializeRuns(sch.id);
    await audit(actorRef(actor), 'schedule_resumed', { shopId: shop.id, params: { title: sch.title } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/schedules/:id/cancel', async (req) => {
    const { actor, shop, sch } = await loadSchedule(req);
    await db.update(schedules).set({ state: 'cancelled', updatedAt: new Date() }).where(eq(schedules.id, sch.id));
    await clearFutureRuns(sch.id, 'cancel');
    await audit(actorRef(actor), 'schedule_cancelled', { shopId: shop.id, params: { title: sch.title } });
    publish({ type: 'shop', shopId: shop.id });
    return { ok: true };
  });

  app.post('/api/schedules/:id/duplicate', async (req) => {
    const { actor, shop, sch } = await loadSchedule(req);
    const { id: _id, createdAt: _c, updatedAt: _u, legacyId: _l, ...rest } = sch;
    const [row] = await db.insert(schedules).values({ ...rest, title: `${sch.title} (bản sao)`, state: 'paused', createdBy: actor.id }).returning();
    await audit(actorRef(actor), 'schedule_created', { shopId: shop.id, params: { title: row!.title, from: sch.id } });
    return { id: row!.id, note: 'Bản sao ở trạng thái tạm dừng để tránh trùng khung giờ. Hãy sửa giờ rồi kích hoạt.' };
  });

  app.delete('/api/schedules/:id', async (req) => {
    const { actor, shop, sch } = await loadSchedule(req);
    const [ran] = await db.select({ id: scheduleRuns.id }).from(scheduleRuns).where(and(eq(scheduleRuns.scheduleId, sch.id), inArray(scheduleRuns.status, ['live', 'starting', 'done'])));
    if (ran) {
      await db.update(schedules).set({ state: 'cancelled' }).where(eq(schedules.id, sch.id));
      await clearFutureRuns(sch.id, 'cancel');
    } else {
      await db.delete(scheduleRuns).where(eq(scheduleRuns.scheduleId, sch.id));
      await db.delete(schedules).where(eq(schedules.id, sch.id));
    }
    await audit(actorRef(actor), 'schedule_cancelled', { shopId: shop.id, params: { title: sch.title, deleted: !ran } });
    return { ok: true, deleted: !ran };
  });

  // Bỏ qua 1 lần phát
  app.post('/api/schedule-runs/:id/cancel', async (req) => {
    const id = idOf(req.params);
    const [run] = await db.select().from(scheduleRuns).where(eq(scheduleRuns.id, id));
    if (!run) throw err.notFound();
    const { actor, shop } = await requireShop(req, run.shopId, 'schedule.manage', 'write');
    if (run.status !== 'upcoming') throw err.conflict('not_upcoming', 'Chỉ hủy được lần phát sắp tới');
    await db.update(scheduleRuns).set({ status: 'cancelled', issue: 'schedule_cancelled' }).where(eq(scheduleRuns.id, id));
    await audit(actorRef(actor), 'schedule_updated', { shopId: shop.id, params: { cancelledRun: run.runDate } });
    return { ok: true };
  });

  void liveSessions;
}
