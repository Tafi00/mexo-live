import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import type { MenuItem } from '@/components/ui/misc';

/**
 * Menu thả xuống hiển thị qua portal (không bị cắt bởi vùng cuộn của bảng),
 * tự lật lên trên khi gần đáy màn hình. API giống Menu trong ui/misc.
 */
export function PortalMenu({ trigger, items, width = 240 }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; items: MenuItem[]; width?: number }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const h = panel.current?.offsetHeight ?? 0;
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(below, Math.max(8, window.innerHeight - h - 8));
      const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={anchor} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
            className="fixed z-50 animate-fade-in rounded-lg border border-line bg-surface p-1 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            {visible.map((it, i) =>
              it.divider ? (
                <div key={i} className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onClick?.();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    it.danger ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40' : 'text-fg hover:bg-surface-2',
                  )}
                >
                  {it.icon && <span className={cn('shrink-0 [&>svg]:size-4', it.danger ? '' : 'text-muted')}>{it.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[11px] text-subtle">{it.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
