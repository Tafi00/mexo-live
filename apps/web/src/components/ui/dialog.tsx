import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Field, Input, Textarea } from './form';

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' };

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof widths;
  className?: string;
  dismissable?: boolean;
}) {
  const close = useCallback(() => dismissable && onClose(), [dismissable, onClose]);
  useEscape(open, close);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      <div className="fixed inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-[2px]" onClick={close} />
      <div role="dialog" aria-modal="true" className={cn('relative my-auto flex max-h-[calc(100vh-2rem)] w-full animate-slide-up flex-col rounded-xl border border-line bg-surface shadow-pop', widths[size], className)}>
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>}
              {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
            </div>
            {dismissable && (
              <button onClick={onClose} className="-mr-1 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Đóng">
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Sheet({ open, onClose, title, description, children, footer, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: string }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 animate-fade-in bg-slate-950/40" onClick={onClose} />
      <div className={cn('fixed inset-y-0 right-0 flex w-full animate-slide-left flex-col border-l border-line bg-surface shadow-pop', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="-mr-1 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Đóng">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ───────────── Hộp xác nhận (Promise) ─────────────

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** Bắt nhập đúng chuỗi này mới cho xác nhận (thao tác nguy hiểm) */
  requireText?: string;
  /** Yêu cầu nhập lý do / ghi chú */
  input?: { label: string; placeholder?: string; required?: boolean; multiline?: boolean; defaultValue?: string; type?: string };
}

type ConfirmFn = (o: ConfirmOptions) => Promise<{ ok: boolean; value: string }>;
const ConfirmCtx = createContext<ConfirmFn>(async () => ({ ok: false, value: '' }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (r: { ok: boolean; value: string }) => void }) | null>(null);
  const [text, setText] = useState('');
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        setText('');
        setValue(o.input?.defaultValue ?? '');
        setState({ ...o, resolve });
      }),
    [],
  );
  const close = (ok: boolean) => {
    state?.resolve({ ok, value });
    setState(null);
  };
  const blocked = Boolean((state?.requireText && text.trim() !== state.requireText) || (state?.input?.required && !value.trim()));
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(state)}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              {state?.cancelText ?? 'Hủy'}
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)}>
              {state?.confirmText ?? 'Xác nhận'}
            </Button>
          </>
        }
      >
        {state && (
          <div className="flex gap-3.5">
            {state.danger && (
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <AlertTriangle className="size-[18px]" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h3 className="text-[15px] font-semibold">{state.title}</h3>
                {state.description && <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{state.description}</div>}
              </div>
              {state.input && (
                <Field label={state.input.label} required={state.input.required}>
                  {state.input.multiline ? (
                    <Textarea ref={inputRef} autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={state.input.placeholder} />
                  ) : (
                    <Input ref={inputRef} autoFocus type={state.input.type ?? 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={state.input.placeholder} />
                  )}
                </Field>
              )}
              {state.requireText && (
                <Field label={<span>Gõ <b className="font-mono">{state.requireText}</b> để xác nhận</span>}>
                  <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}
