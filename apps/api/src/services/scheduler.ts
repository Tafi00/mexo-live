import { and, eq, gte, inArray, lte, ne, or, isNull, lt, sql } from 'drizzle-orm';
import { addDays, vnDate, vnDateTime, weekdayOf } from '@mexo/shared';
import { db } from '../db/client.js';
import { liveSessions, scheduleRuns, schedules, shops, templates } from '../db/schema.js';
import { err } from '../lib/errors.js';
import { shopServiceState } from '../auth/auth.js';
import { raiseAlert, resolveAlert } from './alerts.js';
import { SYSTEM_ACTOR } from './audit.js';
import { getSetting, isFrozen } from './settings.js';
import { createLiveSession, endLiveSession, getOpenSession, preflight, startAutoPlay, logEvent } from './sessions.js';
import { publish } from './events.js';

type ScheduleRow = typeof schedules.$inferSelect;

/** Các ngày phát của lịch trong khoảng [from, to] */
export function occurrences(s: Pick<ScheduleRow, 'repeat' | 'weekdays' | 'startDate' | 'endDate'>, from: string, to: string): string[] {
  const out: string[] = [];
  const start = s.startDate > from ? s.startDate : from;
  const end = s.endDate && s.endDate < to ? s.endDate : to;
  if (s.repeat === 'once') {
    if (s.startDate >= from && s.startDate <= to) out.push(s.startDate);
    return out;
  }
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (s.repeat === 'daily' || (s.repeat === 'weekly' && (s.weekdays ?? []).includes(weekdayOf(d)))) out.push(d);
    if (out.length > 400) break;
  }
  return out;
}

export function runWindow(date: string, startTime: string, endTime: string): { startAt: Date; endAt: Date } {
  const startAt = vnDateTime(date, startTime);
  const endDate = endTime <= startTime ? addDays(date, 1) : date;
  return { startAt, endAt: vnDateTime(endDate, endTime) };
}

/** Kiểm tra lịch bị chồng khung giờ với các lịch khác của cùng shop (xét 21 ngày tới) */
export async function findOverlap(shopId: number, candidate: Pick<ScheduleRow, 'repeat' | 'weekdays' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>, excludeId?: number) {
  const today = vnDate();
  const horizonEnd = addDays(candidate.startDate > today ? candidate.startDate : today, 21);
  const from = candidate.startDate > today ? candidate.startDate : addDays(today, -1);
  const others = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.shopId, shopId), eq(schedules.state, 'active'), excludeId ? ne(schedules.id, excludeId) : sql`true`));
  const mine = occurrences(candidate, from, horizonEnd).map((d) => runWindow(d, candidate.startTime, candidate.endTime));
  for (const o of others) {
    const theirs = occurrences(o, addDays(from, -1), horizonEnd).map((d) => ({ d, ...runWindow(d, o.startTime, o.endTime) }));
    for (const a of mine) for (const b of theirs) if (a.startAt < b.endAt && b.startAt < a.endAt) return { schedule: o, date: b.d };
  }
  return null;
}

/** Sinh các lần phát cho N ngày tới (idempotent nhờ unique(schedule_id, run_date)) */
export async function materializeRuns(scheduleId?: number): Promise<void> {
  const limits = await getSetting('limits');
  const today = vnDate();
  const horizon = addDays(today, Math.min(limits.scheduleDaysAhead, 60));
  const list = await db
    .select()
    .from(schedules)
    .where(scheduleId ? eq(schedules.id, scheduleId) : eq(schedules.state, 'active'));
  for (const s of list) {
    if (s.state !== 'active') continue;
    const dates = occurrences(s, addDays(today, -1), horizon);
    const values = dates
      .map((d) => ({ scheduleId: s.id, shopId: s.shopId, runDate: d, ...runWindow(d, s.startTime, s.endTime) }))
      .filter((v) => v.endAt.getTime() > Date.now());
    for (let i = 0; i < values.length; i += 100) await db.insert(scheduleRuns).values(values.slice(i, i + 100)).onConflictDoNothing();
  }
}

