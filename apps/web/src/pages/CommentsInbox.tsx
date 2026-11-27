import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ExternalLink, Inbox, MessageCircle, Radio, RefreshCw, Reply, UserRoundCheck, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, fmtNumber, fmtTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { HandledBadge } from '@/components/live/helpers';
import { ReplyComposer } from '@/components/live/ReplyComposer';
import type { InboxComment, InboxResponse } from '@/components/live/types';
import { Button } from '@/components/ui/button';
import { SearchInput, Segmented, Select } from '@/components/ui/form';
import { Callout, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';

type Handled = '' | 'pending' | 'escalated' | 'replied' | 'skipped' | 'blocked' | 'failed';
const STATUS_OPTIONS: { value: Handled; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'pending', label: 'Chưa xử lý' },
  { value: 'escalated', label: 'Cần nhân viên' },
  { value: 'replied', label: 'Đã trả lời' },
  { value: 'skipped', label: 'Bỏ qua' },
  { value: 'blocked', label: 'Bị chặn' },
  { value: 'failed', label: 'Gửi lỗi' },
];

function CommentItem({ c, canReply, replying, onReply, onCancel }: { c: InboxComment; canReply: boolean; replying: boolean; onReply: () => void; onCancel: () => void }) {
  const escalated = c.handled === 'escalated';
  const today = fmtDate(new Date());
  const day = fmtDate(c.at);
  return (
    <li className={cn('group relative px-4 py-2.5', escalated && 'bg-amber-50/70 dark:bg-amber-950/20', replying && 'bg-brand-50/50 dark:bg-brand-950/20')}>
      {escalated && <span className="absolute inset-y-0 left-0 w-0.5 bg-amber-500" />}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-semibold text-fg">{c.username || 'Người xem'}</span>
            <span className="text-2xs tabular text-subtle">
              {fmtTime(c.at, true)}
              {day !== today ? ` · ${day}` : ''}
            </span>
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-snug">{c.content}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted">
            <Link to={`/sessions/${c.sessionId}`} className="inline-flex min-w-0 max-w-full items-center gap-1 hover:text-fg" title={`${c.shopName ?? ''}${c.sessionTitle ? ` · ${c.sessionTitle}` : ''}`}>
              <Radio className="size-3 shrink-0" />
              <span className="truncate">
                <b className="font-medium text-fg">{c.shopName ?? `Shop #${c.shopId}`}</b>
                {c.sessionTitle ? ` · ${c.sessionTitle}` : ''}
              </span>
              <ExternalLink className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
            </Link>
            {escalated && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                <UserRoundCheck className="size-3" />
                AI chuyển cho nhân viên trả lời
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <HandledBadge handled={c.handled} />
          {canReply && !replying && c.handled !== 'replied' && (
            <button
              type="button"
              onClick={onReply}
              className={cn('inline-flex items-center gap-1 text-2xs font-medium text-brand-600 hover:underline focus:opacity-100 dark:text-brand-400', !escalated && 'sm:opacity-0 sm:group-hover:opacity-100')}
            >
              <Reply className="size-3" />
              Trả lời
            </button>
          )}
        </div>
      </div>
      {replying && (
        <div className="mt-2">
          <ReplyComposer sessionId={c.sessionId} shopId={c.shopId} target={{ id: c.id, username: c.username, content: c.content }} onClearTarget={onCancel} onSent={onCancel} autoFocus />
        </div>
      )}
    </li>
  );
}

export default function CommentsInbox() {
  const { can } = useAuth();
  const [shopId, setShopId] = useState<number | null>(null);
  const [handled, setHandled] = useState<Handled>('');
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 300);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const canReply = can('comment.reply');

  const q = useQuery({
    queryKey: ['comments', 'inbox', { shopId, handled, q: dq }],
    queryFn: () => api.get<InboxResponse>('/api/comments/inbox', { shopId, handled, q: dq, limit: 200 }),
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });
  // Số bình luận AI chuyển nhân viên (luôn hiển thị, bất kể bộ lọc trạng thái)
  const esc = useQuery({
    queryKey: ['comments', 'inbox', { shopId, handled: 'escalated', q: '' }],
    queryFn: () => api.get<InboxResponse>('/api/comments/inbox', { shopId, handled: 'escalated', limit: 200 }),
    refetchInterval: 3000,
    enabled: handled !== 'escalated',
  });

  const sessions = q.data?.sessions ?? [];
  const items = q.data?.items ?? [];
  const escCount = handled === 'escalated' ? items.length : (esc.data?.items.length ?? 0);
  const current = sessions.find((s) => s.shopId === shopId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hộp bình luận"
        description="Bình luận của người xem từ mọi phiên đang live — tự cập nhật mỗi 3 giây"
        actions={
          <Button icon={<RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>
            Làm mới
          </Button>
        }
      />

      {escCount > 0 && handled !== 'escalated' && (
        <Callout
          tone="warning"
          icon={<UserRoundCheck className="size-4" />}
          title={`${fmtNumber(escCount)} bình luận AI chuyển cho nhân viên`}
          action={
            <Button size="sm" onClick={() => setHandled('escalated')}>
              Xem ngay
            </Button>
          }
        >
          AI không tự trả lời được các câu hỏi này (khiếu nại, hỏi chi tiết đơn hàng…). Hãy trả lời thủ công để không bỏ lỡ khách.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="hidden self-start lg:block">
          <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-base font-semibold">Phiên đang live</p>
            <p className="text-xs text-muted tabular">{sessions.length}</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            <button
              type="button"
              onClick={() => setShopId(null)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors', shopId === null ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'hover:bg-surface-2')}
            >
              <Inbox className="size-4 shrink-0" />
              Tất cả phiên
            </button>
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setShopId(s.shopId)}
                className={cn('mt-0.5 block w-full rounded-md px-2.5 py-1.5 text-left transition-colors', shopId === s.shopId ? 'bg-brand-50 dark:bg-brand-950/40' : 'hover:bg-surface-2')}
              >
                <span className={cn('block truncate text-sm font-medium', shopId === s.shopId && 'text-brand-700 dark:text-brand-300')} title={s.shopName}>
                  {s.shopName}
                </span>
                <span className="block truncate text-xs text-muted" title={s.title}>
                  {s.title}
                </span>
              </button>
            ))}
            {!sessions.length && !q.isLoading && <p className="px-2.5 py-3 text-xs text-muted">Không có phiên nào đang live.</p>}
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <Select value={shopId ?? ''} onChange={(e) => setShopId(e.target.value ? Number(e.target.value) : null)} className="w-full sm:w-64 lg:hidden">
                <option value="">Tất cả phiên đang live ({sessions.length})</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.shopId}>
                    {s.shopName} — {s.title}
                  </option>
                ))}
              </Select>
              <SearchInput value={search} onChange={setSearch} placeholder="Nội dung hoặc tên người xem…" className="w-full sm:w-64" />
              {current && (
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">
                  {current.shopName}
                  <button type="button" onClick={() => setShopId(null)} className="rounded p-0.5 hover:text-fg" aria-label="Bỏ lọc phiên">
                    <X className="size-3" />
                  </button>
                </span>
              )}
            <div className="scrollbar-none -mx-1 max-w-full overflow-x-auto px-1 xl:ml-auto">
              <Segmented size="sm" value={handled} onChange={setHandled} options={STATUS_OPTIONS.map((o) => (o.value === 'escalated' ? { ...o, count: escCount } : o))} />
            </div>
          </div>

          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !sessions.length ? (
            <EmptyState icon={Radio} title="Không có phiên nào đang live" description="Bình luận sẽ xuất hiện ở đây khi có phiên đang livestream." />
          ) : !items.length ? (
            <EmptyState icon={MessageCircle} title="Không có bình luận phù hợp" description={handled || dq ? 'Thử đổi bộ lọc hoặc từ khóa.' : 'Chưa có người xem bình luận.'} />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {items.map((c) => (
                  <CommentItem key={c.id} c={c} canReply={canReply} replying={replyingId === c.id} onReply={() => setReplyingId(c.id)} onCancel={() => setReplyingId(null)} />
                ))}
              </ul>
              <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
                Hiển thị {fmtNumber(items.length)} bình luận mới nhất{items.length >= 200 ? ' (tối đa 200)' : ''}.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
