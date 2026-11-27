import { AlertCircle, CheckCircle2, Circle, Loader2, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LiveSession } from '@/lib/types';

export const AUTO_FLOW_STEPS = [
  { key: 'assign', label: 'Máy chủ nhận việc', desc: 'Hệ thống giao việc cho một máy chủ phát còn luồng trống.' },
  { key: 'prepare', label: 'Chuẩn bị video', desc: 'Máy chủ tải và kiểm tra các video trong mẫu phát.' },
  { key: 'push', label: 'Đẩy hình lên Shopee', desc: 'Máy chủ đẩy luồng video tới địa chỉ Shopee cấp cho phiên.' },
  { key: 'start', label: 'Shopee nhận hình → bắt đầu phiên', desc: 'Chỉ khi Shopee đã nhận hình, hệ thống mới bắt đầu phiên — người xem không gặp màn hình đen.' },
  { key: 'pin', label: 'Ghim sản phẩm theo video', desc: 'Mỗi video có sản phẩm ghim riêng; hệ thống tự đổi ghim khi chuyển video.' },
  { key: 'reply', label: 'Trả lời bình luận', desc: 'Kịch bản và AI tự trả lời bình luận của người xem (nếu shop đang bật).' },
] as const;

type StepStatus = 'done' | 'active' | 'run' | 'error' | 'todo' | 'off';

/** Tính trạng thái từng bước từ phiên + việc phát hiện tại */
export function flowStatus(s: Pick<LiveSession, 'state' | 'streamState' | 'pinState' | 'replyState'>, hasJob: boolean): StepStatus[] {
  if (!hasJob) return AUTO_FLOW_STEPS.map(() => 'todo');
  const ss = s.streamState;
  const started = s.state === 'live' || s.state === 'disconnected';
  const assign: StepStatus = ss === 'waiting_server' ? 'active' : 'done';
  const prepare: StepStatus = ss === 'waiting_server' ? 'todo' : ss === 'preparing' ? 'active' : 'done';
  const push: StepStatus = ss === 'pushing' ? 'done' : ss === 'error' || ss === 'lost' ? 'error' : 'todo';
  const start: StepStatus = started ? 'done' : ss === 'pushing' ? 'active' : 'todo';
  const live = s.state === 'live' && ss === 'pushing';
  const pin: StepStatus = !live ? 'todo' : s.pinState === 'ok' ? 'run' : s.pinState === 'attn' ? 'error' : 'off';
  const reply: StepStatus = !started ? 'todo' : s.replyState === 'ok' ? 'run' : s.replyState === 'attn' ? 'error' : 'off';
  return [assign, prepare, push, start, pin, reply];
}

const statusText: Record<StepStatus, string> = { done: 'Xong', active: 'Đang thực hiện', run: 'Đang chạy', error: 'Có lỗi', todo: 'Chờ', off: 'Đang tắt' };

function StepIcon({ st, n }: { st: StepStatus | null; n: number }) {
  if (st === null)
    return <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface-2 text-2xs font-semibold text-muted ring-1 ring-line">{n}</span>;
  if (st === 'done') return <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />;
  if (st === 'active') return <Loader2 className="size-5 shrink-0 animate-spin text-brand-500" />;
  if (st === 'run')
    return (
      <span className="grid size-5 shrink-0 place-items-center">
        <span className="size-2.5 animate-pulse-dot rounded-full bg-emerald-500" />
      </span>
    );
  if (st === 'error') return <AlertCircle className="size-5 shrink-0 text-rose-500" />;
  if (st === 'off') return <MinusCircle className="size-5 shrink-0 text-subtle" />;
  return <Circle className="size-5 shrink-0 text-subtle" />;
}

const statusTone: Record<StepStatus, string> = {
  error: 'text-rose-600 dark:text-rose-400',
  active: 'text-brand-600 dark:text-brand-400',
  off: 'text-subtle',
  done: 'text-emerald-700 dark:text-emerald-400',
  run: 'text-emerald-700 dark:text-emerald-400',
  todo: 'text-subtle',
};

/**
 * Các bước phát tự động. Không truyền `status` → hiển thị như hướng dẫn (đánh số).
 * `compact` → lưới 2 cột gọn (dùng trong thẻ trạng thái máy chủ).
 */
export function AutoFlowSteps({ status, compact, className }: { status?: StepStatus[] | null; compact?: boolean; className?: string }) {
  if (compact)
    return (
      <ol className={cn('grid gap-x-4 gap-y-1.5 sm:grid-cols-2', className)}>
        {AUTO_FLOW_STEPS.map((step, i) => {
          const st = status ? status[i] : null;
          return (
            <li key={step.key} className="flex min-w-0 items-center gap-2" title={step.desc}>
              <StepIcon st={st} n={i + 1} />
              <span className={cn('min-w-0 flex-1 text-xs', st === 'todo' ? 'text-muted' : st === 'error' ? 'font-medium text-rose-700 dark:text-rose-400' : 'text-fg')}>{step.label}</span>
              {st && st !== 'todo' && <span className={cn('shrink-0 text-2xs', statusTone[st])}>{statusText[st]}</span>}
            </li>
          );
        })}
      </ol>
    );
  return (
    <ol className={cn('space-y-0', className)}>
      {AUTO_FLOW_STEPS.map((step, i) => {
        const st = status ? status[i] : null;
        const last = i === AUTO_FLOW_STEPS.length - 1;
        return (
          <li key={step.key} className="relative flex gap-2.5 pb-2.5 last:pb-0">
            {!last && <span className={cn('absolute bottom-0.5 left-[9.5px] top-[22px] w-px', st === 'done' ? 'bg-emerald-300 dark:bg-emerald-800' : 'bg-line')} />}
            <StepIcon st={st} n={i + 1} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <p className={cn('text-sm font-medium', st === 'todo' && 'text-muted', st === 'error' && 'text-rose-700 dark:text-rose-400')}>{step.label}</p>
                {st && st !== 'todo' && <span className={cn('text-2xs', statusTone[st])}>{statusText[st]}</span>}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.desc}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
