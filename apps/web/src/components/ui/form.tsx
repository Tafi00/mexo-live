import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-lg border border-line-strong bg-surface text-fg placeholder:text-subtle shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-[border,box-shadow] focus:border-brand-400 focus:outline-none focus:ring-3 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode; trailing?: ReactNode; inputSize?: 'sm' | 'md' }>(
  function Input({ className, invalid, leading, trailing, inputSize = 'md', ...rest }, ref) {
    const h = inputSize === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm';
    if (leading || trailing)
      return (
        <div className={cn('relative flex items-center', className)}>
          {leading && <span className="pointer-events-none absolute left-2.5 text-subtle">{leading}</span>}
          <input ref={ref} className={cn(fieldBase, h, 'px-3', leading && 'pl-8', trailing && 'pr-9', invalid && 'border-rose-400 focus:border-rose-400')} {...rest} />
          {trailing && <span className="absolute right-2 text-subtle">{trailing}</span>}
        </div>
      );
    return <input ref={ref} className={cn(fieldBase, h, 'px-3', invalid && 'border-rose-400 focus:border-rose-400', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-[80px] px-3 py-2 text-sm leading-relaxed', invalid && 'border-rose-400', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { inputSize?: 'sm' | 'md' }>(function Select({ className, children, inputSize = 'md', ...rest }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(fieldBase, inputSize === 'sm' ? 'h-8 text-[13px]' : 'h-9 text-sm', 'appearance-none pl-3 pr-8')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
    </div>
  );
});

export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm…', className, autoFocus, inputSize = 'md' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; inputSize?: 'sm' | 'md' }) {
  return (
    <Input
      className={className}
      inputSize={inputSize}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      leading={<Search className="size-4" />}
      trailing={
        value ? (
          <button type="button" className="rounded p-0.5 hover:bg-surface-2 hover:text-fg" onClick={() => onChange('')} aria-label="Xóa tìm kiếm">
            <X className="size-3.5" />
          </button>
        ) : undefined
      }
    />
  );
}

export function Field({ label, hint, error, required, children, className, htmlFor, aside }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string; aside?: ReactNode }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
            {label}
            {required && <span className="ml-0.5 text-rose-500">*</span>}
          </label>
          {aside}
        </div>
      )}
      {children}
      {error ? <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, description, disabled, indeterminate, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean; indeterminate?: boolean; className?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('inline-flex cursor-pointer items-start gap-2.5', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand-500"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-fg">{label}</span>}
          {description && <span className="block text-xs text-muted">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, size = 'md', label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md'; label?: ReactNode }) {
  const btn = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
        checked ? 'bg-brand-500' : 'bg-surface-3 ring-1 ring-inset ring-line-strong',
      )}
    >
      <span className={cn('inline-block rounded-full bg-white shadow transition-transform', size === 'sm' ? 'size-4' : 'size-5', checked ? (size === 'sm' ? 'translate-x-[18px]' : 'translate-x-[22px]') : 'translate-x-0.5')} />
    </button>
  );
  if (!label) return btn;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm">
      {btn}
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-inset ring-line', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-fg shadow-card ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn('rounded px-1 text-[11px] tabular', value === o.value ? 'bg-surface-2 text-fg' : 'text-subtle')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function RadioCards<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; description?: ReactNode; icon?: ReactNode; disabled?: boolean }[]; className?: string }) {
  return (
    <div className={cn('grid gap-2', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === o.value ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-400 dark:bg-brand-950/20' : 'border-line hover:border-line-strong hover:bg-surface-2',
          )}
        >
          <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', value === o.value ? 'border-brand-500' : 'border-line-strong')}>
            {value === o.value && <span className="size-2 rounded-full bg-brand-500" />}
          </span>
          {o.icon}
          <span className="min-w-0">
            <span className="block text-sm font-medium">{o.label}</span>
            {o.description && <span className="mt-0.5 block text-xs text-muted">{o.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
