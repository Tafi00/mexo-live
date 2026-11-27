import { useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useClickOutside } from '@/lib/hooks';

// ───────────── Card ─────────────
export function Card({ className, children, padded = false }: { className?: string; children: ReactNode; padded?: boolean }) {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-card', padded && 'p-4', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className, icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-2.5', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-muted">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────── Badge ─────────────
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'muted';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg ring-line-strong',
  muted: 'bg-surface-2 text-muted ring-line',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
  info: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900',
};
const dotTones: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  muted: 'bg-slate-300 dark:bg-slate-600',
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-sky-500',
  violet: 'bg-violet-500',
};

export function Badge({ tone = 'neutral', children, dot, pulse, className, size = 'md', icon }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string; size?: 'sm' | 'md'; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset', size === 'sm' ? 'px-1.5 py-px text-2xs' : 'px-2 py-0.5 text-xs', tones[tone], className)}>
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', dotTones[tone], pulse && 'animate-pulse-dot')} />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Dot({ tone = 'neutral', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', dotTones[tone], pulse && 'animate-pulse-dot', className)} />;
}

// ───────────── Trạng thái trống / tải ─────────────
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} />;
}

export function PageLoading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-muted">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className, compact }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      {Icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-xl bg-surface-2 text-muted ring-1 ring-line">
          <Icon className="size-5" />
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={AlertCircle}
      title="Không tải được dữ liệu"
      description={error instanceof Error ? error.message : String(error)}
      action={
        onRetry && (
          <button onClick={onRetry} className="text-sm font-medium text-brand-600 hover:underline">
            Thử lại
          </button>
        )
      }
    />
  );
}

// ───────────── Callout ─────────────
export function Callout({ tone = 'info', title, children, className, icon, action }: { tone?: 'info' | 'warning' | 'danger' | 'success' | 'neutral'; title?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode; action?: ReactNode }) {
  const map = {
    info: ['border-sky-200 bg-sky-50/70 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200', <Info key="i" className="size-4" />],
    warning: ['border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200', <AlertTriangle key="w" className="size-4" />],
    danger: ['border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200', <AlertCircle key="d" className="size-4" />],
    success: ['border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200', <CheckCircle2 key="s" className="size-4" />],
    neutral: ['border-line bg-surface-2 text-fg', <Info key="n" className="size-4" />],
  } as const;
  const [cls, ic] = map[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm', cls, className)}>
      <span className="mt-px shrink-0">{icon ?? ic}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('leading-relaxed', title && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ───────────── Tiêu đề trang ─────────────
export function PageHeader({ title, description, actions, breadcrumb, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:items-center', className)}>
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5 text-xs text-muted">{breadcrumb}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────── Ô số liệu ─────────────
export function StatCard({ label, value, hint, icon, tone = 'neutral', onClick, active, trend, footer }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; onClick?: () => void; active?: boolean; trend?: ReactNode; footer?: ReactNode }) {
  const iconTone: Record<Tone, string> = {
    neutral: 'bg-surface-2 text-muted',
    muted: 'bg-surface-2 text-muted',
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
    warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
    danger: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    info: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn('flex min-w-0 items-start gap-3 rounded-xl border bg-surface px-3.5 py-3 text-left shadow-card transition-colors', active ? 'border-brand-400 ring-1 ring-brand-400' : 'border-line', onClick && 'hover:border-line-strong')}
    >
      {icon && <div className={cn('hidden size-9 shrink-0 place-items-center rounded-lg sm:grid', iconTone[tone])}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-xs font-medium text-muted" title={typeof label === 'string' ? label : undefined}>{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-tight tracking-tight tabular">{value}</p>
        {(hint || trend) && (
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
            {trend}
            {hint}
          </p>
        )}
        {footer && <div className="mt-1.5">{footer}</div>}
      </div>
    </Comp>
  );
}

// ───────────── Tabs (gạch chân) ─────────────
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number | null; icon?: ReactNode; tone?: Tone }[]; className?: string }) {
  return (
    <div className={cn('scrollbar-none -mb-px flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-2 text-sm font-medium transition-colors',
            value === it.value ? 'text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-500' : 'text-muted hover:text-fg',
          )}
        >
          {it.icon}
          {it.label}
          {it.count !== undefined && it.count !== null && (
            <span className={cn('rounded-full px-1.5 text-2xs tabular', it.tone && it.count > 0 ? tones[it.tone] + ' ring-1 ring-inset' : 'bg-surface-2 text-muted')}>{it.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ───────────── Phân trang ─────────────
export function Pagination({ page, pageSize, total, onChange, className }: { page: number; pageSize: number; total: number; onChange: (p: number) => void; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className={cn('px-1 text-xs text-muted', className)}>{total} kết quả</p> : null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn('flex items-center justify-between gap-3 text-xs text-muted', className)}>
      <span className="tabular">
        {from}–{to} / {total.toLocaleString('vi-VN')}
      </span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="grid size-7 place-items-center rounded-md border border-line hover:bg-surface-2 disabled:opacity-40" aria-label="Trang trước">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 tabular">
          Trang {page}/{pages}
        </span>
        <button disabled={page >= pages} onClick={() => onChange(page + 1)} className="grid size-7 place-items-center rounded-md border border-line hover:bg-surface-2 disabled:opacity-40" aria-label="Trang sau">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ───────────── Menu thả xuống ─────────────
export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  divider?: boolean;
  hidden?: boolean;
}

export function Menu({ trigger, items, align = 'right', width = 'w-56' }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; width?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const visible = items.filter((i) => !i.hidden);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cn('absolute z-40 mt-1.5 animate-slide-up rounded-lg border border-line bg-surface p-1 shadow-pop', width, align === 'right' ? 'right-0' : 'left-0')}>
          {visible.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick?.();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  it.danger ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40' : 'text-fg hover:bg-surface-2',
                )}
              >
                {it.icon && <span className="shrink-0 text-muted [&>svg]:size-4">{it.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-2xs text-subtle">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ───────────── Thanh tiến độ ─────────────
export function Progress({ value, max = 100, tone = 'brand', className, size = 'md' }: { value: number; max?: number; tone?: Tone; className?: string; size?: 'sm' | 'md' }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-surface-3', size === 'sm' ? 'h-1' : 'h-1.5', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', dotTones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ───────────── Cặp nhãn – giá trị ─────────────
export function KV({ items, className, cols = 2 }: { items: { label: ReactNode; value: ReactNode; hidden?: boolean }[]; className?: string; cols?: 1 | 2 | 3 | 4 }) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }[cols];
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', grid, className)}>
      {items
        .filter((i) => !i.hidden)
        .map((it, i) => (
          <div key={i} className="min-w-0">
            <dt className="text-xs text-muted">{it.label}</dt>
            <dd className="mt-0.5 break-words text-sm font-medium">{it.value}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-2xs font-semibold text-white', className)} style={{ background: `hsl(${hue} 55% 50%)` }}>
      {initials || '?'}
    </span>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          // Ẩn hẳn (display:none) khi không rê chuột để không chiếm chỗ ngoài mép màn hình (gây cuộn ngang trên điện thoại)
          'pointer-events-none absolute left-1/2 z-50 hidden w-max max-w-xs -translate-x-1/2 animate-fade-in rounded-md bg-slate-900 px-2 py-1 text-2xs leading-snug text-white shadow-lg group-hover/tt:block dark:bg-slate-700',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {content}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-px font-mono text-2xs text-muted">{children}</kbd>;
}
