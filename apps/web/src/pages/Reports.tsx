import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, FileDown, FileSpreadsheet, Lock, Radio, Store, Trophy } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtCompact, fmtDate, fmtDuration, fmtMoney, fmtNumber, fmtTime, todayVn } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { useShopOptions } from '@/components/domain/ShopPicker';
import { SessionStateBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Input, SearchInput, Segmented, Select } from '@/components/ui/form';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Spinner, StatCard, type Tone } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';

type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';
type Metric = 'sessions' | 'hours' | 'orders';
type ShopSort = 'sessions' | 'hours' | 'orders' | 'gmv' | 'peakViewers';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: 'month', label: 'Tháng này' },
  { value: 'lastMonth', label: 'Tháng trước' },
  { value: 'custom', label: 'Tùy chọn…' },
];

const METRIC_LABEL: Record<Metric, string> = { sessions: 'Số phiên', hours: 'Giờ phát', orders: 'Đơn hàng' };
const ORIGIN: Record<string, { label: string; tone: Tone }> = {
  manual: { label: 'Thủ công', tone: 'neutral' },
  schedule: { label: 'Lịch phát', tone: 'info' },
  legacy: { label: 'Hệ thống cũ', tone: 'muted' },
  external: { label: 'App Shopee', tone: 'violet' },
};

interface ReportItem {
  id: number;
  shopId: number;
  shopName: string;
  shopeeSessionId: number | null;
  title: string;
  origin: string;
  templateName: string | null;
  createdByName: string | null;
  state: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  peakViewers: number;
  likes: number;
  orders: number;
  gmv: number;
  lastError: string | null;
}

interface ReportResp {
  items: ReportItem[];
  total: number;
  summary: { count: number; totalSeconds: number; peakViewers: number; orders: number; gmv: number; likes: number; started: number; failed: number };
  byDay: { day: string; sessions: number; hours: number; orders: number; gmv: number }[];
  byShop: { shopId: number; shopName: string; sessions: number; hours: number; orders: number; gmv: number; peakViewers: number }[];
  from: string;
  to: string;
}