/** Xóa các lần phát tương lai chưa chạy (khi sửa/tạm dừng/hủy lịch) */
export async function clearFutureRuns(scheduleId: number, status: 'delete' | 'cancel' = 'delete'): Promise<void> {
  const cond = and(eq(scheduleRuns.scheduleId, scheduleId), eq(scheduleRuns.status, 'upcoming'), gte(scheduleRuns.startAt, new Date()));
  if (status === 'delete') await db.delete(scheduleRuns).where(cond);
  else await db.update(scheduleRuns).set({ status: 'cancelled', issue: 'schedule_cancelled' }).where(cond);
}

async function failRun(runId: number, status: 'missed' | 'failed', issue: string, detail?: string) {
  const [run] = await db
    .update(scheduleRuns)
    .set({ status, issue, issueDetail: detail?.slice(0, 500) ?? null, lockedAt: null })
    .where(eq(scheduleRuns.id, runId))
    .returning();
  if (run) {
    const [shop] = await db.select().from(shops).where(eq(shops.id, run.shopId));
    await raiseAlert({
      key: `schedule_start_failed:${run.id}`,
      type: 'schedule_start_failed',
      severity: 'warning',
      shopId: run.shopId,
      message: `${shop?.alias || shop?.shopeeName}: lịch ${run.runDate} không bật được (${issue}${detail ? ': ' + detail : ''})`,
    });
    publish({ type: 'shop', shopId: run.shopId });
  }
}

/** Thực thi bật lịch: kiểm tra → tạo phiên → giao mẫu phát → máy phát → bắt đầu khi có hình */
async function executeStart(runId: number): Promise<void> {
  const [run] = await db.select().from(scheduleRuns).where(eq(scheduleRuns.id, runId));
  if (!run) return;
  const [sch] = await db.select().from(schedules).where(eq(schedules.id, run.scheduleId));
  const [shop] = await db.select().from(shops).where(eq(shops.id, run.shopId));
  if (!sch || !shop) return failRun(runId, 'missed', 'schedule_cancelled');
  if (!sch.templateId) return failRun(runId, 'missed', 'no_template');
  if (!sch.coverKey) return failRun(runId, 'missed', 'no_cover');
  const [tpl] = await db.select().from(templates).where(eq(templates.id, sch.templateId));
  if (!tpl) return failRun(runId, 'missed', 'no_template');
  const svc = shopServiceState(shop);
  if (svc.state === 'expired') return failRun(runId, 'missed', 'shop_expired');
  if (svc.state === 'suspended') return failRun(runId, 'missed', 'shop_suspended');
  if (shop.connection !== 'ok' && shop.connection !== 'expiring') return failRun(runId, 'missed', 'shop_disconnected');
  const open = await getOpenSession(shop.id);
  if (open) return failRun(runId, 'missed', 'shop_busy', `Phiên "${open.title}" đang mở`);

  let sessionId: number;
  try {
    const s = await createLiveSession(SYSTEM_ACTOR, shop, {
      title: sch.title,
      description: sch.description,
      coverKey: sch.coverKey,
      templateId: sch.templateId,
      origin: 'schedule',
      scheduleRunId: run.id,
    });
    sessionId = s.id;
    await db.update(scheduleRuns).set({ sessionId: s.id }).where(eq(scheduleRuns.id, run.id));
    await logEvent(s.id, 'info', 'schedule', `Tạo tự động theo lịch phát ngày ${run.runDate}`);
  } catch (e) {
    return failRun(runId, 'missed', 'create_failed', e instanceof Error ? e.message : String(e));
  }
  try {
    const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
    const pf = await preflight(shop, s!, sch.templateId);
    if (!pf.ok) {
      const failed = pf.checks.filter((c) => !c.ok);
      const issue = failed.some((c) => c.key === 'server') ? 'no_server' : 'template_invalid';
      // Giao mẫu thất bại → tắt phiên vừa tạo để không treo shop
      await endLiveSession(SYSTEM_ACTOR, shop, s!, 'schedule_start_failed').catch(() => {});
      return failRun(runId, 'missed', issue, failed.map((c) => c.label + (c.detail ? ` (${c.detail})` : '')).join('; '));
    }
    await startAutoPlay(SYSTEM_ACTOR, shop, s!, sch.templateId);
    await db.update(scheduleRuns).set({ status: 'live', startedAt: new Date(), lockedAt: null, issue: null }).where(eq(scheduleRuns.id, runId));
    await resolveAlert(`schedule_start_failed:${runId}`);
    publish({ type: 'shop', shopId: shop.id });
  } catch (e) {
    const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
    if (s) await endLiveSession(SYSTEM_ACTOR, shop, s, 'schedule_start_failed').catch(() => {});
    return failRun(runId, 'missed', 'start_failed', e instanceof Error ? e.message : String(e));
  }
}

