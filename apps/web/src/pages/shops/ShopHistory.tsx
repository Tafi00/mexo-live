import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Clock, Download, Eye, FileSpreadsheet, Heart, History, Radio, RefreshCw, ShoppingBag } from 'lucide-react';
import { api, download } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtClock, fmtDate, fmtDateTime, fmtMoney, fmtNumber, todayVn } from '@/lib/format';
import { endedReasonLabel, OriginBadge } from '@/components/live/helpers';
import type { ReportSessionsResponse } from '@/components/live/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Segmented } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, Pagination, Skeleton, StatCard } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { useShop } from './ShopLayout';

type Preset = '7' | '30' | '90' | 'custom';
const PAGE_SIZE = 20;

export default function ShopHistory() {
  const { shop } = useShop();
  const nav = useNavigate();
  const today = todayVn();
  const [preset, setPreset] = useState<Preset>('30');
  const [customFrom, setCustomFrom] = useState(addDaysStr(today, -29));
  const [customTo, setCustomTo] = useState(today);
  const [page, setPage] = useState(1);

  const range = useMemo(() => {
    if (preset === 'custom') {
      const f = customFrom || addDaysStr(today, -29);
      const t = customTo || today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    return { from: addDaysStr(today, -(Number(preset) - 1)), to: today };
  }, [preset, customFrom, customTo, today]);

  useEffect(() => setPage(1), [range.from, range.to]);

  const filters = { shopId: shop.id, from: range.from, to: range.to, state: 'ended' };
  const q = useQuery({
    queryKey: ['shop', shop.id, 'history', range.from, range.to, page],
    queryFn: () => api.get<ReportSessionsResponse>('/api/reports/sessions', { ...filters, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const sum = d?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Lịch sử phiên live</h2>
          <p className="text-[13px] text-muted">
            Các phiên đã kết thúc từ {fmtDate(range.from)} đến {fmtDate(range.to)} (theo ngày tạo phiên, giờ Việt Nam).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => download('/api/reports/sessions/export', { ...filters, format: 'xlsx' })} disabled={!d?.total}>
            Xuất Excel
          </Button>
          <Button icon={<Download className="size-4" />} onClick={() => download('/api/reports/sessions/export', { ...filters, format: 'csv' })} disabled={!d?.total}>
            Xuất CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          value={preset}
          onChange={setPreset}
          options={[
            { value: '7', label: '7 ngày' },
            { value: '30', label: '30 ngày' },
            { value: '90', label: '90 ngày' },
            { value: 'custom', label: <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" />Tùy chọn</span> },
          ]}
        />
        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Từ ngày" className="w-40">
              <Input type="date" inputSize="sm" value={customFrom} max={today} onChange={(e) => setCustomFrom(e.target.value)} />
            </Field>
            <Field label="Đến ngày" className="w-40">
              <Input type="date" inputSize="sm" value={customTo} max={today} onChange={(e) => setCustomTo(e.target.value)} />
            </Field>
          </div>
        )}
        <Button iconOnly variant="ghost" className="ml-auto" icon={<RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()} aria-label="Làm mới" />
      </div>

      {q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          {!sum ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[86px] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Số phiên" value={fmtNumber(sum.count)} hint={`${fmtNumber(sum.started)} lên sóng${sum.failed ? ` · ${fmtNumber(sum.failed)} không lên sóng` : ''}`} icon={<Radio className="size-4" />} tone="brand" />
              <StatCard label="Tổng giờ phát" value={fmtNumber(sum.totalSeconds / 3600, 1)} hint={sum.started ? `TB ${fmtClock(sum.totalSeconds / sum.started)} / phiên` : undefined} icon={<Clock className="size-4" />} tone="info" />
              <StatCard label="Người xem cao nhất" value={fmtNumber(sum.peakViewers)} icon={<Eye className="size-4" />} tone="violet" />
              <StatCard label="Lượt thích" value={fmtNumber(sum.likes)} icon={<Heart className="size-4" />} tone="danger" />
              <StatCard label="Đơn hàng" value={fmtNumber(sum.orders)} hint={sum.gmv ? fmtMoney(sum.gmv) : undefined} icon={<ShoppingBag className="size-4" />} tone="success" />
            </div>
          )}

          <Card>
            {!d ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : d.items.length === 0 ? (
              <EmptyState icon={History} title="Không có phiên nào trong khoảng thời gian này" description="Thử chọn khoảng thời gian dài hơn." />
            ) : (
              <>
                <Table minWidth={1480}>
                  <THead>
                    <tr>
                      <Th>Tiêu đề</Th>
                      <Th>Session ID</Th>
                      <Th>Nguồn</Th>
                      <Th>Mẫu phát</Th>
                      <Th>Người thực hiện</Th>
                      <Th>Bắt đầu</Th>
                      <Th>Kết thúc</Th>
                      <Th align="right">Thời lượng</Th>
                      <Th align="right">Xem cao nhất</Th>
                      <Th align="right">Thích</Th>
                      <Th align="right">Đơn</Th>
                      <Th>Lý do kết thúc</Th>
                      <Th>Lỗi gần nhất</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {d.items.map((r) => (
                      <Tr key={r.id} onClick={() => nav(`/sessions/${r.id}`)}>
                        <Td className="max-w-[260px]">
                          <p className="truncate font-medium" title={r.title}>
                            {r.title}
                          </p>
                          <p className="text-xs text-muted">Tạo {fmtDateTime(r.createdAt)}</p>
                        </Td>
                        <Td className="font-mono text-xs text-muted">{r.shopeeSessionId ?? '—'}</Td>
                        <Td>
                          <OriginBadge origin={r.origin} />
                        </Td>
                        <Td className="max-w-[160px] truncate text-muted">{r.templateName ?? '—'}</Td>
                        <Td className="max-w-[140px] truncate text-muted">{r.createdByName ?? '—'}</Td>
                        <Td className="whitespace-nowrap tabular text-muted">{r.startedAt ? fmtDateTime(r.startedAt) : <span className="text-amber-700 dark:text-amber-400">Không lên sóng</span>}</Td>
                        <Td className="whitespace-nowrap tabular text-muted">{fmtDateTime(r.endedAt)}</Td>
                        <Td align="right" className="tabular">
                          {r.startedAt ? fmtClock(r.durationSec) : '—'}
                        </Td>
                        <Td align="right" className="tabular">
                          {fmtNumber(r.peakViewers)}
                        </Td>
                        <Td align="right" className="tabular">
                          {fmtNumber(r.likes)}
                        </Td>
                        <Td align="right" className="tabular font-medium">
                          {fmtNumber(r.orders)}
                        </Td>
                        <Td className="whitespace-nowrap text-muted">{endedReasonLabel(r.endedReason)}</Td>
                        <Td className="max-w-[220px]">
                          {r.lastError ? (
                            <span className="flex min-w-0 items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title={r.lastError}>
                              <AlertTriangle className="size-3.5 shrink-0" />
                              <span className="truncate">{r.lastError}</span>
                            </span>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <div className="border-t border-line px-4 py-2.5">
                  <Pagination page={page} pageSize={PAGE_SIZE} total={d.total} onChange={setPage} />
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
