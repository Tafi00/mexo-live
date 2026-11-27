import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  Eye,
  Plug,
  Radio,
  Server,
  Store,
  XCircle,
  Zap,
} from 'lucide-react';
import { ALERT_SEVERITY_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, fmtNumber, fmtPercent, fmtRelative, fmtTime, todayVn } from '@/lib/format';
import { Signals } from '@/components/domain/status';
import { ButtonLink } from '@/components/ui/button';
import { Segmented } from '@/components/ui/form';
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/misc';

type Metric = 'sessions' | 'hours' | 'orders';
const METRIC_LABEL: Record<Metric, string> = { sessions: 'Số phiên', hours: 'Giờ phát', orders: 'Đơn hàng' };

function DailyChart({ data, metric }: { data: { day: string; sessions: number; hours: number; orders: number }[]; metric: Metric }) {
  // Lấp các ngày trống để trục thời gian liên tục
  const days: { day: string; label: string; value: number }[] = [];
  const map = new Map(data.map((d) => [d.day, d]));
  const t = todayVn();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.parse(t + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10);
    days.push({ day: d, label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, value: Number(map.get(d)?.[metric] ?? 0) });
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={days} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} allowDecimals={metric === 'hours'} width={40} />
        <RTooltip
          cursor={{ fill: 'var(--surface-2)' }}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--fg)', boxShadow: 'var(--shadow-lg)' }}
          labelStyle={{ color: 'var(--muted)', marginBottom: 2 }}
          formatter={(v: number) => [fmtNumber(v, metric === 'hours' ? 1 : 0), METRIC_LABEL[metric]]}
          labelFormatter={(_l, p) => (p?.[0] ? fmtDate((p[0].payload as { day: string }).day) : '')}
        />
        <Bar dataKey="value" fill="#ee4d2d" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Dashboard() {
  const { me, isStaff } = useAuth();
  const nav = useNavigate();
  const [metric, setMetric] = useState<Metric>('sessions');
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/api/dashboard'), refetchInterval: 20_000 });
  const d = q.data;
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false }));
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${greet}, ${me?.user.name ?? ''}`}
        description="Tổng quan hoạt động livestream trên các gian hàng bạn quản lý"
        actions={
          <>
            <ButtonLink to="/live" icon={<Radio className="size-4" />}>
              Phòng điều khiển
            </ButtonLink>
            <ButtonLink to="/shops?tab=needs" variant="primary" icon={<AlertTriangle className="size-4" />}>
              Việc cần xử lý {d ? `(${d.shops.needs})` : ''}
            </ButtonLink>
          </>
        }
      />

      {!d ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Tổng gian hàng" value={fmtNumber(d.shops.total)} hint={`${d.shops.connected} đang kết nối`} icon={<Store className="size-4" />} onClick={() => nav('/shops')} />
            <StatCard label="Đang livestream" value={fmtNumber(d.shops.live)} hint={`${fmtNumber(d.viewersNow)} người đang xem`} icon={<Radio className="size-4" />} tone="brand" onClick={() => nav('/live')} />
            <StatCard label="Cần xử lý" value={fmtNumber(d.shops.needs)} hint={d.shops.disconnected ? `${d.shops.disconnected} cần cấp quyền lại` : 'Không có shop mất kết nối'} icon={<AlertTriangle className="size-4" />} tone={d.shops.needs ? 'warning' : 'success'} onClick={() => nav('/shops?tab=needs')} />
            <StatCard label="Lịch phát đang chờ" value={fmtNumber(d.schedules.pending)} hint={`Hôm nay: ${d.schedules.todayDone} đã chạy${d.schedules.todayMissed ? `, ${d.schedules.todayMissed} bỏ lỡ` : ''}`} icon={<CalendarClock className="size-4" />} tone="info" onClick={() => nav('/schedules')} />
            <StatCard label="Phiên thành công (7 ngày)" value={fmtNumber(d.sessions7d.ok)} hint={`${fmtNumber(d.sessions7d.hours, 1)} giờ phát · ${fmtNumber(d.sessions7d.orders)} đơn`} icon={<CheckCircle2 className="size-4" />} tone="success" />
            <StatCard label="Phiên thất bại (7 ngày)" value={fmtNumber(d.sessions7d.failed)} hint="Không lên sóng được" icon={<XCircle className="size-4" />} tone={d.sessions7d.failed ? 'danger' : 'neutral'} />
            <StatCard label="Phiên gặp lỗi" value={fmtNumber(d.sessions7d.errored)} hint="Treo, mất kết nối, lỗi đồng bộ" icon={<Zap className="size-4" />} tone={d.sessions7d.errored ? 'warning' : 'neutral'} />
            {isStaff && d.servers ? (
              <StatCard
                label="Máy chủ phát"
                value={`${d.servers.online}/${d.servers.total}`}
                hint={`${d.servers.capacity.used}/${d.servers.capacity.total} luồng đồng thời`}
                icon={<Server className="size-4" />}
                tone={d.servers.attention ? 'danger' : d.servers.online ? 'success' : 'warning'}
                onClick={() => nav('/servers')}
              />
            ) : (
              <StatCard label="Phiên đồng thời" value={fmtNumber(d.concurrent)} icon={<Activity className="size-4" />} />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title={`${METRIC_LABEL[metric]} 14 ngày qua`}
                description="Tính theo ngày tạo phiên, giờ Việt Nam"
                actions={
                  <Segmented
                    size="sm"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      { value: 'sessions', label: 'Phiên' },
                      { value: 'hours', label: 'Giờ phát' },
                      { value: 'orders', label: 'Đơn hàng' },
                    ]}
                  />
                }
              />
              <div className="px-3 pb-3 pt-4">
                <DailyChart data={d.daily} metric={metric} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Việc cần xử lý" icon={<AlertTriangle className="size-4 text-amber-500" />} actions={<Link to="/shops?tab=needs" className="text-xs font-medium text-brand-600 hover:underline">Xem tất cả</Link>} />
              {d.needsAttention.length ? (
                <ul className="divide-y divide-line">
                  {d.needsAttention.slice(0, 7).map((s: any) => (
                    <li key={s.id}>
                      <Link to={`/shops/${s.id}`} className="flex items-start gap-3 px-5 py-2.5 hover:bg-surface-2/60">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{s.name}</p>
                          <p className={cn('truncate text-xs', s.issues[0]?.level === 'critical' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400')}>
                            {s.issues.filter((i: any) => i.level !== 'info').map((i: any) => i.text).join(' · ')}
                          </p>
                        </div>
                        <ArrowRight className="mt-1 size-3.5 shrink-0 text-subtle" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon={CheckCircle2} title="Mọi shop đều ổn" description="Không có việc cần xử lý." />
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Đang livestream" description="Nhiều người xem nhất" icon={<Radio className="size-4 text-brand-500" />} actions={<ButtonLink to="/live" size="sm">Phòng điều khiển</ButtonLink>} />
              {d.topLive.length ? (
                <div className="divide-y divide-line">
                  {d.topLive.map((s: any) => (
                    <Link key={s.id} to={`/sessions/${s.session.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2/60">
                      <span className="relative flex size-2.5 shrink-0">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-50" />
                        <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        <p className="truncate text-xs text-muted">
                          {s.session.title}
                          {s.session.startedAt && ` · từ ${fmtTime(s.session.startedAt)}`}
                          {s.session.videoCount ? ` · video ${(s.session.videoIndex ?? 0) + 1}/${s.session.videoCount}` : ''}
                        </p>
                      </div>
                      <span className="hidden sm:block">{s.session.origin !== 'legacy' && <Signals signals={s.session.signals} compact />}</span>
                      <span className="inline-flex w-16 items-center justify-end gap-1 text-sm font-semibold tabular">
                        <Eye className="size-3.5 text-muted" />
                        {fmtNumber(s.session.viewers)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState compact icon={Radio} title="Chưa có shop nào đang live" />
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader title="Lịch phát sắp tới" icon={<CalendarClock className="size-4" />} actions={<Link to="/schedules" className="text-xs font-medium text-brand-600 hover:underline">Lịch</Link>} />
                {d.upcoming.length ? (
                  <ul className="divide-y divide-line">
                    {d.upcoming.map((r: any) => (
                      <li key={r.id} className="flex items-center gap-3 px-5 py-2.5">
                        <div className="w-14 shrink-0 text-center">
                          <p className="text-sm font-semibold tabular">{fmtTime(r.startAt)}</p>
                          <p className="text-2xs text-muted">{r.runDate === todayVn() ? 'Hôm nay' : fmtDate(r.runDate).slice(0, 5)}</p>
                        </div>
                        <div className="min-w-0">
                          <Link to={`/shops/${r.shopId}/schedules`} className="block truncate text-sm font-medium hover:text-brand-600">
                            {r.shopName}
                          </Link>
                          <p className="truncate text-xs text-muted">{r.title}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact icon={CalendarClock} title="Không có lịch nào sắp tới" />
                )}
              </Card>

              {isStaff && d.api && (
                <Card>
                  <CardHeader title="API Shopee 24 giờ" icon={<Activity className="size-4" />} actions={<Link to="/monitor" className="text-xs font-medium text-brand-600 hover:underline">Chi tiết</Link>} />
                  <div className="grid grid-cols-3 gap-2 p-4 text-center">
                    <div>
                      <p className="text-xs text-muted">Thành công</p>
                      <p className={cn('text-lg font-semibold tabular', d.api.successRate24h !== null && d.api.successRate24h < 0.94 ? 'text-rose-600' : d.api.successRate24h !== null && d.api.successRate24h < 0.97 ? 'text-amber-600' : '')}>{fmtPercent(d.api.successRate24h)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">Lệnh gọi</p>
                      <p className="text-lg font-semibold tabular">{fmtNumber(d.api.total24h)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">TB phản hồi</p>
                      <p className="text-lg font-semibold tabular">{d.api.avgMs ?? '—'}<span className="text-xs font-normal text-muted"> ms</span></p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Card>
            <CardHeader title="Cảnh báo đang mở" icon={<Bell className="size-4" />} actions={<ButtonLink to="/alerts" size="sm">Tất cả cảnh báo</ButtonLink>} />
            {d.alerts.length ? (
              <ul className="divide-y divide-line">
                {d.alerts.map((a: any) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-2.5">
                    <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'} size="sm" icon={a.severity === 'critical' ? <XCircle className="size-3" /> : <AlertTriangle className="size-3" />}>
                      {ALERT_SEVERITY_LABELS[a.severity as 'critical']}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {a.title}
                        {a.count > 1 && <span className="ml-1.5 text-xs font-normal text-muted">×{a.count}</span>}
                      </p>
                      <p className="truncate text-xs text-muted">{a.message}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{fmtRelative(a.lastAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={CheckCircle2} title="Không có cảnh báo đang mở" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