/** 3725 → "1:02" (giờ:phút); dưới 1 giờ → "45 phút" */
function hm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m} phút`;
}

function presetRange(p: Preset, custom: { from: string; to: string }): { from: string; to: string } {
  const t = todayVn();
  switch (p) {
    case 'today':
      return { from: t, to: t };
    case '7d':
      return { from: addDaysStr(t, -6), to: t };
    case '30d':
      return { from: addDaysStr(t, -29), to: t };
    case 'month':
      return { from: t.slice(0, 8) + '01', to: t };
    case 'lastMonth': {
      const firstThis = t.slice(0, 8) + '01';
      const lastPrev = addDaysStr(firstThis, -1);
      return { from: lastPrev.slice(0, 8) + '01', to: lastPrev };
    }
    default:
      return custom.from && custom.to && custom.from <= custom.to ? custom : { from: addDaysStr(t, -6), to: t };
  }
}

function DailyChart({ data, metric, from, to }: { data: ReportResp['byDay']; metric: Metric; from: string; to: string }) {
  const days = useMemo(() => {
    const map = new Map(data.map((d) => [d.day, d]));
    const out: { day: string; label: string; value: number }[] = [];
    for (let d = from, i = 0; d <= to && i < 400; d = addDaysStr(d, 1), i++) out.push({ day: d, label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, value: Number(map.get(d)?.[metric] ?? 0) });
    return out;
  }, [data, metric, from, to]);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={days} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} allowDecimals={metric === 'hours'} width={44} />
        <RTooltip
          cursor={{ fill: 'var(--surface-2)' }}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--fg)', boxShadow: 'var(--shadow-lg)' }}
          labelStyle={{ color: 'var(--muted)', marginBottom: 2 }}
          itemStyle={{ color: 'var(--fg)' }}
          formatter={(v: number) => [fmtNumber(v, metric === 'hours' ? 1 : 0), METRIC_LABEL[metric]]}
          labelFormatter={(_l, p) => (p?.[0] ? fmtDate((p[0].payload as { day: string }).day) : '')}
        />
        <Bar dataKey="value" fill="#ee4d2d" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const nav = useNavigate();
  const shops = useShopOptions(can('report.view'));
  const [preset, setPreset] = useState<Preset>('7d');
  const [custom, setCustom] = useState(() => ({ from: addDaysStr(todayVn(), -6), to: todayVn() }));
  const [shopId, setShopId] = useState('');
  const [origin, setOrigin] = useState('');
  const [search, setSearch] = useState('');
  const dq = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [metric, setMetric] = useState<Metric>('sessions');
  const [shopSort, setShopSort] = useState<ShopSort>('hours');
  const [allShops, setAllShops] = useState(false);
  const pageSize = 50;

  const { from, to } = presetRange(preset, custom);
  const filters = { from, to, shopId, origin, q: dq };
  useEffect(() => setPage(1), [from, to, shopId, origin, dq]);

  const q = useQuery({
    queryKey: ['reports', 'sessions', { ...filters, page, pageSize }],
    queryFn: () => api.get<ReportResp>('/api/reports/sessions', { ...filters, page, pageSize }),
    placeholderData: keepPreviousData,
    enabled: can('report.view'),
  });
  const d = q.data;

  const topShops = useMemo(() => [...(d?.byShop ?? [])].sort((a, b) => b[shopSort] - a[shopSort]), [d, shopSort]);

  if (!can('report.view')) return <EmptyState icon={Lock} title="Bạn chưa được cấp quyền xem báo cáo" description="Liên hệ chủ shop để được cấp quyền “Xem báo cáo”." />;

  const s = d?.summary;
  const exportFile = (format: 'xlsx' | 'csv') => download('/api/reports/sessions/export', { ...filters, format });
  const sortTh = (key: ShopSort) => ({ sort: shopSort === key ? ('desc' as const) : null, onSort: () => setShopSort(key) });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lịch sử & báo cáo"
        description="Thống kê phiên livestream theo ngày tạo phiên, giờ Việt Nam"
        actions={
          <>
            <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => exportFile('xlsx')} disabled={!d?.total}>
              Xuất Excel
            </Button>
            <Button icon={<FileDown className="size-4" />} onClick={() => exportFile('csv')} disabled={!d?.total}>
              CSV
            </Button>
          </>
        }
      />

      <Card className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <Select inputSize="sm" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="w-[calc(50%-0.25rem)] sm:w-36">
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        {preset === 'custom' ? (
          <div className="flex items-center gap-1.5">
            <Input inputSize="sm" type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-36" />
            <span className="text-muted">–</span>
            <Input inputSize="sm" type="date" value={custom.to} min={custom.from || undefined} max={todayVn()} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-36" />
          </div>
        ) : (
          <span className="px-1 text-xs tabular text-muted">
            {from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`}
          </span>
        )}
        <Select inputSize="sm" value={shopId} onChange={(e) => setShopId(e.target.value)} className="w-[calc(50%-0.25rem)] sm:w-52">
          <option value="">Tất cả shop</option>
          {(shops.data ?? []).map((sh) => (
            <option key={sh.id} value={sh.id}>
              #{sh.number} {sh.name}
            </option>
          ))}
        </Select>
        <Select inputSize="sm" value={origin} onChange={(e) => setOrigin(e.target.value)} className="w-[calc(50%-0.25rem)] sm:w-40">
          <option value="">Mọi nguồn phiên</option>
          <option value="manual">Thủ công</option>
          <option value="schedule">Lịch phát</option>
          <option value="legacy">Hệ thống cũ</option>
        </Select>
        <SearchInput inputSize="sm" value={search} onChange={setSearch} placeholder="Tiêu đề, tên shop, Session ID…" className="w-full sm:w-64" />
        {q.isFetching && <Spinner className="ml-auto size-3.5" />}
      </Card>

      {q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          {!s ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px] rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {/* 6 chỉ số trên một hàng: bỏ icon để nhãn và gợi ý không bị cắt */}
              <StatCard label="Số phiên" value={fmtNumber(s.count)} hint={`${fmtNumber(s.started)} lên sóng · ${fmtNumber(s.failed)} lỗi`} />
              <StatCard label="Giờ phát" value={fmtNumber(s.totalSeconds / 3600, 1)} hint={s.started ? `TB ${hm(s.totalSeconds / s.started)}/phiên` : 'giờ'} />
              <StatCard label="Người xem cao nhất" value={fmtNumber(s.peakViewers)} hint="Đỉnh trong 1 phiên" />
              <StatCard label="Đơn hàng" value={fmtNumber(s.orders)} hint={s.started ? `${fmtNumber(s.orders / s.started, 1)} đơn/phiên` : undefined} />
              <StatCard label="Doanh thu" value={`${fmtCompact(s.gmv)} ₫`} hint={fmtMoney(s.gmv)} />
              <StatCard label="Lượt thích" value={fmtCompact(s.likes)} hint={fmtNumber(s.likes)} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader
                title={`${METRIC_LABEL[metric]} theo ngày`}
                icon={<BarChart3 className="size-4" />}
                description={from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`}
                actions={
                  <Segmented
                    size="sm"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      { value: 'sessions', label: 'Số phiên' },
                      { value: 'hours', label: 'Giờ phát' },
                      { value: 'orders', label: 'Đơn hàng' },
                    ]}
                  />
                }
              />
              <div className="px-2 pb-2 pt-3">{d ? <DailyChart data={d.byDay} metric={metric} from={d.from ?? from} to={d.to ?? to} /> : <Skeleton className="h-[240px]" />}</div>
            </Card>

            <Card className="min-w-0">
              <CardHeader title="Shop nổi bật" icon={<Trophy className="size-4" />} description="Bấm tiêu đề cột để sắp xếp" />
              {!d ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8" />
                  ))}
                </div>
              ) : !topShops.length ? (
                <EmptyState compact icon={Store} title="Chưa có dữ liệu" />
              ) : (
                <>
                  <div className="max-h-[264px] overflow-y-auto">
                    <Table minWidth={460}>
                      <THead>
                        <tr>
                          <Th>Shop</Th>
                          <Th align="right" {...sortTh('sessions')}>Phiên</Th>
                          <Th align="right" {...sortTh('hours')}>Giờ</Th>
                          <Th align="right" {...sortTh('orders')}>Đơn</Th>
                          <Th align="right" {...sortTh('gmv')}>Doanh thu</Th>
                          <Th align="right" {...sortTh('peakViewers')}>Xem max</Th>
                        </tr>
                      </THead>
                      <tbody>
                        {(allShops ? topShops : topShops.slice(0, 10)).map((r, i) => (
                          <Tr key={r.shopId}>
                            <Td className="max-w-[180px]">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="w-4 shrink-0 text-right text-2xs tabular text-subtle">{i + 1}</span>
                                <Link to={`/shops/${r.shopId}/history`} className="truncate font-medium hover:text-brand-600">
                                  {r.shopName}
                                </Link>
                              </div>
                            </Td>
                            <Td align="right" className="tabular">{fmtNumber(r.sessions)}</Td>
                            <Td align="right" className="tabular">{fmtNumber(r.hours, 1)}</Td>
                            <Td align="right" className="tabular">{fmtNumber(r.orders)}</Td>
                            <Td align="right" className="tabular" title={fmtMoney(r.gmv)}>{fmtCompact(r.gmv)}</Td>
                            <Td align="right" className="tabular">{fmtNumber(r.peakViewers)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  {topShops.length > 10 && (
                    <div className="border-t border-line px-4 py-2">
                      <button type="button" onClick={() => setAllShops(!allShops)} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        {allShops ? 'Thu gọn' : `Xem cả ${topShops.length} shop`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Danh sách phiên" icon={<Radio className="size-4" />} description={d ? `${fmtNumber(d.total)} phiên · bấm một dòng để xem chi tiết` : undefined} />
            {!d ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : !d.items.length ? (
              <EmptyState icon={Radio} title="Không có phiên nào" description="Thử đổi khoảng thời gian hoặc bỏ bớt bộ lọc." />
            ) : (
              <Table minWidth={980}>
                <THead>
                  <tr>
                    <Th>Phiên</Th>
                    <Th>Shop</Th>
                    <Th>Nguồn</Th>
                    <Th>Thời gian</Th>
                    <Th>Trạng thái</Th>
                    <Th align="right">Xem max</Th>
                    <Th align="right">Đơn</Th>
                    <Th align="right">Doanh thu</Th>
                  </tr>
                </THead>
                <tbody>
                  {d.items.map((r) => {
                    const o = ORIGIN[r.origin] ?? { label: r.origin, tone: 'neutral' as Tone };
                    const failed = !r.startedAt && r.state === 'ended';
                    return (
                      <Tr key={r.id} onClick={() => nav(`/sessions/${r.id}`)}>
                        <Td className="max-w-[240px]">
                          <p className="truncate font-medium" title={r.title}>{r.title}</p>
                          <p className="truncate text-xs text-muted">
                            {r.shopeeSessionId ? `Session ${r.shopeeSessionId}` : 'Chưa có Session ID'}
                            {r.templateName && ` · ${r.templateName}`}
                          </p>
                        </Td>
                        <Td className="max-w-[160px]">
                          <p className="truncate" title={r.shopName}>{r.shopName}</p>
                          {r.createdByName && <p className="truncate text-xs text-muted">{r.createdByName}</p>}
                        </Td>
                        <Td>
                          <Badge tone={o.tone} size="sm">
                            {o.label}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <p className="tabular">
                            {fmtDate(r.createdAt)} <span className="text-muted">{r.startedAt ? `${fmtTime(r.startedAt)}–${r.endedAt ? fmtTime(r.endedAt) : 'nay'}` : fmtTime(r.createdAt)}</span>
                          </p>
                          <p className="text-xs tabular text-muted">{r.durationSec ? fmtDuration(r.durationSec) : 'Chưa lên sóng'}</p>
                        </Td>
                        <Td>
                          <div className="flex flex-col items-start gap-0.5">
                            <SessionStateBadge state={r.state} size="sm" />
                            {failed && (
                              <span className="max-w-[180px] truncate text-2xs text-rose-600 dark:text-rose-400" title={r.lastError ?? undefined}>
                                Không lên sóng{r.lastError ? `: ${r.lastError}` : ''}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td align="right" className="tabular">{fmtNumber(r.peakViewers)}</Td>
                        <Td align="right" className="tabular">{fmtNumber(r.orders)}</Td>
                        <Td align="right" className="whitespace-nowrap tabular" title={fmtMoney(r.gmv)}>
                          {r.gmv ? fmtMoney(r.gmv) : '—'}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {d && d.total > 0 && (
              <div className="border-t border-line px-4 py-2.5">
                <Pagination page={page} pageSize={pageSize} total={d.total} onChange={setPage} />
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
