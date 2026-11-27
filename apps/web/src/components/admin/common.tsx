import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Copy, Eye, EyeOff, Info, KeyRound, Minus, XCircle } from 'lucide-react';
import { ALERT_SEVERITY_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtPercent, todayVn } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Segmented } from '@/components/ui/form';
import { Badge, Callout, Progress, type Tone } from '@/components/ui/misc';

// ───────────── Biểu đồ: kiểu chung (recharts) ─────────────
export const chartTooltip = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, color: 'var(--fg)', boxShadow: 'var(--shadow-lg)' },
  labelStyle: { color: 'var(--muted)', marginBottom: 2 },
  itemStyle: { color: 'var(--fg)', padding: 0 },
} as const;
export const axisTick = { fill: 'var(--muted)', fontSize: 11 };
export const BRAND = '#ee4d2d';

// ───────────── Bí mật chỉ hiện một lần ─────────────

/** Ô hiển thị bí mật (mật khẩu tạm, khóa máy chủ) kèm nút sao chép */
export function SecretBox({ label, value, mono = true, maskable = false }: { label?: ReactNode; value: string; mono?: boolean; maskable?: boolean }) {
  const copy = useCopy();
  const [shown, setShown] = useState(!maskable);
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-medium">{label}</p>}
      <div className="flex items-stretch gap-2">
        <div className={cn('flex min-h-8 min-w-0 flex-1 items-center rounded-lg border border-line-strong bg-surface-2 px-3 py-1.5 text-sm', mono && 'font-mono')}>
          <span className="min-w-0 flex-1 select-all break-all">{shown ? value : '•'.repeat(Math.min(24, value.length))}</span>
        </div>
        {maskable && (
          <Button iconOnly variant="outline" icon={shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => setShown((s) => !s)} aria-label={shown ? 'Ẩn' : 'Hiện'} />
        )}
        <Button variant="outline" icon={<Copy className="size-4" />} onClick={() => void copy(value)}>
          Sao chép
        </Button>
      </div>
    </div>
  );
}

/** Hộp thoại hiển thị bí mật một lần — không đóng được bằng click ngoài / Esc */
export function SecretDialog({ open, onClose, title, description, children, warning }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; warning: ReactNode }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={false}
      title={
        <span className="inline-flex items-center gap-2">
          <KeyRound className="size-4 text-brand-500" />
          {title}
        </span>
      }
      description={description}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Tôi đã lưu, đóng lại
        </Button>
      }
    >
      <div className="space-y-4">
        <Callout tone="warning" title="Chỉ hiện một lần">
          {warning}
        </Callout>
        {children}
      </div>
    </Dialog>
  );
}

// ───────────── Mức độ cảnh báo ─────────────
const SEVERITY: Record<string, { tone: Tone; icon: typeof XCircle }> = {
  critical: { tone: 'danger', icon: XCircle },
  warning: { tone: 'warning', icon: AlertTriangle },
  info: { tone: 'info', icon: Info },
};

export function SeverityBadge({ severity, size = 'md' }: { severity: string; size?: 'sm' | 'md' }) {
  const s = SEVERITY[severity] ?? SEVERITY.info!;
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} size={size} icon={<Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />}>
      {ALERT_SEVERITY_LABELS[severity as keyof typeof ALERT_SEVERITY_LABELS] ?? severity}
    </Badge>
  );
}

// ───────────── Tỷ lệ thành công ─────────────
export type RateLevel = 'ok' | 'warning' | 'danger' | 'none';

/** Mặc định theo ngưỡng ngày: < 94% nguy hiểm, < 97% cảnh báo */
export function rateLevel(rate: number | null | undefined, dangerBelow = 0.94, warnBelow = 0.97): RateLevel {
  if (rate === null || rate === undefined || !isFinite(rate)) return 'none';
  if (rate < dangerBelow) return 'danger';
  if (rate < warnBelow) return 'warning';
  return 'ok';
}

const LEVEL_CLS: Record<RateLevel, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-rose-600 dark:text-rose-400',
  none: 'text-subtle',
};
const LEVEL_LABEL: Record<RateLevel, string> = { ok: 'Đạt', warning: 'Cảnh báo', danger: 'Nguy hiểm', none: 'Chưa có dữ liệu' };

export function RateValue({ rate, dangerBelow, digits = 2, className, label = false }: { rate: number | null | undefined; dangerBelow?: number; digits?: number; className?: string; label?: boolean }) {
  const lv = rateLevel(rate, dangerBelow);
  const Icon = lv === 'ok' ? CheckCircle2 : lv === 'warning' ? AlertTriangle : lv === 'danger' ? XCircle : Minus;
  return (
    <span className={cn('inline-flex items-center gap-1 font-medium tabular', LEVEL_CLS[lv], className)} title={LEVEL_LABEL[lv]}>
      <Icon className="size-3.5 shrink-0" />
      {fmtPercent(rate ?? null, digits)}
      {label && lv !== 'none' && <span className="text-2xs font-normal">· {LEVEL_LABEL[lv]}</span>}
    </span>
  );
}

