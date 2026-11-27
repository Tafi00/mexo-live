import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Reply, UserRoundCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtNumber, fmtTime } from '@/lib/format';
import type { LiveSession } from '@/lib/types';
import { Segmented } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/misc';
import { HandledBadge } from './helpers';
import { ReplyComposer, type ReplyTarget } from './ReplyComposer';
import type { CommentRow } from './types';

type Filter = 'all' | 'pending' | 'escalated';

export function CommentsPanel({ session, canReply }: { session: LiveSession; canReply: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [target, setTarget] = useState<ReplyTarget | null>(null);
  const open = session.state !== 'ended';
  const q = useQuery({
    queryKey: ['session', session.id, 'comments'],
    queryFn: () => api.get<{ items: CommentRow[] }>(`/api/sessions/${session.id}/comments`, { limit: 200 }),
    refetchInterval: open ? 3000 : false,
  });
  const all = useMemo(() => [...(q.data?.items ?? [])].reverse(), [q.data]);
  const counts = useMemo(() => ({ pending: all.filter((c) => !c.handled).length, escalated: all.filter((c) => c.handled === 'escalated').length }), [all]);
  const list = filter === 'all' ? all : filter === 'pending' ? all.filter((c) => !c.handled) : all.filter((c) => c.handled === 'escalated');
  const live = session.state === 'live';
  const replyable = canReply && live && session.origin !== 'external';
  const disabledReason = !canReply ? 'Bạn chưa được cấp quyền trả lời bình luận.' : session.origin === 'external' ? 'Phiên mở từ app Shopee — MEXO không gửi bình luận được.' : !live ? 'Chỉ gửi bình luận khi phiên đang live trên Shopee.' : undefined;

  return (
    <Card className="flex flex-col">
      <CardHeader title="Bình luận" icon={<MessageCircle className="size-4" />} description={q.data ? `${fmtNumber(all.length)} bình luận gần nhất · tự cập nhật mỗi 3 giây` : undefined} />
      <div className="border-b border-line px-4 py-3">
        <ReplyComposer sessionId={session.id} target={target} onClearTarget={() => setTarget(null)} disabled={!replyable} disabledReason={disabledReason} onSent={() => setTarget(null)} />
      </div>
      <div className="flex items-center gap-2 px-4 pt-3">
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'pending', label: 'Chưa xử lý', count: counts.pending },
            { value: 'escalated', label: 'Cần nhân viên', count: counts.escalated },
          ]}
        />
      </div>
      {q.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : !list.length ? (
        <EmptyState compact icon={MessageCircle} title={all.length ? 'Không có bình luận phù hợp' : 'Chưa có bình luận'} description={all.length ? undefined : 'Bình luận của người xem sẽ hiện ở đây khi phiên đang live.'} />
      ) : (
        <ul className="max-h-[460px] divide-y divide-line overflow-y-auto py-1">
          {list.map((c) => {
            const escalated = c.handled === 'escalated';
            const selected = target?.id === c.id;
            return (
              <li key={c.id} className={cn('group relative px-4 py-2.5', escalated && 'bg-amber-50/70 dark:bg-amber-950/20', selected && 'bg-brand-50/70 dark:bg-brand-950/25')}>
                {escalated && <span className="absolute inset-y-0 left-0 w-0.5 bg-amber-500" />}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold">{c.username || 'Người xem'}</span>
                  <span className="shrink-0 text-[11px] tabular text-subtle">{fmtTime(c.at, true)}</span>
                  <span className="ml-auto shrink-0">
                    <HandledBadge handled={c.handled} />
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-snug">{c.content}</p>
                {escalated && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <UserRoundCheck className="size-3.5" />
                    AI chuyển cho nhân viên trả lời
                  </p>
                )}
                {replyable && c.handled !== 'replied' && (
                  <button
                    type="button"
                    onClick={() => setTarget({ id: c.id, username: c.username, content: c.content })}
                    className={cn('mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline focus:opacity-100 dark:text-brand-400', !escalated && !selected && 'sm:opacity-0 sm:group-hover:opacity-100')}
                  >
                    <Reply className="size-3.5" />
                    Trả lời
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
