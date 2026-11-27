import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-outline' | 'success';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm shadow-brand-500/20 disabled:bg-brand-500/50',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 border border-line',
  outline: 'bg-surface text-fg border border-line-strong hover:bg-surface-2 shadow-card',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm shadow-rose-600/20',
  'danger-outline': 'bg-surface text-rose-600 border border-rose-200 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/20',
};
const sizes: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-base gap-2 rounded-lg',
};
const iconSizes: Record<Size, string> = { xs: 'h-6 w-6 rounded-md', sm: 'h-7 w-7 rounded-md', md: 'h-8 w-8 rounded-md', lg: 'h-10 w-10 rounded-lg' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', loading, icon, iconRight, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        iconOnly ? iconSizes[size] : sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {!iconOnly && children}
      {!loading && iconRight}
    </button>
  );
});

export function ButtonLink({ variant = 'outline', size = 'md', icon, className, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={cn('inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors', variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
