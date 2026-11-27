import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Activity, AlertOctagon, BarChart3, CheckCircle2, Copy, Download, FileCheck2, Filter, ListTree, Store, Timer, X, XCircle } from 'lucide-react';
import { api, download } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtDate, fmtDateTime, fmtNumber, fmtRelative, todayVn } from '@/lib/format';
import { useCopy, useDebounced } from '@/lib/hooks';
import { ConsoleReconcile } from '@/components/admin/ConsoleReconcile';
import { DateRangeBar, Delta, RateValue, daysInclusive } from '@/components/admin/common';
import { errorClassInfo, ErrorClassBadge, fillSeries, LevelBanner, RateChart, VolumeChart, type MonitorSummary, type SeriesPoint } from '@/components/admin/monitorParts';
import { Button } from '@/components/ui/button';
import { Checkbox, SearchInput, Segmented, Switch } from '@/components/ui/form';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, Tabs, Tooltip } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';

type Tab = 'api' | 'shop' | 'errors' | 'calls' | 'console';

interface ApiRow {
  api: string;
  total: number;
  success: number;
  failed: number;
  rate: number | null;
  avgMs: number | null;
}
interface ShopRow {
  shopId: number;
  shopName: string;
  total: number;
  success: number;
  failed: number;
  rate: number | null;
}
interface ErrRow {
  errorClass: string | null;
  errorCode: string | null;
  httpStatus: number | null;
  n: number;
  lastAt: string;
  sample: string | null;
}
interface CallRow {
  id: number;
  at: string;
  api: string;
  shopName: string | null;
  sessionId: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorClass: string | null;
  requestId: string | null;
  durationMs: number | null;
  retries: number | null;
  success: boolean;
  ref: string | null;
}

function FilterChip({ label, onClear }: { label: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900">
      <Filter className="size-3" />
      {label}
      <button onClick={onClear} className="rounded-full p-0.5 hover:bg-brand-100 dark:hover:bg-brand-900/60" aria-label="Bỏ lọc">
        <X className="size-3" />
      </button>
    </span>
  );
}

