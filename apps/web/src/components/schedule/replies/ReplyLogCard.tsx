import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History, ShieldCheck } from 'lucide-react';
import { LIMITS, REPLY_SOURCE_LABELS, REPLY_STATUS_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { Select } from '@/components/ui/form';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Pagination, Skeleton } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { fmtLatency, LOG_SOURCE_TONE, LOG_STATUS_TONE, type ReplyLogsResp } from './types';

const STATUS_OPTS = ['posted', 'blocked', 'skipped', 'failed'] as const;
const SOURCE_OPTS = ['rule', 'ai', 'manual'] as const;

function Mini({ label, value, tone, active, onClick }: { label: string; value: string; tone?: string; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('min-w-0 rounded-lg border px-3 py-2 text-left transition-colors', active ? 'border-brand-400 ring-1 ring-brand-400' : 'border-line hover:border-line-strong')}>
      <p className="truncate text-2xs font-medium text-muted">{label}</p>
      <p className={cn('text-lg font-semibold leading-tight tabular', tone)}>{value}</p>
    </button>
  );
}

export function ReplyLogCard({ shopId }: { shopId: number }) {
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  useEffect(() => setPage(1), [status, source]);
  const q = useQuery({
    queryKey: ['shop', shopId, 'reply-logs', { status, source, page }],
    queryFn: () => api.get<ReplyLogsResp>(`/api/shops/${shopId}/reply-logs`, { status, source, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
  });
  const d = q.data;
  const s = d?.last24h;
  const pick = (v: string) => setStatus(status === v ? '' : v);

  return (
    <Card>
      <CardHeader
        title="Nhật ký trả lời"
        icon={<History className="size-4" />}
        description="Các câu trả lời tự động và thủ công gần đây"
        actions={
          <>
            <Select inputSize="sm" value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
              <option value="">Mọi kết quả</option>
              {STATUS_OPTS.map((v) => (
                <option key={v} value={v}>
                  {REPLY_STATUS_LABELS[v]}
                </option>
              ))}
            </Select>
            <Select inputSize="sm" value={source} onChange={(e) => setSource(e.target.value)} className="w-32">
              <option value="">Mọi nguồn</option>
              {SOURCE_OPTS.map((v) => (
                <option key={v} value={v}>
                  {REPLY_SOURCE_LABELS[v]}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-2 border-b border-line p-4 sm:grid-cols-5">
        <Mini label="Đã đăng (24 giờ)" value={s ? fmtNumber(s.posted) : '—'} tone="text-emerald-600 dark:text-emerald-400" active={status === 'posted'} onClick={() => pick('posted')} />
        <Mini label="Bị chặn" value={s ? fmtNumber(s.blocked) : '—'} tone={s?.blocked ? 'text-amber-600 dark:text-amber-400' : undefined} active={status === 'blocked'} onClick={() => pick('blocked')} />
        <Mini label="Bỏ qua" value={s ? fmtNumber(s.skipped) : '—'} active={status === 'skipped'} onClick={() => pick('skipped')} />
        <Mini label="Gửi lỗi" value={s ? fmtNumber(s.failed) : '—'} tone={s?.failed ? 'text-rose-600 dark:text-rose-400' : undefined} active={status === 'failed'} onClick={() => pick('failed')} />
        <Mini label="Độ trễ trung bình" value={s ? fmtLatency(s.avgLatencyMs) : '—'} />
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : !d.items.length ? (
        <EmptyState compact icon={History} title="Chưa có câu trả lời nào" description={status || source ? 'Thử bỏ bộ lọc.' : 'Nhật ký xuất hiện khi phiên live có bình luận được trả lời hoặc bỏ qua.'} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <tr>
              <Th className="w-32">Thời gian</Th>
              <Th className="w-[24%]">Bình luận</Th>
              <Th>Câu trả lời</Th>
              <Th>Nguồn</Th>
              <Th>Kết quả</Th>
              <Th align="right">Độ trễ</Th>
              <Th className="w-20" />
            </tr>
          </THead>
          <tbody>
            {d.items.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap align-top text-xs tabular text-muted">{fmtDateTime(r.at, { seconds: true })}</Td>
                <Td className="max-w-0 align-top">
                  <p className="line-clamp-2" title={r.comment}>
                    {r.comment}
                  </p>
                </Td>
                <Td className="max-w-0 align-top">
                  {r.answer ? (
                    <p className={cn('line-clamp-2', r.status === 'blocked' && 'text-muted line-through')} title={r.answer}>
                      {r.answer}
                    </p>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                  {r.reason && <p className="mt-0.5 truncate text-xs text-muted" title={r.reason}>Lý do: {r.reason}</p>}
                </Td>
                <Td className="align-top">
                  <Badge tone={LOG_SOURCE_TONE[r.source] ?? 'neutral'} size="sm">
                    {REPLY_SOURCE_LABELS[r.source as keyof typeof REPLY_SOURCE_LABELS] ?? r.source}
                  </Badge>
                </Td>
                <Td className="align-top">
                  <Badge tone={LOG_STATUS_TONE[r.status] ?? 'neutral'} size="sm" dot>
                    {REPLY_STATUS_LABELS[r.status as keyof typeof REPLY_STATUS_LABELS] ?? r.status}
                  </Badge>
                </Td>
                <Td align="right" className="whitespace-nowrap align-top text-xs tabular text-muted">
                  {fmtLatency(r.latencyMs)}
                </Td>
                <Td align="right" className="align-top">
                  {r.sessionId && (
                    <Link to={`/sessions/${r.sessionId}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                      Phiên
                    </Link>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <p className="inline-flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-3.5" />
          Không lưu tên người xem · nội dung được cắt ngắn · tự xóa sau {LIMITS.replyLogRetentionDays} ngày
        </p>
        {d && <Pagination page={page} pageSize={pageSize} total={d.total} onChange={setPage} />}
      </div>
    </Card>
  );
}
