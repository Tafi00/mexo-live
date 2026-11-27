import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2, Clock, Hourglass, Loader2, Radio, XCircle, type LucideIcon } from 'lucide-react';
import { WEEKDAY_LABELS } from '@mexo/shared';
import { cn } from '@/lib/cn';
import { fmtDate, todayVn } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { ScheduleRun } from '@/lib/types';
import { RunStatusBadge } from '@/components/domain/status';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { DAY_MS, LEGEND_STATUSES, relativeDay, repeatSummary, runColor, runIssueLabel, runStatusLabel, vnDayStart, vnHm, vnParts, WEEK_ORDER, WEEKDAY_FULL, weekdayOfStr } from './utils';

export type CalRun = ScheduleRun & { title?: string; repeat?: string; templateName?: string | null; scheduleState?: string; shopName?: string; weekdays?: number[] };

export const STATUS_ICON: Record<string, LucideIcon> = {
  upcoming: Clock,
  starting: Loader2,
  live: Radio,
  ending: Hourglass,
  done: CheckCircle2,
  missed: AlertTriangle,
  failed: XCircle,
  cancelled: Ban,
};

export function RunStatusIcon({ status, className }: { status: string; className?: string }) {
  const Icon = STATUS_ICON[status] ?? Clock;
  return <Icon className={cn('size-3 shrink-0', status === 'live' && 'animate-pulse', className)} aria-hidden />;
}

function runTooltip(r: CalRun): string {
  const issue = runIssueLabel(r.issue);
  return [`${vnHm(r.startAt)} → ${vnHm(r.endAt)} · ${runStatusLabel(r.status)}`, r.shopName, r.title, issue].filter(Boolean).join('\n');
}

/** Chú thích màu trạng thái (màu luôn đi kèm nhãn chữ) */
export function RunLegend({ counts }: { counts?: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-muted">
      {LEGEND_STATUSES.map((s) => {
        const c = runColor(s);
        return (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('inline-flex size-4 items-center justify-center rounded border', c.block, c.text)}>
              <RunStatusIcon status={s} className="size-2.5 animate-none" />
            </span>
            {runStatusLabel(s)}
            {counts && counts[s] ? <span className="tabular text-subtle">({counts[s]})</span> : null}
          </span>
        );
      })}
    </div>
  );
}

// ───────────── Tuần ─────────────

const HOUR_PX = 44;
const MAX_LANES = 3;
const GRID_COLS = 'grid-cols-[52px_repeat(7,minmax(0,1fr))]';

interface Seg {
  run: CalRun;
  top: number; // phút trong ngày
  dur: number; // phút
  contBefore: boolean;
  contAfter: boolean;
  lane: number;
  lanes: number;
  cluster: number;
}

function layoutDay(runs: CalRun[], date: string): { segs: Seg[]; clusters: { id: number; top: number; lanes: number; runs: CalRun[] }[] } {
  const ds = vnDayStart(date);
  const de = ds + DAY_MS;
  const segs: Seg[] = [];
  for (const r of runs) {
    const s0 = Date.parse(r.startAt);
    const e0 = Date.parse(r.endAt);
    const s = Math.max(s0, ds);
    const e = Math.min(e0, de);
    if (e <= s) continue;
    segs.push({ run: r, top: (s - ds) / 60000, dur: (e - s) / 60000, contBefore: s0 < ds, contAfter: e0 > de, lane: 0, lanes: 1, cluster: 0 });
  }
  segs.sort((a, b) => a.top - b.top || b.dur - a.dur);
  const clusters: { id: number; top: number; lanes: number; runs: CalRun[] }[] = [];
  let cur: Seg[] = [];
  let curEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    if (!cur.length) return;
    const id = clusters.length;
    for (const s of cur) {
      s.lanes = laneEnds.length;
      s.cluster = id;
    }
    clusters.push({ id, top: cur[0].top, lanes: laneEnds.length, runs: cur.map((s) => s.run) });
    cur = [];
    laneEnds = [];
    curEnd = -1;
  };
  for (const s of segs) {
    // khối hiển thị tối thiểu 20 phút để không đè chữ
    const end = s.top + Math.max(s.dur, 20);
    if (s.top >= curEnd) flush();
    let lane = laneEnds.findIndex((le) => le <= s.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else laneEnds[lane] = end;
    s.lane = lane;
    cur.push(s);
    curEnd = Math.max(curEnd, end);
  }
  flush();
  return { segs, clusters };
}

