import { ArrowLeft, CalendarClock, ChevronRight, Radio, SkipForward } from 'lucide-react';
import { REPEAT_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { RunStatusBadge } from '@/components/domain/status';
import { Button, ButtonLink } from '@/components/ui/button';
import { Sheet, useConfirm } from '@/components/ui/dialog';
import { Badge, Callout, KV } from '@/components/ui/misc';
import { RunStatusIcon, RunWindowText, type CalRun } from './CalendarViews';
import { minutesLabel, relativeDay, runColor, runIssueLabel, SCHEDULE_STATE, vnHm, WEEKDAY_FULL, weekdayOfStr } from './utils';

export type SheetState = { kind: 'run'; run: CalRun; back?: { title: string; runs: CalRun[] } } | { kind: 'list'; title: string; runs: CalRun[] } | null;

/** Chi tiết 1 lần phát (hoặc danh sách nhiều lần phát cùng khung giờ) trên lịch toàn hệ thống */
export function RunSheet({ state, onChange, canManage }: { state: SheetState; onChange: (s: SheetState) => void; canManage: boolean }) {
  const confirm = useConfirm();
  const cancel = useAction((id: number) => api.post(`/api/schedule-runs/${id}/cancel`), {
    success: 'Đã bỏ lần phát này',
    invalidate: [['schedule-runs'], ['shop']],
    onSuccess: () => onChange(null),
  });

  const close = () => onChange(null);
  if (!state) return null;

  if (state.kind === 'list') {
    return (
      <Sheet open onClose={close} title={state.title} description={`${state.runs.length} lần phát`} width="max-w-md">
        <ul className="-mx-5 -my-4 divide-y divide-line">
          {state.runs.map((r) => {
            const c = runColor(r.status);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onChange({ kind: 'run', run: r, back: { title: state.title, runs: state.runs } })} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2/60">
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-md border', c.block, c.text)}>
                    <RunStatusIcon status={r.status} className="size-3.5 animate-none" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.shopName}</p>
                    <p className="truncate text-xs text-muted">
                      <span className="tabular">
                        {vnHm(r.startAt)}–{vnHm(r.endAt)}
                      </span>{' '}
                      · {r.title}
                    </p>
                  </div>
                  <RunStatusBadge status={r.status} size="sm" />
                  <ChevronRight className="size-4 shrink-0 text-subtle" />
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    );
  }

  const r = state.run;
  const issue = runIssueLabel(r.issue);
  const rel = relativeDay(r.runDate);
  const dur = Math.round((Date.parse(r.endAt) - Date.parse(r.startAt)) / 60000);
  const st = r.scheduleState ? SCHEDULE_STATE[r.scheduleState] : null;

  async function doCancel() {
    const ok = await confirm({
      title: 'Bỏ lần phát này?',
      description: (
        <>
          Lần phát <b>{fmtDate(r.runDate)}</b> lúc <b>{vnHm(r.startAt)}</b> của <b>{r.shopName}</b> sẽ không chạy. Các lần khác của lịch vẫn giữ nguyên.
        </>
      ),
      confirmText: 'Bỏ lần phát',
      danger: true,
    });
    if (ok.ok) cancel.mutate(r.id);
  }

  return (
    <Sheet
      open
      onClose={close}
      width="max-w-md"
      title={r.title ?? 'Lần phát'}
      description={r.shopName}
      footer={
        <>
          {canManage && r.status === 'upcoming' && (
            <Button variant="danger-outline" size="sm" icon={<SkipForward className="size-3.5" />} loading={cancel.isPending} onClick={doCancel} className="mr-auto">
              Bỏ lần này
            </Button>
          )}
          {r.sessionId && (
            <ButtonLink to={`/sessions/${r.sessionId}`} size="sm" icon={<Radio className="size-3.5" />}>
              Mở phiên
            </ButtonLink>
          )}
          <ButtonLink to={`/shops/${r.shopId}/schedules`} size="sm" variant="primary" icon={<CalendarClock className="size-3.5" />}>
            Lịch của shop
          </ButtonLink>
        </>
      }
    >
      <div className="space-y-4">
        {state.back && (
          <button type="button" onClick={() => onChange({ kind: 'list', ...state.back! })} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" /> {state.back.title}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={r.status} />
          {rel && <Badge tone="brand" size="sm">{rel}</Badge>}
          {st && r.scheduleState !== 'active' && (
            <Badge tone={st.tone} size="sm">
              Lịch: {st.label}
            </Badge>
          )}
        </div>
        <KV
          cols={2}
          items={[
            { label: 'Ngày phát', value: `${WEEKDAY_FULL[weekdayOfStr(r.runDate)]}, ${fmtDate(r.runDate)}` },
            { label: 'Khung giờ (giờ VN)', value: <RunWindowText run={r} /> },
            { label: 'Thời lượng', value: minutesLabel(dur) },
            { label: 'Lặp lại', value: r.repeat ? REPEAT_LABELS[r.repeat as keyof typeof REPEAT_LABELS] ?? r.repeat : '—' },
            { label: 'Mẫu phát', value: r.templateName ?? <span className="text-amber-600">Chưa có mẫu</span> },
            { label: 'Shop', value: r.shopName ?? `#${r.shopId}` },
          ]}
        />
        {issue && (
          <Callout tone={r.status === 'missed' || r.status === 'failed' ? 'danger' : 'warning'} title={issue}>
            {r.issueDetail ?? (r.status === 'missed' ? 'Lần phát bỏ lỡ không được phát bù.' : undefined)}
          </Callout>
        )}
        {r.status === 'upcoming' && (
          <Callout tone="info">
            Tới giờ, hệ thống kiểm tra kết nối, phiên đang mở, video và sản phẩm rồi tự tạo phiên với tiêu đề và ảnh bìa của lịch. Nếu shop đang bận hoặc hệ thống đóng băng, lần phát được ghi "Bỏ lỡ".
          </Callout>
        )}
      </div>
    </Sheet>
  );
}
