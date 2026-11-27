import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { addDays, foldVi, SESSION_STATE_LABELS, ACTIVITY_LABELS, vnDate, vnDateTime, type SessionState } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, activityLogs, apiCalls, apiDaily, liveSessions, shops } from '../db/schema.js';
import { isStaff, requireActor, requireRole, visibleShopIds } from '../auth/auth.js';
import { err } from '../lib/errors.js';
import { dateStr, parse, toCsv, z } from '../lib/http.js';
import { API_NAMES } from '../services/shopee/index.js';

const ENDED_REASON_LABELS: Record<string, string> = {
  manual: 'Kết thúc thủ công',
  schedule_ended: 'Hết giờ theo lịch',
  ended_on_shopee: 'Kết thúc trên Shopee',
  not_found_on_shopee: 'Không còn trên Shopee',
  lock_released: 'Giải phóng khóa',
  service_expired: 'Tự ngắt do hết hạn',
  schedule_start_failed: 'Lịch bật thất bại',
  migrated: 'Nhập từ hệ thống cũ',
};

const reportQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  shopId: z.coerce.number().int().optional(),
  accountId: z.coerce.number().int().optional(),
  state: z.string().optional(),
  origin: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

async function sessionReport(req: Parameters<typeof requireActor>[0]) {
  const a = requireActor(req);
  if (a.role === 'member' && !a.permissions.includes('report.view')) throw err.forbidden('Bạn chưa được cấp quyền xem báo cáo');
  const q = parse(reportQuery, req.query);
  const from = q.from ?? addDays(vnDate(), -30);
  const to = q.to ?? vnDate();
  const ids = await visibleShopIds(a, 'report.view');
  const conds: SQL[] = [gte(liveSessions.createdAt, vnDateTime(from, '00:00')), lte(liveSessions.createdAt, vnDateTime(addDays(to, 1), '00:00'))];
  if (ids !== null) conds.push(ids.length ? inArray(liveSessions.shopId, ids) : sql`false`);
  if (q.shopId) conds.push(eq(liveSessions.shopId, q.shopId));
  if (q.accountId) conds.push(eq(liveSessions.createdBy, q.accountId));
  if (q.state) conds.push(eq(liveSessions.state, q.state));
  if (q.origin) conds.push(eq(liveSessions.origin, q.origin));
  const rows = await db
    .select({ s: liveSessions, alias: shops.alias, shopeeName: shops.shopeeName, shopeeShopId: shops.shopeeShopId })
    .from(liveSessions)
    .innerJoin(shops, eq(shops.id, liveSessions.shopId))
    .where(and(...conds))
    .orderBy(desc(liveSessions.createdAt))
    .limit(20000);
  let items = rows.map((r) => {
    const s = r.s;
    const dur = s.startedAt ? Math.max(0, Math.round(((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 1000)) : 0;
    return {
      id: s.id,
      shopId: s.shopId,
      shopName: r.alias || r.shopeeName,
      shopeeShopId: r.shopeeShopId,
      shopeeSessionId: s.shopeeSessionId,
      title: s.title,
      origin: s.origin,
      templateName: s.templateName,
      createdByName: s.createdByName,
      state: s.state,
      endedReason: s.endedReason,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec: dur,
      viewers: s.metrics?.viewers ?? 0,
      peakViewers: s.metrics?.peakViewers ?? 0,
      views: s.metrics?.views ?? 0,
      likes: s.metrics?.likes ?? 0,
      comments: s.metrics?.comments ?? 0,
      orders: s.metrics?.orders ?? 0,
      gmv: s.metrics?.gmv ?? 0,
      lastError: s.lastError,
      shareUrl: s.shareUrl,
    };
  });
  if (q.q) {
    const f = foldVi(q.q);
    items = items.filter((i) => foldVi(i.title).includes(f) || foldVi(i.shopName).includes(f) || String(i.shopeeSessionId ?? '').includes(f));
  }
  const summary = {
    count: items.length,
    totalSeconds: items.reduce((s, i) => s + i.durationSec, 0),
    peakViewers: items.reduce((m, i) => Math.max(m, i.peakViewers), 0),
    orders: items.reduce((s, i) => s + i.orders, 0),
    gmv: items.reduce((s, i) => s + i.gmv, 0),
    likes: items.reduce((s, i) => s + i.likes, 0),
    started: items.filter((i) => i.startedAt).length,
    failed: items.filter((i) => !i.startedAt && i.state === 'ended').length,
  };
  return { q, from, to, items, summary };
}

function fmtDur(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtVn(d: Date | null) {
  if (!d) return '';
  return new Date(d.getTime() + 7 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports/sessions', async (req) => {
    const r = await sessionReport(req);
    const byDay = new Map<string, { day: string; sessions: number; hours: number; orders: number; gmv: number }>();
    for (const i of r.items) {
      const day = vnDate(i.createdAt);
      const d = byDay.get(day) ?? { day, sessions: 0, hours: 0, orders: 0, gmv: 0 };
      d.sessions++;
      d.hours += i.durationSec / 3600;
      d.orders += i.orders;
      d.gmv += i.gmv;
      byDay.set(day, d);
    }
    const byShop = new Map<number, { shopId: number; shopName: string; sessions: number; hours: number; orders: number; gmv: number; peakViewers: number }>();
    for (const i of r.items) {
      const d = byShop.get(i.shopId) ?? { shopId: i.shopId, shopName: i.shopName, sessions: 0, hours: 0, orders: 0, gmv: 0, peakViewers: 0 };
      d.sessions++;
      d.hours += i.durationSec / 3600;
      d.orders += i.orders;
      d.gmv += i.gmv;
      d.peakViewers = Math.max(d.peakViewers, i.peakViewers);
      byShop.set(i.shopId, d);
    }
    return {
      items: r.items.slice((r.q.page - 1) * r.q.pageSize, r.q.page * r.q.pageSize),
      total: r.items.length,
      page: r.q.page,
      pageSize: r.q.pageSize,
      summary: r.summary,
      from: r.from,
      to: r.to,
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, hours: Math.round(d.hours * 10) / 10 })),
      byShop: [...byShop.values()].sort((a, b) => b.hours - a.hours).slice(0, 50).map((d) => ({ ...d, hours: Math.round(d.hours * 10) / 10 })),
    };
  });

  app.get('/api/reports/sessions/export', async (req, reply) => {
    const r = await sessionReport(req);
    const { format } = parse(z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') }), req.query);
    const headers = ['Shop', 'Shop ID', 'Session ID', 'Tiêu đề', 'Nguồn', 'Mẫu phát', 'Người thực hiện', 'Tạo lúc', 'Bắt đầu', 'Kết thúc', 'Thời lượng (giờ:phút)', 'Trạng thái', 'Lý do kết thúc', 'Người xem cao nhất', 'Lượt xem', 'Lượt thích', 'Bình luận', 'Đơn hàng', 'Doanh thu', 'Lỗi gần nhất'];
    const rows = r.items.map((i) => [
      i.shopName,
      i.shopeeShopId,
      i.shopeeSessionId,
      i.title,
      { manual: 'Thủ công', schedule: 'Lịch phát', legacy: 'Hệ thống cũ', external: 'App Shopee' }[i.origin] ?? i.origin,
      i.templateName ?? '',
      i.createdByName ?? '',
      fmtVn(i.createdAt),
      fmtVn(i.startedAt),
      fmtVn(i.endedAt),
      fmtDur(i.durationSec),
      SESSION_STATE_LABELS[i.state as SessionState] ?? i.state,
      i.endedReason ? (ENDED_REASON_LABELS[i.endedReason] ?? i.endedReason) : '',
      i.peakViewers,
      i.views,
      i.likes,
      i.comments,
      i.orders,
      i.gmv,
      i.lastError ?? '',
    ]);
    const name = `bao-cao-phien-live-${r.from}_${r.to}`;
    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${name}.csv"`);
      return toCsv(headers, rows);
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MEXO Live';
    const ws = wb.addWorksheet('Phiên live');
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEE4D2D' } };
    rows.forEach((row) => ws.addRow(row));
    ws.columns.forEach((c, idx) => (c.width = [24, 14, 12, 36, 12, 20, 16, 17, 17, 17, 12, 16, 20, 10, 10, 10, 10, 10, 14, 30][idx] ?? 14));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const sum = wb.addWorksheet('Tổng hợp');
    sum.addRows([
      ['Từ ngày', r.from],
      ['Đến ngày', r.to],
      ['Số phiên', r.summary.count],
      ['Phiên đã lên sóng', r.summary.started],
      ['Phiên thất bại', r.summary.failed],
      ['Tổng thời lượng (giờ)', Math.round((r.summary.totalSeconds / 3600) * 10) / 10],
      ['Người xem cao nhất', r.summary.peakViewers],
      ['Đơn hàng', r.summary.orders],
      ['Doanh thu', r.summary.gmv],
    ]);
    sum.getColumn(1).width = 24;
    sum.getColumn(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    return reply.send(Buffer.from(buf));
  });

  // ───────────── Giám sát API Shopee ─────────────
  const monitorQuery = z.object({ from: dateStr.optional(), to: dateStr.optional(), api: z.string().optional(), shopId: z.coerce.number().int().optional() });
  function range(q: z.infer<typeof monitorQuery>) {
    const to = q.to ?? vnDate();
    const from = q.from ?? addDays(to, -6);
    if (from > to) throw err.badRequest('bad_range', 'Khoảng thời gian không hợp lệ');
    if (Date.parse(to) - Date.parse(from) > 90 * 86400000) throw err.badRequest('range_too_long', 'Tối đa 90 ngày');
    return { from, to };
  }

  app.get('/api/monitor/summary', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery, req.query);
    const { from, to } = range(q);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    const prevFrom = addDays(from, -days);
    const prevTo = addDays(from, -1);
    const agg = async (f: string, t: string) => {
      const [r] = await db
        .select({ total: sql<number>`coalesce(sum(${apiDaily.total}),0)`, ok: sql<number>`coalesce(sum(${apiDaily.success}),0)`, ms: sql<number>`coalesce(sum(${apiDaily.totalMs}),0)` })
        .from(apiDaily)
        .where(and(eq(apiDaily.shopId, 0), gte(apiDaily.day, f), lte(apiDaily.day, t), q.api ? eq(apiDaily.api, q.api) : sql`true`));
      const total = Number(r?.total ?? 0);
      return { total, success: Number(r?.ok ?? 0), failed: total - Number(r?.ok ?? 0), rate: total ? Number(r!.ok) / total : null, avgMs: total ? Math.round(Number(r!.ms) / total) : null };
    };
    const [h] = await db
      .select({ total: sql<number>`count(*)`, ok: sql<number>`count(*) filter (where ${apiCalls.success})` })
      .from(apiCalls)
      .where(and(gte(apiCalls.at, new Date(Date.now() - 3600000)), eq(apiCalls.counted, true)));
    const [today] = await db
      .select({ total: sql<number>`coalesce(sum(${apiDaily.total}),0)`, ok: sql<number>`coalesce(sum(${apiDaily.success}),0)` })
      .from(apiDaily)
      .where(and(eq(apiDaily.shopId, 0), eq(apiDaily.day, vnDate())));
    const hourTotal = Number(h?.total ?? 0);
    const dayTotal = Number(today?.total ?? 0);
    const hourRate = hourTotal ? Number(h!.ok) / hourTotal : null;
    const dayRate = dayTotal ? Number(today!.ok) / dayTotal : null;
    const level = (hourRate !== null && hourRate < 0.93) || (dayRate !== null && dayRate < 0.94) ? 'danger' : hourRate !== null && hourRate < 0.97 ? 'warning' : 'normal';
    return { from, to, current: await agg(from, to), previous: await agg(prevFrom, prevTo), lastHour: { total: hourTotal, rate: hourRate }, today: { total: dayTotal, rate: dayRate }, level, thresholds: { normal: 0.97, danger1h: 0.93, dangerDay: 0.94, shopeeMin: 0.9 }, apis: API_NAMES };
  });

  app.get('/api/monitor/series', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery.extend({ granularity: z.enum(['day', 'hour']).default('day') }), req.query);
    const { from, to } = range(q);
    if (q.granularity === 'hour') {
      const rows = await db
        .select({
          bucket: sql<string>`to_char(date_trunc('hour', ${apiCalls.at} at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD HH24:00')`,
          total: sql<number>`count(*)`,
          ok: sql<number>`count(*) filter (where ${apiCalls.success})`,
          avgMs: sql<number>`avg(${apiCalls.durationMs})`,
        })
        .from(apiCalls)
        .where(and(gte(apiCalls.at, vnDateTime(from, '00:00')), lte(apiCalls.at, vnDateTime(addDays(to, 1), '00:00')), q.api ? eq(apiCalls.api, q.api) : sql`true`, q.shopId ? eq(apiCalls.shopId, q.shopId) : sql`true`))
        .groupBy(sql`1`)
        .orderBy(sql`1`);
      return { items: rows.map((r) => ({ bucket: r.bucket, total: Number(r.total), success: Number(r.ok), rate: Number(r.total) ? Number(r.ok) / Number(r.total) : null, avgMs: Math.round(Number(r.avgMs ?? 0)) })) };
    }
    const rows = await db
      .select({ bucket: apiDaily.day, total: sql<number>`sum(${apiDaily.total})`, ok: sql<number>`sum(${apiDaily.success})`, ms: sql<number>`sum(${apiDaily.totalMs})` })
      .from(apiDaily)
      .where(and(eq(apiDaily.shopId, q.shopId ?? 0), gte(apiDaily.day, from), lte(apiDaily.day, to), q.api ? eq(apiDaily.api, q.api) : sql`true`))
      .groupBy(apiDaily.day)
      .orderBy(asc(apiDaily.day));
    return { items: rows.map((r) => ({ bucket: r.bucket, total: Number(r.total), success: Number(r.ok), rate: Number(r.total) ? Number(r.ok) / Number(r.total) : null, avgMs: Number(r.total) ? Math.round(Number(r.ms) / Number(r.total)) : 0 })) };
  });

  app.get('/api/monitor/by-api', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery, req.query);
    const { from, to } = range(q);
    const rows = await db
      .select({ api: apiDaily.api, total: sql<number>`sum(${apiDaily.total})`, ok: sql<number>`sum(${apiDaily.success})`, ms: sql<number>`sum(${apiDaily.totalMs})` })
      .from(apiDaily)
      .where(and(eq(apiDaily.shopId, q.shopId ?? 0), gte(apiDaily.day, from), lte(apiDaily.day, to)))
      .groupBy(apiDaily.api);
    const map = new Map(rows.map((r) => [r.api, r]));
    return {
      items: API_NAMES.map((api) => {
        const r = map.get(api);
        const total = Number(r?.total ?? 0);
        return { api, total, success: Number(r?.ok ?? 0), failed: total - Number(r?.ok ?? 0), rate: total ? Number(r!.ok) / total : null, avgMs: total ? Math.round(Number(r!.ms) / total) : null };
      }).sort((a, b) => b.total - a.total),
    };
  });

  app.get('/api/monitor/by-shop', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery, req.query);
    const { from, to } = range(q);
    const rows = await db
      .select({ shopId: apiDaily.shopId, total: sql<number>`sum(${apiDaily.total})`, ok: sql<number>`sum(${apiDaily.success})`, alias: shops.alias, shopeeName: shops.shopeeName })
      .from(apiDaily)
      .innerJoin(shops, eq(shops.id, apiDaily.shopId))
      .where(and(gte(apiDaily.day, from), lte(apiDaily.day, to), q.api ? eq(apiDaily.api, q.api) : sql`true`))
      .groupBy(apiDaily.shopId, shops.alias, shops.shopeeName);
    return {
      items: rows
        .map((r) => ({ shopId: r.shopId, shopName: r.alias || r.shopeeName, total: Number(r.total), success: Number(r.ok), failed: Number(r.total) - Number(r.ok), rate: Number(r.total) ? Number(r.ok) / Number(r.total) : null }))
        .sort((a, b) => b.failed - a.failed || b.total - a.total),
    };
  });

  app.get('/api/monitor/errors', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery, req.query);
    const { from, to } = range(q);
    const rows = await db
      .select({ errorClass: apiCalls.errorClass, errorCode: apiCalls.errorCode, httpStatus: apiCalls.httpStatus, n: sql<number>`count(*)`, lastAt: sql<Date>`max(${apiCalls.at})`, sample: sql<string>`max(${apiCalls.errorMessage})` })
      .from(apiCalls)
      .where(and(eq(apiCalls.success, false), gte(apiCalls.at, vnDateTime(from, '00:00')), lte(apiCalls.at, vnDateTime(addDays(to, 1), '00:00')), q.api ? eq(apiCalls.api, q.api) : sql`true`))
      .groupBy(apiCalls.errorClass, apiCalls.errorCode, apiCalls.httpStatus)
      .orderBy(desc(sql`count(*)`))
      .limit(100);
    return { items: rows.map((r) => ({ ...r, n: Number(r.n) })) };
  });

  app.get('/api/monitor/calls', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery.extend({ success: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().max(200).default(50), ref: z.string().optional() }), req.query);
    const { from, to } = range(q);
    const conds: SQL[] = [gte(apiCalls.at, vnDateTime(from, '00:00')), lte(apiCalls.at, vnDateTime(addDays(to, 1), '00:00'))];
    if (q.api) conds.push(eq(apiCalls.api, q.api));
    if (q.shopId) conds.push(eq(apiCalls.shopId, q.shopId));
    if (q.success) conds.push(eq(apiCalls.success, q.success === 'true'));
    if (q.ref) conds.push(sql`(${apiCalls.ref} = ${q.ref} OR ${apiCalls.requestId} = ${q.ref})`);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(apiCalls).where(and(...conds))) as [{ n: number }];
    const rows = await db
      .select({ c: apiCalls, alias: shops.alias, shopeeName: shops.shopeeName })
      .from(apiCalls)
      .leftJoin(shops, eq(shops.id, apiCalls.shopId))
      .where(and(...conds))
      .orderBy(desc(apiCalls.at))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items: rows.map((r) => ({ ...r.c, shopName: r.alias || r.shopeeName })), total: Number(n), page: q.page, pageSize: q.pageSize };
  });

  // Xuất CSV theo định dạng đối chiếu với Console Shopee (ngày, API, tổng, thành công, thất bại, tỷ lệ)
  app.get('/api/monitor/export', async (req, reply) => {
    requireRole(req, 'sysadmin', 'admin');
    const q = parse(monitorQuery, req.query);
    const { from, to } = range(q);
    const rows = await db
      .select()
      .from(apiDaily)
      .where(and(eq(apiDaily.shopId, 0), gte(apiDaily.day, from), lte(apiDaily.day, to)))
      .orderBy(asc(apiDaily.day), asc(apiDaily.api));
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="shopee-api-${from}_${to}.csv"`);
    return toCsv(
      ['Date', 'API', 'Total Calls', 'Success Calls', 'Failed Calls', 'Success Rate'],
      rows.map((r) => [r.day, `/api/v2/${r.api}`, r.total, r.success, r.total - r.success, r.total ? ((r.success / r.total) * 100).toFixed(2) + '%' : '']),
    );
  });

  // ───────────── Nhật ký hệ thống ─────────────
  app.get('/api/audit', async (req) => {
    const a = requireActor(req);
    if (!isStaff(a) && a.role !== 'owner') throw err.forbidden();
    const q = parse(z.object({ code: z.string().optional(), actorId: z.coerce.number().int().optional(), shopId: z.coerce.number().int().optional(), from: dateStr.optional(), to: dateStr.optional(), q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().max(200).default(50) }), req.query);
    const conds: SQL[] = [];
    if (a.role === 'owner') {
      const ids = await visibleShopIds(a);
      const members = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.parentId, a.id));
      const actorIds = [a.id, ...members.map((m) => m.id)];
      conds.push(sql`(${ids && ids.length ? inArray(activityLogs.shopId, ids) : sql`false`} OR ${inArray(activityLogs.actorId, actorIds)})`);
    }
    if (q.code) conds.push(eq(activityLogs.code, q.code));
    if (q.actorId) conds.push(eq(activityLogs.actorId, q.actorId));
    if (q.shopId) conds.push(eq(activityLogs.shopId, q.shopId));
    if (q.from) conds.push(gte(activityLogs.at, vnDateTime(q.from, '00:00')));
    if (q.to) conds.push(lte(activityLogs.at, vnDateTime(addDays(q.to, 1), '00:00')));
    if (q.q) conds.push(sql`lower(${activityLogs.actorName}) LIKE ${'%' + q.q.toLowerCase() + '%'}`);
    const where = conds.length ? and(...conds) : sql`true`;
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(activityLogs).where(where)) as [{ n: number }];
    const rows = await db
      .select({ l: activityLogs, alias: shops.alias, shopeeName: shops.shopeeName, target: accounts.username })
      .from(activityLogs)
      .leftJoin(shops, eq(shops.id, activityLogs.shopId))
      .leftJoin(accounts, eq(accounts.id, activityLogs.targetAccountId))
      .where(where)
      .orderBy(desc(activityLogs.at))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items: rows.map((r) => ({ ...r.l, shopName: r.alias || r.shopeeName || null, targetUsername: r.target, label: ACTIVITY_LABELS[r.l.code] ?? r.l.code })), total: Number(n), page: q.page, pageSize: q.pageSize, codes: ACTIVITY_LABELS };
  });
}