export function WeekView({ days, runs, onOpen, onMore }: { days: string[]; runs: CalRun[]; onOpen: (r: CalRun) => void; onMore: (title: string, runs: CalRun[]) => void }) {
  const today = todayVn();
  const now = useNow(60_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layouts = useMemo(() => days.map((d) => layoutDay(runs, d)), [days, runs]);
  const nowMin = vnParts(now).minutes;

  // Cuộn tới lần phát sớm nhất trong tuần (hoặc 7:00)
  const firstTop = useMemo(() => {
    let m = Infinity;
    for (const l of layouts) for (const s of l.segs) m = Math.min(m, s.top);
    return m === Infinity ? 7 * 60 : m;
  }, [layouts]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, ((firstTop - 45) * HOUR_PX) / 60);
  }, [days[0], firstTop]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
      <div className="min-w-[820px]">
        {/* Tiêu đề ngày */}
        <div className={cn('sticky top-0 z-20 grid border-b border-line bg-surface', GRID_COLS)}>
          <div className="sticky left-0 z-10 bg-surface" />
          {days.map((d, i) => {
            const isToday = d === today;
            const n = layouts[i].segs.filter((s) => !s.contBefore).length;
            return (
              <div key={d} className="border-l border-line px-2 py-2 text-center">
                <p className={cn('text-[11px] font-semibold uppercase tracking-wide', isToday ? 'text-brand-600 dark:text-brand-400' : 'text-muted')}>{WEEKDAY_LABELS[weekdayOfStr(d)]}</p>
                <p className={cn('mx-auto mt-0.5 grid h-7 min-w-7 place-items-center rounded-full px-1.5 text-[15px] font-semibold tabular', isToday && 'bg-brand-500 text-white')}>{Number(d.slice(8, 10))}</p>
                <p className="mt-0.5 text-[11px] text-subtle">{n ? `${n} lần phát` : '—'}</p>
              </div>
            );
          })}
        </div>

        <div className={cn('relative grid', GRID_COLS)} style={{ height: 24 * HOUR_PX }}>
          {/* Cột giờ */}
          <div className="sticky left-0 z-10 bg-surface">
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="relative" style={{ height: HOUR_PX }}>
                {h > 0 && <span className="absolute -top-2 right-2 text-[10px] tabular text-subtle">{String(h).padStart(2, '0')}:00</span>}
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const { segs, clusters } = layouts[i];
            const isToday = d === today;
            const lanesOf = (n: number) => Math.min(n, MAX_LANES);
            return (
              <div
                key={d}
                className={cn('relative border-l border-line', isToday && 'bg-brand-50/30 dark:bg-brand-950/10')}
                style={{ backgroundImage: 'linear-gradient(to bottom, var(--line) 1px, transparent 1px)', backgroundSize: `100% ${HOUR_PX}px` }}
              >
                {segs.map((s) => {
                  const lanes = lanesOf(s.lanes);
                  if (s.lanes > MAX_LANES && s.lane >= MAX_LANES - 1) return null;
                  const h = Math.max((s.dur * HOUR_PX) / 60, 20);
                  const c = runColor(s.run.status);
                  const timeLabel = s.contBefore ? `→ ${vnHm(s.run.endAt)}` : s.contAfter ? `${vnHm(s.run.startAt)} →` : `${vnHm(s.run.startAt)}–${vnHm(s.run.endAt)}`;
                  return (
                    <button
                      key={`${s.run.id}-${d}`}
                      type="button"
                      title={runTooltip(s.run)}
                      onClick={() => onOpen(s.run)}
                      className={cn(
                        'absolute z-[1] flex flex-col overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm transition-colors',
                        c.block,
                        s.contBefore && 'rounded-t-none border-t-2 [border-top-style:dashed]',
                        s.contAfter && 'rounded-b-none border-b-2 [border-bottom-style:dashed]',
                      )}
                      style={{ top: (s.top * HOUR_PX) / 60 + 1, height: h - 2, left: `calc(${(s.lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                    >
                      <span className={cn('flex min-w-0 items-center gap-1 font-semibold tabular', c.text)}>
                        <RunStatusIcon status={s.run.status} />
                        <span className="truncate">{timeLabel}</span>
                      </span>
                      {h >= 34 && <span className={cn('truncate font-medium', c.text)}>{s.run.shopName}</span>}
                      {h >= 50 && <span className="truncate text-muted">{s.run.title}</span>}
                      {h >= 66 && <span className={cn('truncate text-[10px] font-medium', c.text)}>{runStatusLabel(s.run.status)}</span>}
                    </button>
                  );
                })}
                {clusters
                  .filter((c) => c.lanes > MAX_LANES)
                  .map((c) => {
                    const hidden = c.runs.length - segs.filter((s) => s.cluster === c.id && s.lane < MAX_LANES - 1).length;
                    return (
                      <button
                        key={`more-${c.id}`}
                        type="button"
                        onClick={() => onMore(`${WEEKDAY_FULL[weekdayOfStr(d)]}, ${fmtDate(d)} · từ ${String(Math.floor(c.top / 60)).padStart(2, '0')}:${String(Math.floor(c.top % 60)).padStart(2, '0')}`, c.runs)}
                        className="absolute z-[2] rounded-md border border-line-strong bg-surface px-1 py-0.5 text-[11px] font-semibold text-fg shadow-sm hover:bg-surface-2"
                        style={{ top: (c.top * HOUR_PX) / 60 + 1, left: `calc(${((MAX_LANES - 1) / MAX_LANES) * 100}% + 2px)`, width: `calc(${100 / MAX_LANES}% - 4px)` }}
                        title={`${c.runs.length} lần phát cùng khung giờ`}
                      >
                        +{hidden}
                      </button>
                    );
                  })}
                {isToday && (
                  <div className="pointer-events-none absolute inset-x-0 z-[3] flex items-center" style={{ top: (nowMin * HOUR_PX) / 60 }}>
                    <span className="-ml-1 size-2 rounded-full bg-rose-500" />
                    <span className="h-px flex-1 bg-rose-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────── Tháng ─────────────

export function MonthView({ days, month, runs, onOpen, onMore, onPickDay }: { days: string[]; month: string; runs: CalRun[]; onOpen: (r: CalRun) => void; onMore: (title: string, runs: CalRun[]) => void; onPickDay: (date: string) => void }) {
  const today = todayVn();
  const byDay = useMemo(() => {
    const m = new Map<string, CalRun[]>();
    for (const r of runs) {
      const d = r.runDate;
      const arr = m.get(d) ?? [];
      arr.push(r);
      m.set(d, arr);
    }
    return m;
  }, [runs]);
  const MAX = 3;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
          {WEEK_ORDER.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
              {WEEKDAY_LABELS[d]}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d.slice(0, 7) === month;
            const isToday = d === today;
            return (
              <div key={d} className={cn('min-h-[112px] border-b border-line p-1.5', i % 7 !== 0 && 'border-l', !inMonth && 'bg-surface-2/40')}>
                <div className="mb-1 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onPickDay(d)}
                    title="Xem tuần này"
                    className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold tabular hover:bg-surface-3', isToday ? 'bg-brand-500 text-white hover:bg-brand-600' : inMonth ? 'text-fg' : 'text-subtle')}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                  {list.length > 0 && <span className="text-[10px] tabular text-subtle">{list.length}</span>}
                </div>
                <div className="space-y-0.5">
                  {list.slice(0, MAX).map((r) => {
                    const c = runColor(r.status);
                    return (
                      <button key={r.id} type="button" title={runTooltip(r)} onClick={() => onOpen(r)} className={cn('flex w-full min-w-0 items-center gap-1 rounded border px-1 py-px text-left text-[11px] leading-[16px] transition-colors', c.block, c.text)}>
                        <RunStatusIcon status={r.status} className="size-2.5" />
                        <span className="shrink-0 font-semibold tabular">{vnHm(r.startAt)}</span>
                        <span className="truncate">{r.shopName}</span>
                      </button>
                    );
                  })}
                  {list.length > MAX && (
                    <button type="button" onClick={() => onMore(`${WEEKDAY_FULL[weekdayOfStr(d)]}, ${fmtDate(d)}`, list)} className="w-full rounded px-1 py-px text-left text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
                      +{list.length - MAX} lần phát khác
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ───────────── Danh sách ─────────────

export function RunWindowText({ run }: { run: Pick<ScheduleRun, 'startAt' | 'endAt'> }) {
  const s = vnParts(run.startAt);
  const e = vnParts(run.endAt);
  return (
    <span className="tabular">
      {vnHm(run.startAt)} → {vnHm(run.endAt)}
      {e.date !== s.date && <span className="ml-1 text-xs text-muted">(hôm sau)</span>}
    </span>
  );
}

export function ListView({ runs, onOpen, empty }: { runs: CalRun[]; onOpen: (r: CalRun) => void; empty: ReactNode }) {
  const groups = useMemo(() => {
    const m = new Map<string, CalRun[]>();
    for (const r of runs) {
      const arr = m.get(r.runDate) ?? [];
      arr.push(r);
      m.set(r.runDate, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [runs]);
  if (!groups.length) return <>{empty}</>;
  return (
    <Table minWidth={900}>
      <THead>
        <tr>
          <Th className="w-32">Giờ</Th>
          <Th>Shop</Th>
          <Th>Tiêu đề phiên</Th>
          <Th>Lặp lại</Th>
          <Th>Trạng thái</Th>
          <Th>Vấn đề</Th>
          <Th align="right">Phiên</Th>
        </tr>
      </THead>
      <tbody>
        {groups.map(([date, list]) => (
          <GroupRows key={date} date={date} list={list} onOpen={onOpen} />
        ))}
      </tbody>
    </Table>
  );
}

function GroupRows({ date, list, onOpen }: { date: string; list: CalRun[]; onOpen: (r: CalRun) => void }) {
  const rel = relativeDay(date);
  const missed = list.filter((r) => r.status === 'missed' || r.status === 'failed').length;
  return (
    <>
      <tr>
        <td colSpan={7} className="border-b border-line bg-surface-2/50 px-4 py-1.5 text-xs">
          <span className="font-semibold text-fg">
            {WEEKDAY_FULL[weekdayOfStr(date)]}, {fmtDate(date)}
          </span>
          {rel && <span className="ml-2 rounded bg-brand-50 px-1.5 py-px text-[11px] font-medium text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">{rel}</span>}
          <span className="ml-2 text-muted">
            {list.length} lần phát{missed ? ` · ${missed} bỏ lỡ/thất bại` : ''}
          </span>
        </td>
      </tr>
      {list.map((r) => {
        const issue = runIssueLabel(r.issue);
        return (
          <Tr key={r.id} onClick={() => onOpen(r)}>
            <Td className="whitespace-nowrap font-medium">
              <RunWindowText run={r} />
            </Td>
            <Td className="max-w-[200px]">
              <Link to={`/shops/${r.shopId}/schedules`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:text-brand-600">
                {r.shopName}
              </Link>
            </Td>
            <Td className="max-w-[260px]">
              <p className="truncate">{r.title}</p>
              {r.templateName && <p className="truncate text-xs text-muted">Mẫu: {r.templateName}</p>}
            </Td>
            <Td className="whitespace-nowrap text-muted">{r.repeat ? repeatSummary({ repeat: r.repeat, weekdays: r.weekdays }) : '—'}</Td>
            <Td>
              <RunStatusBadge status={r.status} size="sm" />
            </Td>
            <Td className="max-w-[240px]">
              {issue ? (
                <p className="truncate text-xs text-rose-600 dark:text-rose-400" title={[issue, r.issueDetail].filter(Boolean).join(': ')}>
                  {issue}
                  {r.issueDetail && <span className="text-muted"> · {r.issueDetail}</span>}
                </p>
              ) : (
                <span className="text-subtle">—</span>
              )}
            </Td>
            <Td align="right">
              {r.sessionId ? (
                <Link to={`/sessions/${r.sessionId}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                  Mở phiên
                </Link>
              ) : (
                <span className="text-subtle">—</span>
              )}
            </Td>
          </Tr>
        );
      })}
    </>
  );
}
