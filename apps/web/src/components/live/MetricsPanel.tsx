import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Clock, Eye, Heart, MessageCircle, MousePointerClick, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { fmtCompact, fmtDuration, fmtMoney, fmtNumber, fmtRelative, fmtTime } from '@/lib/format';
import type { LiveSession } from '@/lib/types';
import { Card, CardHeader } from '@/components/ui/misc';
import type { MetricSample } from './types';

const SERIES_COLOR = '#ee4d2d';
const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360];

/** Mốc trục thời gian tròn phút (tránh nhãn trùng "12:28 12:28…") */
function timeTicks(min: number, max: number): { ticks: number[]; seconds: boolean } {
  const range = max - min;
  if (range < 3 * 60_000) {
    const step = range < 60_000 ? 15_000 : 30_000;
    const out: number[] = [];
    for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(t);
    return { ticks: out, seconds: true };
  }
  const stepMin = STEPS_MIN.find((m) => range / (m * 60_000) <= 6) ?? 720;
  const step = stepMin * 60_000;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(t);
  return { ticks: out, seconds: false };
}

function ViewersChart({ samples }: { samples: MetricSample[] }) {
  const data = useMemo(() => samples.filter((s) => s.viewers !== null).map((s) => ({ t: Date.parse(s.at), viewers: s.viewers ?? 0 })), [samples]);
  const axis = useMemo(() => (data.length >= 2 ? timeTicks(data[0].t, data[data.length - 1].t) : { ticks: [], seconds: false }), [data]);
  if (data.length < 2)
    return <div className="grid h-[180px] place-items-center rounded-lg border border-dashed border-line-strong text-center text-xs text-muted">Chưa đủ dữ liệu — số người xem được ghi lại mỗi lần đồng bộ với Shopee khi phiên đang live.</div>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={axis.ticks} tickFormatter={(v: number) => fmtTime(v, axis.seconds)} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} minTickGap={24} />
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
          <div key={t.label} className="bg-surface px-4 py-2.5">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <t.icon className="size-3.5" />
              {t.label}
            </p>
            <p className={t.strong ? 'mt-0.5 text-lg font-semibold tabular' : 'mt-0.5 text-base font-semibold tabular'}>{t.value}</p>
          </div>
        ))}
      </div>
      <div className="p-4">
        <p className="mb-2 text-sm font-medium">Người xem theo thời gian</p>
        <ViewersChart samples={samples} />
      </div>
    </Card>
  );
}
