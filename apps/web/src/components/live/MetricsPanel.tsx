import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Clock, Eye, Heart, MessageCircle, MousePointerClick, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { fmtCompact, fmtDuration, fmtMoney, fmtNumber, fmtRelative, fmtTime } from '@/lib/format';
import type { LiveSession } from '@/lib/types';
import { Card, CardHeader } from '@/components/ui/misc';
import type { MetricSample } from './types';

const SERIES_COLOR = '#ee4d2d';

function ViewersChart({ samples }: { samples: MetricSample[] }) {
  const data = useMemo(() => samples.filter((s) => s.viewers !== null).map((s) => ({ t: Date.parse(s.at), viewers: s.viewers ?? 0 })), [samples]);
  if (data.length < 2)
    return <div className="grid h-[180px] place-items-center rounded-lg border border-dashed border-line-strong text-center text-xs text-muted">Chưa đủ dữ liệu — số người xem được ghi lại mỗi lần đồng bộ với Shopee khi phiên đang live.</div>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => fmtTime(v)} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} minTickGap={40} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} allowDecimals={false} width={44} tickFormatter={(v: number) => fmtCompact(v)} />
        <RTooltip
          cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--fg)', boxShadow: 'var(--shadow-lg)' }}
          labelStyle={{ color: 'var(--muted)', marginBottom: 2 }}
          itemStyle={{ color: 'var(--fg)' }}
          labelFormatter={(v: number) => fmtTime(v, true)}
          formatter={(v: number) => [fmtNumber(v), 'Người xem']}
        />
        <Line type="monotone" dataKey="viewers" stroke={SERIES_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MetricsPanel({ session, samples }: { session: LiveSession; samples: MetricSample[] }) {
  const m = session.metrics ?? {};
  const tiles = [
    { icon: Eye, label: 'Đang xem', value: fmtNumber(m.viewers ?? 0), strong: true },
    { icon: TrendingUp, label: 'Cao nhất', value: fmtNumber(m.peakViewers ?? 0) },
    { icon: MousePointerClick, label: 'Lượt xem', value: fmtNumber(m.views ?? 0) },
    { icon: Clock, label: 'Xem trung bình', value: m.avgViewSec ? fmtDuration(m.avgViewSec) : '—' },
    { icon: Heart, label: 'Lượt thích', value: fmtNumber(m.likes ?? 0) },
    { icon: MessageCircle, label: 'Bình luận', value: fmtNumber(m.comments ?? 0) },
    { icon: ShoppingBag, label: 'Đơn hàng', value: fmtNumber(m.orders ?? 0), strong: true },
    { icon: Wallet, label: 'Doanh thu', value: m.gmv ? fmtMoney(m.gmv) : '—' },
  ];
  return (
    <Card>
      <CardHeader
        title="Số liệu phiên"
        icon={<BarChart3 className="size-4" />}
        description={session.lastShopeeSyncAt ? `Số liệu từ Shopee · cập nhật ${fmtRelative(session.lastShopeeSyncAt)}` : 'Số liệu từ Shopee'}
      />
      <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-line bg-line sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-surface px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <t.icon className="size-3.5" />
              {t.label}
            </p>
            <p className={t.strong ? 'mt-0.5 text-lg font-semibold tabular' : 'mt-0.5 text-[15px] font-semibold tabular'}>{t.value}</p>
          </div>
        ))}
      </div>
      <div className="px-5 py-4">
        <p className="mb-2 text-[13px] font-medium">Người xem theo thời gian</p>
        <ViewersChart samples={samples} />
      </div>
    </Card>
  );
}
