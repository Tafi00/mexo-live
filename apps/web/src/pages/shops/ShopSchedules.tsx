import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Ban,
  CalendarCheck2,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  ChevronDown,
  Copy,
  ImageOff,
  MoonStar,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  SkipForward,
  Trash2,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, fmtTime } from '@/lib/format';
import { useAction, useLocalState, useNow } from '@/lib/hooks';
import type { ScheduleRun } from '@/lib/types';
import { RunStatusBadge } from '@/components/domain/status';
import { RunWindowText } from '@/components/schedule/CalendarViews';
import { ScheduleDialog } from '@/components/schedule/ScheduleDialog';
import { coverUrl, useShopTemplates, type ScheduleRow } from '@/components/schedule/ScheduleForm';
import { isOvernight, minutesLabel, relativeDay, repeatSummary, runIssueLabel, SCHEDULE_STATE, shortDay, windowLabel, windowMinutes } from '@/components/schedule/utils';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Segmented, Select } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, EmptyState, ErrorState, Menu, Skeleton, StatCard, Tooltip } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { useShop } from './ShopLayout';

type Schedule = ScheduleRow;

interface SchedulesResp {
  schedules: Schedule[];
  runs: ScheduleRun[];
  counts: Record<string, number>;
  today: string;
}

const STATE_ORDER: Record<string, number> = { active: 0, paused: 1, cancelled: 2 };
const isPending = (r: ScheduleRun) => ['upcoming', 'starting', 'live', 'ending'].includes(r.status);

function HowItWorks() {
  const [open, setOpen] = useLocalState('mexo-schedule-help', false);
  return (
    <Callout
      tone="info"
      icon={<Workflow className="size-4" />}
      title="Lịch phát tự động hoạt động thế nào?"
      action={
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
          {open ? 'Thu gọn' : 'Xem chi tiết'}
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      }
    >
      {open ? (
        <ol className="mt-1.5 list-decimal space-y-1 pl-4">
          <li>
            <b>Tới giờ bật</b>, hệ thống kiểm tra kết nối Shopee, phiên đang mở, video và sản phẩm của mẫu phát.
          </li>
          <li>Tạo phiên Shopee với tiêu đề và ảnh bìa của lịch (để trống thì lấy theo mẫu phát), rồi phát mẫu phát đã chọn.</li>
          <li>Phiên được bắt đầu khi Shopee nhận được hình; sản phẩm được ghim theo mẫu.</li>
          <li>
            <b>Tới giờ tắt</b>, hệ thống kết thúc đúng phiên do lịch tạo — không bao giờ đụng tới phiên tạo thủ công.
          </li>
          <li>
            Nếu lúc tới giờ shop đang bận (có phiên khác) hoặc hệ thống đang đóng băng, lần phát được ghi <b>“Bỏ lỡ”</b> và không phát bù sau đó.
          </li>
          <li>Khởi động lại hệ thống không bao giờ làm một lịch chạy hai lần.</li>
        </ol>
      ) : (
        <span>Tự tạo phiên, phát mẫu và tắt phiên đúng giờ. Lần bỏ lỡ không phát bù.</span>
      )}
    </Callout>
  );
}

function CoverThumb({ coverKey }: { coverKey: string | null }) {
  if (!coverKey)
    return (
      <Tooltip content="Thiếu ảnh bìa — lần phát sẽ bị bỏ lỡ">
        <span className="grid h-10 w-[30px] shrink-0 place-items-center rounded border border-dashed border-amber-400 text-amber-500">
          <ImageOff className="size-3.5" />
        </span>
      </Tooltip>
    );
  return <img src={coverUrl(coverKey)} alt="" className="h-10 w-[30px] shrink-0 rounded border border-line object-cover" loading="lazy" />;
}

