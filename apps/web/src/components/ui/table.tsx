import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Bảng dữ liệu: header dính, hàng gọn, cuộn ngang trên màn nhỏ */
export function Table({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-0 text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="sticky top-0 z-10">{children}</thead>;
}

export function Th({ className, children, sort, onSort, align, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { sort?: 'asc' | 'desc' | null; onSort?: () => void; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-line bg-surface-2/80 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted backdrop-blur first:pl-4 last:pr-4',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        onSort && 'cursor-pointer select-none hover:text-fg',
        className,
      )}
      onClick={onSort}
      {...rest}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sort === 'asc' && <ArrowUp className="size-3" />}
        {sort === 'desc' && <ArrowDown className="size-3" />}
      </span>
    </th>
  );
}

export function Tr({ className, selected, onClick, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return <tr className={cn('group transition-colors', onClick && 'cursor-pointer', selected ? 'bg-brand-50/60 dark:bg-brand-950/20' : 'hover:bg-surface-2/60', className)} onClick={onClick} {...rest} />;
}

export function Td({ className, align, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return <td className={cn('border-b border-line px-3 py-2.5 align-middle first:pl-4 last:pr-4', align === 'right' && 'text-right', align === 'center' && 'text-center', className)} {...rest} />;
}