async function executeEnd(run: typeof scheduleRuns.$inferSelect): Promise<void> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, run.shopId));
  const [s] = run.sessionId ? await db.select().from(liveSessions).where(eq(liveSessions.id, run.sessionId)) : [];
  if (!shop || !s || s.state === 'ended') {
    await db.update(scheduleRuns).set({ status: 'done', endedAt: new Date(), issue: s && s.endedReason !== 'schedule_ended' ? 'ended_manually' : null }).where(eq(scheduleRuns.id, run.id));
    return;
  }
  try {
    await endLiveSession(SYSTEM_ACTOR, shop, s, 'schedule_ended');
    await db.update(scheduleRuns).set({ status: 'done', endedAt: new Date() }).where(eq(scheduleRuns.id, run.id));
    await resolveAlert(`schedule_end_failed:${run.id}`);
  } catch (e) {
    const attempts = run.attempts + 1;
    const backoffMin = Math.min(10, 2 ** Math.min(attempts, 4) / 2);
    await db
      .update(scheduleRuns)
      .set({ attempts, nextAttemptAt: new Date(Date.now() + backoffMin * 60000), issue: 'end_failed', issueDetail: e instanceof Error ? e.message.slice(0, 300) : null })
      .where(eq(scheduleRuns.id, run.id));
    if (attempts >= 3) {
      await raiseAlert({ key: `schedule_end_failed:${run.id}`, type: 'schedule_end_failed', severity: 'critical', shopId: run.shopId, message: `${shop.alias || shop.shopeeName}: chưa tắt được phiên theo lịch (${attempts} lần thử)` });
    }
  }
}

let lastMaterialize = 0;

export async function schedulerTick(): Promise<void> {
  const now = new Date();
  if (Date.now() - lastMaterialize > 5 * 60000) {
    lastMaterialize = Date.now();
    await materializeRuns();
  }
  const limits = await getSetting('limits');
  const frozen = await isFrozen();
  const graceMs = limits.scheduleStartGraceMin * 60000;

  // Bật lịch tới giờ — claim nguyên tử để không chạy trùng khi nhiều tiến trình / khởi động lại
  const due = await db
    .select()
    .from(scheduleRuns)
    .where(and(eq(scheduleRuns.status, 'upcoming'), lte(scheduleRuns.startAt, now)))
    .limit(50);
  for (const run of due) {
    if (frozen) {
      await db.update(scheduleRuns).set({ status: 'missed', issue: 'frozen' }).where(and(eq(scheduleRuns.id, run.id), eq(scheduleRuns.status, 'upcoming')));
      continue;
    }
    if (now.getTime() - run.startAt.getTime() > graceMs || run.endAt <= now) {
      await db
        .update(scheduleRuns)
        .set({ status: 'missed', issue: 'system_down' })
        .where(and(eq(scheduleRuns.id, run.id), eq(scheduleRuns.status, 'upcoming')));
      continue;
    }
    const claimed = await db
      .update(scheduleRuns)
      .set({ status: 'starting', lockedAt: now, attempts: sql`${scheduleRuns.attempts} + 1` })
      .where(and(eq(scheduleRuns.id, run.id), eq(scheduleRuns.status, 'upcoming')))
      .returning({ id: scheduleRuns.id });
    if (!claimed.length) continue;
    await executeStart(run.id);
  }

  // Tắt lịch tới giờ (kể cả khi đóng băng: mở băng sẽ tắt các phiên đã quá giờ)
  if (!frozen) {
    const ending = await db
      .select()
      .from(scheduleRuns)
      .where(and(inArray(scheduleRuns.status, ['live', 'starting']), lte(scheduleRuns.endAt, now), or(isNull(scheduleRuns.nextAttemptAt), lte(scheduleRuns.nextAttemptAt, now))))
      .limit(50);
    for (const run of ending) {
      if (run.status === 'starting' && run.lockedAt && now.getTime() - run.lockedAt.getTime() < 120000) continue;
      await executeEnd(run);
    }
  }
}

