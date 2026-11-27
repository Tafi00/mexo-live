import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Bug, CheckCircle2, Globe, ShieldAlert, WifiOff, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtDate, fmtNumber, fmtPercent, todayVn } from '@/lib/format';
import { Badge, type Tone } from '@/components/ui/misc';
import { axisTick, BRAND, chartTooltip } from './common';

export interface Agg {
  total: number;
  success: number;
  failed: number;
  rate: number | null;
  avgMs: number | null;
}

export interface MonitorSummary {
  from: string;
  to: string;
  current: Agg;
  previous: Agg;
  lastHour: { total: number; rate: number | null };
  today: { total: number; rate: number | null };
  level: 'normal' | 'warning' | 'danger';
  thresholds: { normal: number; danger1h: number; dangerDay: number; shopeeMin: number };
  apis: string[];
}

export interface SeriesPoint {
  bucket: string;
  total: number;
  success: number;
  rate: number | null;
  avgMs: number;
}

export interface ChartPoint extends SeriesPoint {
  label: string;
  full: string;
}

/** Lấp các mốc trống để trục thời gian liên tục */
export function fillSeries(items: SeriesPoint[], from: string, to: string, granularity: 'day' | 'hour'): ChartPoint[] {
  const map = new Map(items.map((i) => [i.bucket, i]));
  const out: ChartPoint[] = [];
  const empty = (bucket: string): SeriesPoint => ({ bucket, total: 0, success: 0, rate: null, avgMs: 0 });
  if (granularity === 'day') {
    for (let d = from; d <= to; d = addDaysStr(d, 1)) {
      const p = map.get(d) ?? empty(d);
      out.push({ ...p, label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, full: fmtDate(d) });
    }
    return out;
  }
  const nowVn = new Date(Date.now() + 7 * 3600000).toISOString();
  const nowKey = `${nowVn.slice(0, 10)} ${nowVn.slice(11, 13)}:00`;
  const today = todayVn();
  for (let d = from; d <= to; d = addDaysStr(d, 1)) {
    for (let h = 0; h < 24; h++) {
      const key = `${d} ${String(h).padStart(2, '0')}:00`;
      if (d === today && key > nowKey) break;
      const p = map.get(key) ?? empty(key);
      out.push({ ...p, label: from === to ? `${String(h).padStart(2, '0')}h` : `${d.slice(8, 10)}/${d.slice(5, 7)} ${String(h).padStart(2, '0')}h`, full: `${fmtDate(d)} ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59` });
    }
  }
  return out;
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload?: ChartPoint }[] }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div style={chartTooltip.contentStyle} className="min-w-[180px] px-3 py-2">
      <p className="mb-1 text-[11px] text-muted">{p.full}</p>
      <div className="space-y-0.5 text-xs">
        <p className="flex justify-between gap-4">
          <span className="text-muted">Tỷ lệ thành công</span>
          <b className="tabular">{fmtPercent(p.rate, 2)}</b>
        </p>
        <p className="flex justify-between gap-4">
          <span className="text-muted">Lệnh gọi</span>
          <span className="tabular">{fmtNumber(p.total)}</span>
        </p>
        <p className="flex justify-between gap-4">
          <span className="text-muted">Lỗi</span>
          <span className="tabular">{fmtNumber(p.total - p.success)}</span>
        </p>
        {p.total > 0 && (
          <p className="flex justify-between gap-4">
            <span className="text-muted">TB phản hồi</span>
            <span className="tabular">{fmtNumber(p.avgMs)} ms</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** Biểu đồ tỷ lệ thành công — một trục, có vạch 90% (Shopee) và 97% (bình thường) */
export function RateChart({ data, height = 240 }: { data: ChartPoint[]; height?: number }) {
  const rates = data.map((d) => d.rate).filter((r): r is number => r !== null);
  const min = rates.length ? Math.min(...rates) : 1;
  const yMin = Math.max(0, Math.min(0.8, Math.floor(min * 20) / 20));
  const step = 1 - yMin > 0.3 ? 0.1 : 0.05;
  const ticks: number[] = [];
  for (let v = 1; v >= yMin - 1e-9; v -= step) ticks.unshift(Math.round(v * 100) / 100);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 12, left: -4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" minTickGap={18} />
        <YAxis domain={[yMin, 1]} ticks={ticks} allowDataOverflow tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} tick={axisTick} width={44} />
        <RTooltip cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }} content={<Tip />} />
        <ReferenceLine y={0.97} stroke="#10b981" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Bình thường 97%', position: 'insideBottomRight', fill: 'var(--muted)', fontSize: 10 }} />
        <ReferenceLine y={0.9} stroke="#e11d48" strokeDasharray="4 4" strokeWidth={1} label={{ value: 'Shopee tối thiểu 90%', position: 'insideBottomRight', fill: 'var(--muted)', fontSize: 10 }} />
        <Line type="monotone" dataKey="rate" stroke={BRAND} strokeWidth={2} dot={data.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: BRAND } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Biểu đồ số lệnh gọi — cột, một chuỗi */