export default function Monitor() {
  const copy = useCopy();
  const today = todayVn();
  const [from, setFrom] = useState(addDaysStr(today, -6));
  const [to, setTo] = useState(today);
  const [apiName, setApiName] = useState('');
  const [shop, setShop] = useState<{ id: number; name: string } | null>(null);
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day');
  const [compare, setCompare] = useState(true);
  const [tab, setTab] = useState<Tab>('api');
  const [hideIdle, setHideIdle] = useState(true);
  const [success, setSuccess] = useState<'' | 'true' | 'false'>('');
  const [ref, setRef] = useState('');
  const dref = useDebounced(ref.trim(), 400);
  const [page, setPage] = useState(1);

  const days = daysInclusive(from, to);
  const hourAllowed = days <= 7;
  const gran = hourAllowed ? granularity : 'day';
  useEffect(() => setPage(1), [from, to, apiName, shop, success, dref]);

  const base = { from, to };
  const summary = useQuery({ queryKey: ['monitor', 'summary', { from, to, apiName }], queryFn: () => api.get<MonitorSummary>('/api/monitor/summary', { ...base, api: apiName }), refetchInterval: 60_000, placeholderData: keepPreviousData });
  const series = useQuery({
    queryKey: ['monitor', 'series', { from, to, apiName, shopId: shop?.id, gran }],
    queryFn: () => api.get<{ items: SeriesPoint[] }>('/api/monitor/series', { ...base, api: apiName, shopId: shop?.id, granularity: gran }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  const byApi = useQuery({ queryKey: ['monitor', 'by-api', { from, to, shopId: shop?.id }], queryFn: () => api.get<{ items: ApiRow[] }>('/api/monitor/by-api', { ...base, shopId: shop?.id }), placeholderData: keepPreviousData });
  const byShop = useQuery({ queryKey: ['monitor', 'by-shop', { from, to, apiName }], queryFn: () => api.get<{ items: ShopRow[] }>('/api/monitor/by-shop', { ...base, api: apiName }), enabled: tab === 'shop', placeholderData: keepPreviousData });
  const errors = useQuery({ queryKey: ['monitor', 'errors', { from, to, apiName }], queryFn: () => api.get<{ items: ErrRow[] }>('/api/monitor/errors', { ...base, api: apiName }), enabled: tab === 'errors', placeholderData: keepPreviousData });
  const calls = useQuery({
    queryKey: ['monitor', 'calls', { from, to, apiName, shopId: shop?.id, success, dref, page }],
    queryFn: () => api.get<{ items: CallRow[]; total: number }>('/api/monitor/calls', { ...base, api: apiName, shopId: shop?.id, success, ref: dref, page, pageSize: 50 }),
    enabled: tab === 'calls',
    placeholderData: keepPreviousData,
  });

  const s = summary.data;
  const chartData = useMemo(() => fillSeries(series.data?.items ?? [], from, to, gran), [series.data, from, to, gran]);
  const daysBelow = gran === 'day' && !apiName && !shop ? chartData.filter((d) => d.rate !== null && d.rate < 0.9).length : null;
  const prevFrom = addDaysStr(from, -days);
  const prevTo = addDaysStr(from, -1);
  const apiRows = (byApi.data?.items ?? []).filter((r) => !hideIdle || r.total > 0 || r.api === apiName);
  const maxApiTotal = Math.max(1, ...apiRows.map((r) => r.total));
  const errTotal = (errors.data?.items ?? []).reduce((n, e) => n + e.n, 0);
  const errByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of errors.data?.items ?? []) m.set(e.errorClass ?? '', (m.get(e.errorClass ?? '') ?? 0) + e.n);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [errors.data]);

  if (summary.isError && !s) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Giám sát API Shopee"
        description="Tỷ lệ gọi Shopee Open API thành công, lỗi theo API/shop và đối chiếu với Console Shopee"
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => download('/api/monitor/export', { from, to })}>
            Xuất CSV (định dạng Shopee)
          </Button>
        }
      />

      {s ? <LevelBanner s={s} /> : <Skeleton className="h-[92px] rounded-xl" />}

      <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <DateRangeBar
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        <Switch size="sm" checked={compare} onChange={setCompare} label={<span className="text-sm">So với kỳ trước</span>} />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {apiName && <FilterChip label={<>API: <span className="font-mono">{apiName}</span></>} onClear={() => setApiName('')} />}
          {shop && <FilterChip label={<>Shop: {shop.name}</>} onClear={() => setShop(null)} />}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tỷ lệ thành công"
          value={s ? <RateValue rate={s.current.rate} className="text-xl font-semibold [&>svg]:size-4" /> : '—'}
          icon={<Activity className="size-4" />}
          tone="brand"
          trend={compare && s ? <Delta current={s.current.rate} previous={s.previous.rate} mode="pp" digits={2} /> : undefined}
          hint={!compare && daysBelow !== null ? (daysBelow ? `${daysBelow} ngày dưới 90%` : 'Không ngày nào dưới 90%') : undefined}
        />
        <StatCard label="Tổng lệnh gọi" value={s ? fmtNumber(s.current.total) : '—'} icon={<BarChart3 className="size-4" />} trend={compare && s ? <Delta current={s.current.total} previous={s.previous.total} mode="pct" good="neutral" /> : undefined} hint={!compare ? `${days} ngày` : undefined} />
        <StatCard label="Lệnh gọi lỗi" value={s ? fmtNumber(s.current.failed) : '—'} icon={<XCircle className="size-4" />} tone={s && s.current.failed ? 'danger' : 'neutral'} trend={compare && s ? <Delta current={s.current.failed} previous={s.previous.failed} mode="pct" good="down" /> : undefined} />
        <StatCard label="Thời gian phản hồi TB" value={s?.current.avgMs !== null && s?.current.avgMs !== undefined ? `${fmtNumber(s.current.avgMs)} ms` : '—'} icon={<Timer className="size-4" />} trend={compare && s ? <Delta current={s.current.avgMs} previous={s.previous.avgMs} mode="pct" good="down" /> : undefined} />
      </div>
      {compare && (
        <p className="-mt-2 text-xs text-muted">
          So sánh với {fmtDate(prevFrom)} – {fmtDate(prevTo)} ({days} ngày liền trước){daysBelow !== null ? ` · ${daysBelow ? `${daysBelow} ngày trong kỳ dưới 90%` : 'không ngày nào trong kỳ dưới 90%'}` : ''}
          {shop ? ' · số tổng quan tính trên toàn hệ thống, không theo shop đang lọc' : ''}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Tỷ lệ thành công"
            description={`${gran === 'day' ? 'Theo ngày' : 'Theo giờ'} · vạch đỏ 90% (Shopee tối thiểu) · vạch xanh 97%`}
            actions={
              <Segmented<'day' | 'hour'>
                size="sm"
                value={gran}
                onChange={(v) => hourAllowed && setGranularity(v)}
                options={[
                  { value: 'day', label: 'Ngày' },
                  { value: 'hour', label: hourAllowed ? 'Giờ' : <Tooltip content="Chọn khoảng ≤ 7 ngày để xem theo giờ"><span className="opacity-50">Giờ</span></Tooltip> },
                ]}
              />
            }
          />
          <div className={cn('px-2 pb-2 pt-3', series.isFetching && series.isPlaceholderData && 'opacity-60')}>{series.data ? <RateChart data={chartData} /> : <Skeleton className="h-[220px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="Số lệnh gọi" description={`${gran === 'day' ? 'Theo ngày' : 'Theo giờ'}${apiName ? ` · ${apiName}` : ''}${shop ? ` · ${shop.name}` : ''}`} />
          <div className={cn('px-2 pb-2 pt-3', series.isFetching && series.isPlaceholderData && 'opacity-60')}>{series.data ? <VolumeChart data={chartData} /> : <Skeleton className="h-[220px]" />}</div>
        </Card>
      </div>

      <Card>
        <div className="px-2 pt-0.5">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: 'api', label: 'Theo API', icon: <ListTree className="size-3.5" /> },
              { value: 'shop', label: 'Theo shop', icon: <Store className="size-3.5" /> },
              { value: 'errors', label: 'Nhóm lỗi', icon: <AlertOctagon className="size-3.5" /> },
              { value: 'calls', label: 'Nhật ký lệnh gọi', icon: <Activity className="size-3.5" /> },
              { value: 'console', label: 'Đối chiếu với Console Shopee', icon: <FileCheck2 className="size-3.5" /> },
            ]}
          />
        </div>

        {tab === 'api' && (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-xs text-muted">
              <span>Bấm vào một API để lọc toàn bộ trang theo API đó.</span>
              <Checkbox className="ml-auto" checked={hideIdle} onChange={setHideIdle} label={<span className="text-xs">Ẩn API chưa gọi lần nào</span>} />
            </div>
            {byApi.isError ? (
              <ErrorState error={byApi.error} onRetry={() => byApi.refetch()} />
            ) : !byApi.data ? (
              <Skeleton className="m-4 h-40" />
            ) : apiRows.length ? (
              <Table minWidth={760}>
                <THead>
                  <tr>
                    <Th>API</Th>
                    <Th align="right">Lệnh gọi</Th>
                    <Th align="right">Thành công</Th>
                    <Th align="right">Lỗi</Th>
                    <Th align="right">Tỷ lệ</Th>
                    <Th align="right">TB phản hồi</Th>
                  </tr>
                </THead>
                <tbody>
                  {apiRows.map((r) => (
                    <Tr key={r.api} selected={r.api === apiName} onClick={() => setApiName(r.api === apiName ? '' : r.api)} className={cn(!r.total && 'text-subtle')}>
                      <Td>
                        <span className="font-mono text-xs">{r.api}</span>
                        <div className="mt-1 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full bg-brand-400" style={{ width: `${(r.total / maxApiTotal) * 100}%` }} />
                        </div>
                      </Td>
                      <Td align="right" className="tabular">{fmtNumber(r.total)}</Td>
                      <Td align="right" className="tabular">{fmtNumber(r.success)}</Td>
                      <Td align="right" className={cn('tabular', r.failed > 0 && 'font-medium text-rose-600 dark:text-rose-400')}>{fmtNumber(r.failed)}</Td>
                      <Td align="right">
                        <RateValue rate={r.rate} />
                      </Td>
                      <Td align="right" className="tabular">{r.avgMs !== null ? `${fmtNumber(r.avgMs)} ms` : '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState compact icon={ListTree} title="Chưa có lệnh gọi nào trong khoảng này" />
            )}
          </>
        )}

        {tab === 'shop' && (
          <>
            <div className="border-b border-line px-4 py-2.5 text-xs text-muted">Shop có nhiều lỗi nhất lên đầu. Bấm vào một shop để lọc biểu đồ, bảng theo API và nhật ký lệnh gọi theo shop đó.</div>
            {byShop.isError ? (
              <ErrorState error={byShop.error} onRetry={() => byShop.refetch()} />
            ) : !byShop.data ? (
              <Skeleton className="m-4 h-40" />
            ) : byShop.data.items.length ? (
              <Table minWidth={640}>
                <THead>
                  <tr>
                    <Th>Shop</Th>
                    <Th align="right">Lệnh gọi</Th>
                    <Th align="right">Lỗi</Th>
                    <Th align="right">Tỷ lệ</Th>
                    <Th className="w-10" />
                  </tr>
                </THead>
                <tbody>
                  {byShop.data.items.map((r) => (
                    <Tr key={r.shopId} selected={shop?.id === r.shopId} onClick={() => setShop(shop?.id === r.shopId ? null : { id: r.shopId, name: r.shopName })}>
                      <Td className="font-medium">{r.shopName}</Td>
                      <Td align="right" className="tabular">{fmtNumber(r.total)}</Td>
                      <Td align="right" className={cn('tabular', r.failed > 0 && 'font-medium text-rose-600 dark:text-rose-400')}>{fmtNumber(r.failed)}</Td>
                      <Td align="right">
                        <RateValue rate={r.rate} />
                      </Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <Link to={`/shops/${r.shopId}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                          Mở
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState compact icon={Store} title="Chưa có lệnh gọi theo shop trong khoảng này" />
            )}
          </>
        )}

        {tab === 'errors' && (
          <>
            {errByClass.length > 0 && (
              <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-3">
                {errByClass.map(([cls, n]) => {
                  const info = errorClassInfo(cls);
                  return (
                    <div key={cls} className="rounded-lg border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <ErrorClassBadge value={cls} />
                        <span className="text-sm font-semibold tabular">{fmtNumber(n)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{info.hint}</p>
                      <p className="mt-1 text-2xs text-subtle tabular">{errTotal ? ((n / errTotal) * 100).toFixed(1) : 0}% tổng lỗi</p>
                    </div>
                  );
                })}
              </div>
            )}
            {errors.isError ? (
              <ErrorState error={errors.error} onRetry={() => errors.refetch()} />
            ) : !errors.data ? (
              <Skeleton className="m-4 h-40" />
            ) : errors.data.items.length ? (
              <Table minWidth={820}>
                <THead>
                  <tr>
                    <Th>Nhóm</Th>
                    <Th>Mã lỗi</Th>
                    <Th align="center">HTTP</Th>
                    <Th align="right">Số lần</Th>
                    <Th>Gần nhất</Th>
                    <Th>Thông báo mẫu</Th>
                  </tr>
                </THead>
                <tbody>
                  {errors.data.items.map((e, i) => (
                    <Tr key={i}>
                      <Td>
                        <ErrorClassBadge value={e.errorClass} />
                      </Td>
                      <Td className="font-mono text-xs">{e.errorCode || '—'}</Td>
                      <Td align="center" className="tabular">{e.httpStatus ?? '—'}</Td>
                      <Td align="right" className="font-semibold tabular">{fmtNumber(e.n)}</Td>
                      <Td className="whitespace-nowrap text-xs" title={fmtDateTime(e.lastAt, { seconds: true })}>
                        {fmtRelative(e.lastAt)}
                      </Td>
                      <Td className="max-w-[360px]">
                        <p className="truncate text-xs text-muted" title={e.sample ?? ''}>
                          {e.sample || '—'}
                        </p>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState compact icon={CheckCircle2} title="Không có lỗi trong khoảng này" />
            )}
          </>
        )}

        {tab === 'calls' && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
              <Segmented<'' | 'true' | 'false'>
                value={success}
                onChange={setSuccess}
                options={[
                  { value: '', label: 'Tất cả' },
                  { value: 'true', label: 'Thành công' },
                  { value: 'false', label: 'Lỗi' },
                ]}
              />
              <SearchInput value={ref} onChange={setRef} placeholder="Mã tham chiếu (ref) hoặc request_id — khớp chính xác" className="w-full sm:w-96" />
            </div>
            {calls.isError ? (
              <ErrorState error={calls.error} onRetry={() => calls.refetch()} />
            ) : !calls.data ? (
              <Skeleton className="m-4 h-40" />
            ) : calls.data.items.length ? (
              <div className={cn(calls.isFetching && calls.isPlaceholderData && 'opacity-60')}>
                <Table minWidth={1100}>
                  <THead>
                    <tr>
                      <Th>Thời gian</Th>
                      <Th>API</Th>
                      <Th>Shop</Th>
                      <Th>Kết quả</Th>
                      <Th align="right">Thời gian xử lý</Th>
                      <Th>request_id / ref</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {calls.data.items.map((c) => (
                      <Tr key={c.id}>
                        <Td className="whitespace-nowrap text-xs tabular">{fmtDateTime(c.at, { seconds: true })}</Td>
                        <Td>
                          <span className="font-mono text-xs">{c.api}</span>
                          {c.sessionId && <p className="text-2xs text-muted">Phiên Shopee #{c.sessionId}</p>}
                        </Td>
                        <Td className="max-w-[180px] truncate text-xs">{c.shopName ?? <span className="text-subtle">—</span>}</Td>
                        <Td className="max-w-[340px]">
                          {c.success ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="size-3.5" />
                              Thành công{c.httpStatus ? ` · HTTP ${c.httpStatus}` : ''}
                            </span>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                                  <XCircle className="size-3.5" />
                                  {c.errorCode || 'Lỗi'}
                                  {c.httpStatus ? ` · HTTP ${c.httpStatus}` : ''}
                                </span>
                                <ErrorClassBadge value={c.errorClass} />
                              </div>
                              {c.errorMessage && (
                                <p className="truncate text-2xs text-muted" title={c.errorMessage}>
                                  {c.errorMessage}
                                </p>
                              )}
                            </div>
                          )}
                          {(c.retries ?? 0) > 0 && (
                            <Badge tone="muted" size="sm" className="mt-1">
                              Thử lại {c.retries} lần
                            </Badge>
                          )}
                        </Td>
                        <Td align="right" className="tabular text-xs">{c.durationMs !== null ? `${fmtNumber(c.durationMs)} ms` : '—'}</Td>
                        <Td className="text-2xs">
                          {c.requestId && (
                            <button className="group/c flex max-w-[220px] items-center gap-1 font-mono text-muted hover:text-fg" onClick={() => void copy(c.requestId!, 'Đã sao chép request_id')} title="Sao chép request_id">
                              <span className="truncate">{c.requestId}</span>
                              <Copy className="size-3 shrink-0 opacity-0 group-hover/c:opacity-100" />
                            </button>
                          )}
                          {c.ref && (
                            <button className="group/c flex items-center gap-1 font-mono text-subtle hover:text-fg" onClick={() => void copy(c.ref!, 'Đã sao chép mã tham chiếu')} title="Sao chép ref">
                              ref {c.ref}
                              <Copy className="size-3 shrink-0 opacity-0 group-hover/c:opacity-100" />
                            </button>
                          )}
                          {!c.requestId && !c.ref && <span className="text-subtle">—</span>}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <div className="border-t border-line px-4 py-2.5">
                  <Pagination page={page} pageSize={50} total={calls.data.total} onChange={setPage} />
                </div>
              </div>
            ) : (
              <EmptyState compact icon={Activity} title={dref ? `Không tìm thấy lệnh gọi có mã “${dref}”` : 'Không có lệnh gọi phù hợp'} description={dref ? 'Mã tham chiếu phải khớp chính xác và nằm trong khoảng ngày đã chọn.' : undefined} />
            )}
          </>
        )}

        {tab === 'console' && <ConsoleReconcile />}
      </Card>
    </div>
  );
}