/** Khôi phục sau khởi động lại: lần phát kẹt ở "đang bật" */
export async function recoverRuns(): Promise<void> {
  const stale = await db
    .select()
    .from(scheduleRuns)
    .where(and(eq(scheduleRuns.status, 'starting'), lt(scheduleRuns.lockedAt, new Date(Date.now() - 2 * 60000))));
  for (const run of stale) {
    if (run.sessionId) {
      const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, run.sessionId));
      if (s && s.state !== 'ended') {
        await db.update(scheduleRuns).set({ status: 'live', lockedAt: null }).where(eq(scheduleRuns.id, run.id));
        continue;
      }
    }
    await db.update(scheduleRuns).set({ status: 'missed', issue: 'restarted', lockedAt: null }).where(eq(scheduleRuns.id, run.id));
  }
}

export async function validateScheduleInput(shopId: number, input: { templateId: number | null; startTime: string; endTime: string; startDate: string; endDate: string | null; repeat: string; weekdays: number[] }, excludeId?: number) {
  if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) throw err.badRequest('bad_time', 'Giờ phải theo định dạng HH:mm (24 giờ)');
  if (input.startTime === input.endTime) throw err.badRequest('bad_time', 'Giờ tắt phải khác giờ bật');
  if (input.repeat === 'weekly' && !input.weekdays.length) throw err.badRequest('no_weekdays', 'Chọn ít nhất một thứ trong tuần');
  if (input.endDate && input.endDate < input.startDate) throw err.badRequest('bad_dates', 'Ngày kết thúc phải sau ngày bắt đầu');
  const limits = await getSetting('limits');
  if (input.startDate > addDays(vnDate(), limits.scheduleDaysAhead)) throw err.badRequest('too_far', `Chỉ được hẹn trước tối đa ${limits.scheduleDaysAhead} ngày`);
  if (input.repeat === 'once' && runWindow(input.startDate, input.startTime, input.endTime).startAt.getTime() < Date.now())
    throw err.badRequest('in_past', 'Giờ bật đã qua');
  if (input.templateId) {
    const [t] = await db.select({ shopId: templates.shopId }).from(templates).where(eq(templates.id, input.templateId));
    if (!t || t.shopId !== shopId) throw err.badRequest('bad_template', 'Mẫu phát không thuộc shop này');
  }
  const overlap = await findOverlap(shopId, { ...input, weekdays: input.weekdays } as any, excludeId);
  if (overlap) throw err.conflict('schedule_overlap', `Trùng khung giờ với lịch "${overlap.schedule.title}" (${overlap.schedule.startTime}–${overlap.schedule.endTime}) ngày ${overlap.date}`);
  const [active] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schedules)
    .where(and(eq(schedules.shopId, shopId), eq(schedules.state, 'active'), excludeId ? ne(schedules.id, excludeId) : sql`true`));
  if (Number(active?.n ?? 0) >= limits.maxActiveSchedulesPerShop) throw err.conflict('too_many', `Mỗi shop tối đa ${limits.maxActiveSchedulesPerShop} lịch đang hoạt động`);
}