export function VolumeChart({ data, height = 240 }: { data: ChartPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, left: -4, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tickLine={false} axisLine={false} tick={axisTick} width={48} allowDecimals={false} tickFormatter={(v: number) => Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)} />
        <RTooltip cursor={{ fill: 'var(--surface-2)' }} content={<Tip />} />
        <Bar dataKey="total" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ───────────── Băng-rôn mức độ ─────────────
const LEVEL: Record<MonitorSummary['level'], { label: string; icon: typeof CheckCircle2; cls: string; iconCls: string }> = {
  normal: { label: 'Bình thường', icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/25', iconCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  warning: { label: 'Cảnh báo', icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/25', iconCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  danger: { label: 'Nguy hiểm', icon: XCircle, cls: 'border-rose-200 bg-rose-50/80 dark:border-rose-900/60 dark:bg-rose-950/25', iconCls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
};

export function LevelBanner({ s }: { s: MonitorSummary }) {
  const L = LEVEL[s.level];
  const Icon = L.icon;
  const t = s.thresholds;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className={cn('flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center', L.cls)}>
      <div className="flex items-center gap-3">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-full', L.iconCls)}>
          <Icon className="size-5" />
        </span>
        <div>
          <p className="text-xs font-medium text-muted">Tình trạng hiện tại</p>
          <p className="text-lg font-semibold leading-tight">{L.label}</p>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg bg-surface/70 px-3 py-2 ring-1 ring-inset ring-line">
          <p className="text-[11px] text-muted">1 giờ qua</p>
          <p className="text-[15px] font-semibold tabular">{fmtPercent(s.lastHour.rate, 2)}</p>
          <p className="text-[11px] text-muted tabular">{fmtNumber(s.lastHour.total)} lệnh gọi</p>
        </div>
        <div className="rounded-lg bg-surface/70 px-3 py-2 ring-1 ring-inset ring-line">
          <p className="text-[11px] text-muted">Hôm nay</p>
          <p className="text-[15px] font-semibold tabular">{fmtPercent(s.today.rate, 2)}</p>
          <p className="text-[11px] text-muted tabular">{fmtNumber(s.today.total)} lệnh gọi</p>
        </div>
      </div>
      <div className="text-xs leading-relaxed text-muted sm:max-w-sm">
        <p>
          <b className="text-fg">Shopee yêu cầu</b> tỷ lệ thành công trung bình ngày của App ≥ {pct(t.shopeeMin)}.
        </p>
        <p>
          Ngưỡng nội bộ: bình thường ≥ {pct(t.normal)} · cảnh báo &lt; {pct(t.normal)} trong 1 giờ · nguy hiểm &lt; {pct(t.danger1h)} trong 1 giờ hoặc &lt; {pct(t.dangerDay)} trong ngày.
        </p>
      </div>
    </div>
  );
}

// ───────────── Nhóm lỗi ─────────────
const ERROR_CLASS: Record<string, { label: string; tone: Tone; icon: typeof Bug; hint: string }> = {
  shopee: { label: 'Lỗi Shopee API', tone: 'warning', icon: ShieldAlert, hint: 'Shopee trả về mã lỗi (sai tham số, hết quyền, giới hạn tần suất…)' },
  network: { label: 'Lỗi mạng / timeout', tone: 'info', icon: WifiOff, hint: 'Không kết nối được hoặc quá thời gian chờ phản hồi từ Shopee' },
  backend: { label: 'Lỗi hệ thống', tone: 'danger', icon: Bug, hint: 'Lỗi phía MEXO khi chuẩn bị hoặc xử lý lệnh gọi' },
};

export function errorClassInfo(c: string | null | undefined) {
  return ERROR_CLASS[c ?? ''] ?? { label: c || 'Không phân loại', tone: 'muted' as Tone, icon: Globe, hint: '' };
}

export function ErrorClassBadge({ value, size = 'sm' }: { value: string | null | undefined; size?: 'sm' | 'md' }): ReactNode {
  const i = errorClassInfo(value);
  const Icon = i.icon;
  return (
    <Badge tone={i.tone} size={size} icon={<Icon className="size-3" />}>
      {i.label}
    </Badge>
  );
}