/** Chênh lệch so với kỳ trước: mũi tên + chữ, màu theo hướng tốt/xấu */
export function Delta({ current, previous, mode, good = 'up', digits = 1 }: { current: number | null | undefined; previous: number | null | undefined; mode: 'pp' | 'pct'; good?: 'up' | 'down' | 'neutral'; digits?: number }) {
  if (current === null || current === undefined || previous === null || previous === undefined) return <span className="text-subtle">Kỳ trước chưa có dữ liệu</span>;
  let diff: number;
  if (mode === 'pp') diff = (current - previous) * 100;
  else {
    if (!previous) return <span className="text-subtle">Kỳ trước = 0</span>;
    diff = ((current - previous) / previous) * 100;
  }
  const flat = Math.abs(diff) < Math.pow(10, -digits) / 2;
  const up = diff > 0;
  const better = good === 'neutral' || flat ? null : (good === 'up') === up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const txt = `${up ? '+' : flat ? '±' : '−'}${Math.abs(diff).toLocaleString('vi-VN', { maximumFractionDigits: digits, minimumFractionDigits: flat ? 0 : Math.min(digits, 1) })}${mode === 'pp' ? ' điểm %' : '%'}`;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium', better === null ? 'text-muted' : better ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
      <Icon className="size-3.5" />
      {txt}
    </span>
  );
}

// ───────────── Thanh chỉ số (CPU/RAM/ổ đĩa) ─────────────
export function MetricBar({ label, pct, text, icon }: { label: ReactNode; pct: number | null | undefined; text: ReactNode; icon?: ReactNode }) {
  const has = pct !== null && pct !== undefined && isFinite(pct);
  const tone: Tone = !has ? 'muted' : pct! >= 90 ? 'danger' : pct! >= 75 ? 'warning' : 'info';
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
          {icon}
          {label}
        </span>
        <span className={cn('inline-flex min-w-0 items-center gap-1 truncate tabular', has && pct! >= 90 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-fg')}>
          {has && pct! >= 90 && <AlertTriangle className="size-3" />}
          {text}
        </span>
      </div>
      <Progress value={has ? pct! : 0} tone={tone} size="sm" />
    </div>
  );
}

// ───────────── Khoảng ngày ─────────────
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
}

/** Thanh chọn khoảng ngày: nút nhanh + 2 ô ngày, giới hạn số ngày tối đa */
export function DateRangeBar({ from, to, onChange, presets = [1, 7, 30, 90], maxDays = 90, allowEmpty = false }: { from: string; to: string; onChange: (from: string, to: string) => void; presets?: number[]; maxDays?: number; allowEmpty?: boolean }) {
  const today = todayVn();
  const active = to === today ? presets.find((n) => from === addDaysStr(today, -(n - 1))) : undefined;
  const set = (f: string, t: string) => {
    if (!f || !t) {
      if (allowEmpty) onChange(f, t);
      return;
    }
    let a = f;
    let b = t;
    if (a > b) [a, b] = [b, a];
    if (daysInclusive(a, b) > maxDays) a = addDaysStr(b, -(maxDays - 1));
    onChange(a, b);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<string>
        value={active ? String(active) : ''}
        onChange={(v) => set(addDaysStr(today, -(Number(v) - 1)), today)}
        options={presets.map((n) => ({ value: String(n), label: n === 1 ? 'Hôm nay' : `${n} ngày` }))}
      />
      <div className="flex w-full items-center gap-1.5 sm:w-auto">
        <Input type="date" className="min-w-0 flex-1 sm:w-36 sm:flex-none" value={from} max={today} onChange={(e) => set(e.target.value, to)} aria-label="Từ ngày" />
        <span className="text-xs text-muted">→</span>
        <Input type="date" className="min-w-0 flex-1 sm:w-36 sm:flex-none" value={to} max={today} onChange={(e) => set(from, e.target.value)} aria-label="Đến ngày" />
      </div>
    </div>
  );
}

// ───────────── Danh sách toàn bộ shop (cho gắn / giao shop) ─────────────
export interface AdminShop {
  id: number;
  number: number;
  name: string;
  shopeeShopId: number;
  status: string;
  owner: { id: number; name: string; username: string } | null;
}

/** Lấy mọi shop nhìn thấy được, gồm cả shop đã ngưng (để không vô tình gỡ khi lưu) */
export function useAllShops(enabled = true) {
  return useQuery({
    queryKey: ['shops', 'admin-all'],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const out: AdminShop[] = [];
      for (const tab of ['all', 'suspended']) {
        for (let page = 1; page < 100; page++) {
          const r = await api.get<{ items: AdminShop[]; total: number }>('/api/shops', { tab, sort: 'number', page, pageSize: 500 });
          out.push(...r.items.map((s) => ({ id: s.id, number: s.number, name: s.name, shopeeShopId: s.shopeeShopId, status: s.status, owner: s.owner ?? null })));
          if (page * 500 >= r.total) break;
        }
      }
      return out.sort((a, b) => a.number - b.number);
    },
  });
}

/** "2 giây", "5 phút", "1 giờ" */
export function fmtEvery(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)} giây`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} phút`;
  return `${Math.round(ms / 3600000)} giờ`;
}

export function addMonthsStr(date: string, months: number): string {
  const d = new Date(date + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export const GB = 1024 ** 3;
