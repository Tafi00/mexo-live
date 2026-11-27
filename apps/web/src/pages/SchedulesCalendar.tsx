import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Layers, List, RefreshCw } from 'lucide-react';
import { RUN_STATES, RUN_STATE_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtDate, todayVn } from '@/lib/format';
import { useLocalState } from '@/lib/hooks';
import { useShopOptions } from '@/components/domain/ShopPicker';
import { BulkScheduleDialog } from '@/components/schedule/BulkScheduleDialog';
import { ListView, MonthView, RunLegend, WeekView, type CalRun } from '@/components/schedule/CalendarViews';
import { RunSheet, type SheetState } from '@/components/schedule/RunSheet';
import { mondayOf } from '@/components/schedule/utils';
import { Button } from '@/components/ui/button';
import { Segmented, Select } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';

type View = 'week' | 'month' | 'list';

const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

function range(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysStr(from, i));
}

export default function SchedulesCalendar() {
  const { can } = useAuth();
  const canManage = can('schedule.manage');
  const [params, setParams] = useSearchParams();
  const [view, setView] = useLocalState<View>('mexo-cal-view', 'week');
  const [anchor, setAnchor] = useState(todayVn());
  const [status, setStatus] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [bulk, setBulk] = useState(false);
  const shopId = params.get('shopId') ?? '';
  const shops = useShopOptions();

  const setShop = (v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set('shopId', v);
    else p.delete('shopId');
    setParams(p, { replace: true });
  };

  // Khoảng ngày theo chế độ xem
  const { days, from, to, label, month } = useMemo(() => {
    if (view === 'month') {
      const first = anchor.slice(0, 8) + '01';
      const start = mondayOf(first);
      const nextFirst = addMonths(first, 1);
      const cells = Math.ceil((Date.parse(nextFirst) - Date.parse(start)) / 86400000 / 7) * 7;
      const days = range(start, cells);
      return { days, from: days[0], to: days[days.length - 1], label: `${MONTHS[Number(first.slice(5, 7)) - 1]}, ${first.slice(0, 4)}`, month: first.slice(0, 7) };
    }
    const start = mondayOf(anchor);
    const n = view === 'week' ? 7 : 14;
    const days = range(start, n);
    const end = days[n - 1];
    const lbl = start.slice(0, 7) === end.slice(0, 7) ? `${start.slice(8, 10)} – ${fmtDate(end)}` : `${fmtDate(start).slice(0, 5)} – ${fmtDate(end)}`;
    // Tuần: lấy thêm 1 ngày trước để hiện phần tiếp của lịch qua đêm
    return { days, from: view === 'week' ? addDaysStr(start, -1) : start, to: end, label: lbl, month: start.slice(0, 7) };
  }, [view, anchor]);

  const q = useQuery({
    queryKey: ['schedule-runs', { from, to, shopId, status }],
    queryFn: () => api.get<{ items: CalRun[] }>('/api/schedule-runs', { from, to, shopId, status }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const runs = q.data?.items ?? [];
  const visible = useMemo(() => (view === 'week' ? runs : runs.filter((r) => r.runDate >= days[0] && r.runDate <= days[days.length - 1])), [runs, view, days]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of runs) if (r.runDate >= days[0]) {
      const k = r.status === 'starting' ? 'live' : r.status === 'ending' ? 'live' : r.status;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [runs, days]);
  const total = visible.filter((r) => r.runDate >= days[0]).length;

  const step = (dir: number) => {
    if (view === 'month') setAnchor(addMonths(anchor.slice(0, 8) + '01', dir));
    else setAnchor(addDaysStr(anchor, dir * (view === 'week' ? 7 : 14)));
  };

  const open = (r: CalRun) => setSheet({ kind: 'run', run: r });
  const more = (title: string, list: CalRun[]) => setSheet({ kind: 'list', title, runs: list });

  const emptyNode = (compact: boolean) => (
    <EmptyState
      compact={compact}
      icon={CalendarClock}
      title="Không có lần phát nào trong khoảng này"
      description={shopId || status ? 'Thử bỏ bộ lọc shop hoặc trạng thái.' : 'Tạo lịch phát trong từng shop, hoặc tạo cùng lúc cho nhiều shop.'}
      action={canManage && !shopId && !status ? <Button variant="primary" icon={<Layers className="size-4" />} onClick={() => setBulk(true)}>Tạo lịch hàng loạt</Button> : undefined}
    />
  );

  return (
    <div>
      <PageHeader
        title="Lịch phát"
        description="Lịch phát tự động của tất cả gian hàng bạn quản lý · giờ Việt Nam (UTC+7)"
        actions={
          canManage && (
            <Button variant="primary" icon={<Layers className="size-4" />} onClick={() => setBulk(true)}>
              Tạo lịch hàng loạt
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => setAnchor(todayVn())}>
              Hôm nay
            </Button>
            <Button size="sm" variant="ghost" iconOnly icon={<ChevronLeft className="size-4" />} onClick={() => step(-1)} aria-label="Trước" />
            <Button size="sm" variant="ghost" iconOnly icon={<ChevronRight className="size-4" />} onClick={() => step(1)} aria-label="Sau" />
            <h2 className="ml-1 min-w-[150px] text-[15px] font-semibold tabular">{label}</h2>
            {q.isFetching && <Spinner className="size-3.5" />}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select inputSize="sm" value={shopId} onChange={(e) => setShop(e.target.value)} className="w-48">
              <option value="">Tất cả shop</option>
              {(shops.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.number} {s.name}
                </option>
              ))}
            </Select>
            <Select inputSize="sm" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="">Mọi trạng thái</option>
              {RUN_STATES.map((s) => (
                <option key={s} value={s}>
                  {RUN_STATE_LABELS[s]}
                </option>
              ))}
            </Select>
            <Segmented
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'week', label: <><CalendarDays className="size-3.5" />Tuần</> },
                { value: 'month', label: <><CalendarClock className="size-3.5" />Tháng</> },
                { value: 'list', label: <><List className="size-3.5" />Danh sách</> },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <RunLegend counts={counts} />
          <span className="text-xs text-muted">
            {total} lần phát{view === 'list' ? ' trong 14 ngày' : ''}
          </span>
        </div>

        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted">
            <RefreshCw className="size-4 animate-spin" /> Đang tải lịch…
          </div>
        ) : view === 'week' ? (
          <WeekView days={days} runs={visible} onOpen={open} onMore={more} />
        ) : view === 'month' ? (
          <MonthView
            days={days}
            month={month}
            runs={visible}
            onOpen={open}
            onMore={more}
            onPickDay={(d) => {
              setAnchor(d);
              setView('week');
            }}
          />
        ) : (
          <ListView runs={visible} onOpen={open} empty={emptyNode(false)} />
        )}
        {view !== 'list' && !q.isLoading && !q.isError && total === 0 && <div className="border-t border-line">{emptyNode(true)}</div>}
      </Card>

      <RunSheet state={sheet} onChange={setSheet} canManage={canManage} />
      <BulkScheduleDialog open={bulk} onClose={() => setBulk(false)} />
    </div>
  );
}