export default function ShopSchedules() {
  const { shop } = useShop();
  const { can } = useAuth();
  const confirm = useConfirm();
  const canWrite = can('schedule.manage') && shop.service.state !== 'expired' && shop.status !== 'suspended';
  const q = useQuery({ queryKey: ['shop', shop.id, 'schedules'], queryFn: () => api.get<SchedulesResp>(`/api/shops/${shop.id}/schedules`), refetchInterval: 30_000 });

  const [dialog, setDialog] = useState<{ schedule: Schedule | null; notice?: string | null } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [runFilter, setRunFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [runSchedule, setRunSchedule] = useState('');

  const inv = [['shop', shop.id], ['schedule-runs']];
  const pause = useAction((id: number) => api.post(`/api/schedules/${id}/pause`), { success: 'Đã tạm dừng lịch, các lần phát sắp tới đã được gỡ', invalidate: inv });
  const resume = useAction((id: number) => api.post(`/api/schedules/${id}/resume`), { success: 'Đã bật lại lịch', invalidate: inv });
  const cancel = useAction((id: number) => api.post(`/api/schedules/${id}/cancel`), { success: 'Đã hủy lịch', invalidate: inv });
  const remove = useAction((id: number) => api.del<{ ok: boolean; deleted: boolean }>(`/api/schedules/${id}`), {
    success: (r) => (r.deleted ? 'Đã xóa lịch' : 'Lịch đã từng chạy nên được chuyển sang “Đã hủy” để giữ lịch sử'),
    invalidate: inv,
  });
  const duplicate = useAction((id: number) => api.post<{ id: number; note: string }>(`/api/schedules/${id}/duplicate`), {
    invalidate: inv,
    onSuccess: async (r) => {
      toast.success('Đã nhân bản lịch', { description: r.note });
      const fresh = await q.refetch();
      const copy = fresh.data?.schedules.find((s) => s.id === r.id);
      if (copy) setDialog({ schedule: copy, notice: r.note });
    },
  });
  const cancelRun = useAction((id: number) => api.post(`/api/schedule-runs/${id}/cancel`), { success: 'Đã bỏ lần phát này', invalidate: inv });

  const data = q.data;
  const now = useNow(60_000);
  const templates = useShopTemplates(shop.id);
  const tplCover = useMemo(() => new Map((templates.data?.items ?? []).map((t) => [t.id, t.coverKey])), [templates.data]);
  const schedules = useMemo(() => [...(data?.schedules ?? [])].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.id - a.id), [data]);
  const shown = showCancelled ? schedules : schedules.filter((s) => s.state !== 'cancelled');
  const cancelledCount = schedules.length - schedules.filter((s) => s.state !== 'cancelled').length;
  const byId = useMemo(() => new Map(schedules.map((s) => [s.id, s])), [schedules]);

  const nextRun = useMemo(() => {
    const m = new Map<number, ScheduleRun>();
    for (const r of data?.runs ?? []) if (r.status === 'upcoming' && Date.parse(r.startAt) > now && !m.has(r.scheduleId)) m.set(r.scheduleId, r);
    return m;
  }, [data, now]);
  const lastBad = useMemo(() => {
    const m = new Map<number, ScheduleRun>();
    for (const r of data?.runs ?? []) if (Date.parse(r.startAt) <= now && ['done', 'missed', 'failed'].includes(r.status)) m.set(r.scheduleId, r);
    for (const [k, v] of m) if (v.status === 'done') m.delete(k);
    return m;
  }, [data, now]);

  const runs = useMemo(() => {
    let list = data?.runs ?? [];
    if (runSchedule) list = list.filter((r) => String(r.scheduleId) === runSchedule);
    if (runFilter === 'upcoming') return list.filter(isPending);
    if (runFilter === 'past') return list.filter((r) => !isPending(r)).reverse();
    return list;
  }, [data, runFilter, runSchedule]);
  const upcomingCount = (data?.runs ?? []).filter(isPending).length;

  async function askCancel(s: Schedule) {
    const r = await confirm({
      title: `Hủy lịch “${s.title}”?`,
      description: 'Các lần phát sắp tới sẽ bị hủy. Lịch đã hủy không sửa hay bật lại được (có thể nhân bản để tạo lịch mới). Phiên đang phát theo lịch này, nếu có, vẫn tự tắt đúng giờ.',
      confirmText: 'Hủy lịch',
      cancelText: 'Giữ lịch',
      danger: true,
    });
    if (r.ok) cancel.mutate(s.id);
  }
  async function askDelete(s: Schedule) {
    const r = await confirm({
      title: `Xóa lịch “${s.title}”?`,
      description: 'Lịch chưa từng chạy sẽ bị xóa hẳn. Nếu lịch đã có lần chạy, hệ thống chuyển sang “Đã hủy” để giữ lịch sử phiên.',
      confirmText: 'Xóa lịch',
      danger: true,
    });
    if (r.ok) remove.mutate(s.id);
  }
  async function askCancelRun(r: ScheduleRun) {
    const s = byId.get(r.scheduleId);
    const ok = await confirm({
      title: 'Bỏ lần phát này?',
      description: `Lần phát ${shortDay(r.runDate)} lúc ${fmtTime(r.startAt)}${s ? ` của lịch “${s.title}”` : ''} sẽ không chạy. Các lần khác giữ nguyên.`,
      confirmText: 'Bỏ lần phát',
      danger: true,
    });
    if (ok.ok) cancelRun.mutate(r.id);
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const counts = data?.counts ?? {};
  const activeCount = schedules.filter((s) => s.state === 'active').length;
  const pausedCount = schedules.filter((s) => s.state === 'paused').length;

  return (
    <div className="space-y-4">
      <HowItWorks />

      {!canWrite && can('schedule.manage') && (
        <Callout tone="warning">Shop đã hết hạn dùng hoặc ngưng dịch vụ: vẫn xem được lịch nhưng không tạo hoặc sửa lịch mới. Các lần phát sắp tới sẽ bị bỏ lỡ.</Callout>
      )}

      {!data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Lịch đang chạy" value={activeCount} hint={pausedCount ? `${pausedCount} lịch tạm dừng` : "Không có lịch tạm dừng"} icon={<CalendarCheck2 className="size-4" />} tone="success" />
          <StatCard label="Sắp tới" value={counts.upcoming ?? 0} hint="14 ngày tới" icon={<CalendarClock className="size-4" />} tone="info" />
          <StatCard label="Đã chạy" value={counts.done ?? 0} hint="14 ngày qua" icon={<PlayCircle className="size-4" />} tone="neutral" />
          <StatCard
            label="Bỏ lỡ / lỗi"
            value={(counts.missed ?? 0) + (counts.failed ?? 0)}
            hint="14 ngày qua"
            icon={<CalendarX2 className="size-4" />}
            tone={(counts.missed ?? 0) + (counts.failed ?? 0) ? 'danger' : 'neutral'}
            onClick={() => setRunFilter('past')}
          />
        </div>
      )}

      <Card>
        <CardHeader
          title="Lịch phát"
          icon={<CalendarClock className="size-4" />}
          description="Giờ Việt Nam · mỗi shop phát một phiên tại một thời điểm"
          actions={
            <>
              <ButtonLink to={`/schedules?shopId=${shop.id}`} size="sm" variant="ghost">
                Xem trên lịch tổng
              </ButtonLink>
              {canWrite && (
                <Button size="sm" variant="primary" icon={<CalendarPlus className="size-3.5" />} onClick={() => setDialog({ schedule: null })}>
                  Tạo lịch
                </Button>
              )}
            </>
          }
        />
        {!data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !shown.length ? (
          <EmptyState
            icon={CalendarClock}
            title={schedules.length ? 'Không có lịch đang dùng' : 'Chưa có lịch phát'}
            description="Hẹn giờ để hệ thống tự tạo phiên, phát mẫu và tắt phiên đúng giờ — kể cả qua đêm."
            action={
              canWrite && (
                <Button variant="primary" icon={<CalendarPlus className="size-4" />} onClick={() => setDialog({ schedule: null })}>
                  Tạo lịch đầu tiên
                </Button>
              )
            }
          />
        ) : (
          <Table minWidth={940}>
            <THead>
              <tr>
                <Th>Lịch</Th>
                <Th>Mẫu phát</Th>
                <Th>Lặp lại</Th>
                <Th>Khung giờ</Th>
                <Th>Áp dụng</Th>
                <Th>Trạng thái</Th>
                <Th className="w-20" />
              </tr>
            </THead>
            <tbody>
              {shown.map((s) => {
                const st = SCHEDULE_STATE[s.state];
                const nr = nextRun.get(s.id);
                const bad = lastBad.get(s.id);
                const editable = canWrite && s.state !== 'cancelled';
                return (
                  <Tr key={s.id} className={cn(s.state === 'cancelled' && 'opacity-60')}>
                    <Td className="max-w-[300px]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CoverThumb coverKey={s.coverKey ?? (s.coverFromTemplate && s.templateId ? (tplCover.get(s.templateId) ?? null) : null)} />
                        <div className="min-w-0">
                          <button type="button" disabled={!editable} onClick={() => setDialog({ schedule: s })} className="block max-w-full truncate text-left font-medium enabled:hover:text-brand-600" title={s.title}>
                            {s.title}
                          </button>
                          {(s.titleFromTemplate || s.coverFromTemplate) && (
                            <p className="truncate text-2xs text-muted">
                              {s.titleFromTemplate && s.coverFromTemplate ? 'Tiêu đề & ảnh bìa theo mẫu phát' : s.titleFromTemplate ? 'Tiêu đề theo mẫu phát' : 'Ảnh bìa theo mẫu phát'}
                            </p>
                          )}
                          {!s.hasCover && <p className="truncate text-2xs font-medium text-amber-700 dark:text-amber-400">Thiếu ảnh bìa</p>}
                        </div>
                      </div>
                    </Td>
                    <Td className="max-w-[180px]">
                      {s.templateId && s.templateName ? (
                        <Link to={`/shops/${shop.id}/templates/${s.templateId}`} className="block truncate hover:text-brand-600" title={s.templateName}>
                          {s.templateName}
                        </Link>
                      ) : (
                        <Badge tone="warning" size="sm">
                          Chưa có mẫu
                        </Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <p>{repeatSummary(s)}</p>
                      {nr ? (
                        <p className="text-xs text-muted">
                          Lần tới: {relativeDay(nr.runDate) ?? shortDay(nr.runDate)} {fmtTime(nr.startAt)}
                        </p>
                      ) : s.state === 'active' ? (
                        <p className="text-xs text-subtle">Không có lần phát trong 14 ngày</p>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <p className="inline-flex items-center gap-1 font-medium tabular">
                        {isOvernight(s.startTime, s.endTime) && <MoonStar className="size-3.5 text-violet-500" />}
                        {windowLabel(s.startTime, s.endTime)}
                      </p>
                      <p className="text-xs text-muted">{minutesLabel(windowMinutes(s.startTime, s.endTime))}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">
                      {s.repeat === 'once' ? (
                        fmtDate(s.startDate)
                      ) : s.endDate ? (
                        <span className="tabular">
                          {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
                        </span>
                      ) : (
                        <span>
                          Từ {fmtDate(s.startDate)}
                          <span className="block text-xs text-muted">Không giới hạn</span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={st?.tone ?? 'neutral'} dot>
                        {st?.label ?? s.state}
                      </Badge>
                      {bad && s.state !== 'cancelled' && (
                        <p className="mt-0.5 truncate text-2xs text-rose-600 dark:text-rose-400" title={runIssueLabel(bad.issue) ?? ''}>
                          Lần gần nhất: {bad.status === 'missed' ? 'bỏ lỡ' : 'thất bại'}
                        </p>
                      )}
                    </Td>
                    <Td align="right" className="whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && s.state === 'active' && (
                          <Tooltip content="Tạm dừng">
                            <Button size="xs" variant="ghost" iconOnly icon={<PauseCircle className="size-4" />} loading={pause.isPending && pause.variables === s.id} onClick={() => pause.mutate(s.id)} aria-label="Tạm dừng" />
                          </Tooltip>
                        )}
                        {canWrite && s.state === 'paused' && (
                          <Tooltip content="Bật lại">
                            <Button size="xs" variant="ghost" iconOnly icon={<PlayCircle className="size-4 text-emerald-600" />} loading={resume.isPending && resume.variables === s.id} onClick={() => resume.mutate(s.id)} aria-label="Bật lại" />
                          </Tooltip>
                        )}
                        {canWrite && (
                          <Menu
                            trigger={({ toggle }) => <Button size="xs" variant="ghost" iconOnly icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="Thao tác" />}
                            items={[
                              { label: 'Sửa lịch', icon: <Pencil />, onClick: () => setDialog({ schedule: s }), hidden: s.state === 'cancelled' },
                              { label: 'Tạm dừng', icon: <PauseCircle />, onClick: () => pause.mutate(s.id), hidden: s.state !== 'active' },
                              { label: 'Bật lại', icon: <PlayCircle />, onClick: () => resume.mutate(s.id), hidden: s.state !== 'paused' },
                              { label: 'Nhân bản', icon: <Copy />, onClick: () => duplicate.mutate(s.id), hint: 'tạo bản tạm dừng' },
                              { label: 'Xem các lần phát', icon: <CalendarClock />, onClick: () => { setRunSchedule(String(s.id)); setRunFilter('all'); } },
                              { divider: true, label: '' },
                              { label: 'Hủy lịch', icon: <Ban />, danger: true, onClick: () => void askCancel(s), hidden: s.state === 'cancelled' },
                              { label: 'Xóa lịch', icon: <Trash2 />, danger: true, onClick: () => void askDelete(s) },
                            ]}
                          />
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {cancelledCount > 0 && (
          <div className="border-t border-line px-4 py-2.5">
            <button type="button" onClick={() => setShowCancelled(!showCancelled)} className="text-xs font-medium text-muted hover:text-fg">
              {showCancelled ? 'Ẩn lịch đã hủy' : `Hiện ${cancelledCount} lịch đã hủy`}
            </button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Các lần phát"
          icon={<SkipForward className="size-4" />}
          description="14 ngày qua và 14 ngày tới. Lần bỏ lỡ không được phát bù."
          actions={
            <>
              <Select inputSize="sm" value={runSchedule} onChange={(e) => setRunSchedule(e.target.value)} className="w-48">
                <option value="">Tất cả lịch</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
              <Segmented
                size="sm"
                value={runFilter}
                onChange={setRunFilter}
                options={[
                  { value: 'upcoming', label: 'Sắp tới', count: upcomingCount },
                  { value: 'past', label: 'Đã qua' },
                  { value: 'all', label: 'Tất cả' },
                ]}
              />
            </>
          }
        />
        {!data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !runs.length ? (
          <EmptyState compact icon={CalendarClock} title={runFilter === 'upcoming' ? 'Không có lần phát sắp tới' : 'Không có lần phát nào'} description={runFilter === 'upcoming' && activeCount === 0 ? 'Tạo hoặc bật lại một lịch để có lần phát.' : undefined} />
        ) : (
          <Table minWidth={900}>
            <THead>
              <tr>
                <Th>Ngày</Th>
                <Th>Khung giờ</Th>
                <Th>Lịch</Th>
                <Th>Trạng thái</Th>
                <Th>Vấn đề</Th>
                <Th>Phiên live</Th>
                <Th className="w-28" />
              </tr>
            </THead>
            <tbody>
              {runs.map((r) => {
                const s = byId.get(r.scheduleId);
                const issue = runIssueLabel(r.issue);
                const rel = relativeDay(r.runDate);
                return (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">
                      <span className="font-medium tabular">{shortDay(r.runDate)}</span>
                      {rel && <span className="ml-1.5 text-xs text-brand-600 dark:text-brand-400">{rel}</span>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <RunWindowText run={r} />
                    </Td>
                    <Td className="max-w-[220px]">
                      <p className="truncate">{s?.title ?? `Lịch #${r.scheduleId}`}</p>
                    </Td>
                    <Td>
                      <RunStatusBadge status={r.status} size="sm" />
                    </Td>
                    <Td className="max-w-[300px]">
                      {issue ? (
                        <div className="min-w-0 text-xs">
                          <p className="truncate font-medium text-rose-600 dark:text-rose-400">{issue}</p>
                          {r.issueDetail && (
                            <p className="truncate text-muted" title={r.issueDetail}>
                              {r.issueDetail}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      {r.sessionId ? (
                        <Link to={`/sessions/${r.sessionId}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                          Phiên #{r.sessionId}
                        </Link>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      {canWrite && r.status === 'upcoming' && Date.parse(r.startAt) > now && (
                        <Button size="xs" variant="ghost" icon={<SkipForward className="size-3.5" />} loading={cancelRun.isPending && cancelRun.variables === r.id} onClick={() => void askCancelRun(r)}>
                          Bỏ lần này
                        </Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <ScheduleDialog open={Boolean(dialog)} onClose={() => setDialog(null)} shopId={shop.id} schedule={dialog?.schedule ?? null} notice={dialog?.notice} />
    </div>
  );
}
