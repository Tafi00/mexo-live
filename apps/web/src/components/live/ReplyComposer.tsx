import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CornerDownRight, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';

const MAX = 300;

export interface ReplyTarget {
  id: number;
  username: string | null;
  content: string;
}

/**
 * Ô trả lời bình luận (thủ công). Nội dung vẫn qua lớp lọc của hệ thống:
 * - 409 content_warning → cảnh báo, cho phép "Vẫn gửi" (force)
 * - content_blocked → chặn cứng, phải sửa nội dung
 */
export function ReplyComposer({
  sessionId,
  target,
  onClearTarget,
  disabled,
  disabledReason,
  onSent,
  autoFocus,
  className,
  placeholder,
}: {
  sessionId: number;
  target?: ReplyTarget | null;
  onClearTarget?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  onSent?: () => void;
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send(force = false) {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await api.post(`/api/sessions/${sessionId}/comments`, { text: t, force, ...(target ? { commentId: target.id } : {}) });
      toast.success(target ? 'Đã trả lời bình luận' : 'Đã gửi bình luận');
      setText('');
      setWarning(null);
      setBlocked(null);
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'comments'] });
      void qc.invalidateQueries({ queryKey: ['comments'] });
      onSent?.();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'content_warning') {
        setWarning(e.message);
        setBlocked(null);
      } else if (e instanceof ApiError && e.code === 'content_blocked') {
        setBlocked(e.message);
        setWarning(null);
      } else toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  if (disabled)
    return <div className={cn('rounded-lg border border-dashed border-line-strong bg-surface-2/60 px-3 py-2.5 text-xs text-muted', className)}>{disabledReason ?? 'Không gửi được bình luận lúc này.'}</div>;

  return (
    <div className={cn('space-y-2', className)}>
      {target && (
        <div className="flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
          <CornerDownRight className="mt-px size-3.5 shrink-0 text-subtle" />
          <p className="min-w-0 flex-1 text-muted">
            Trả lời <b className="font-semibold text-fg">{target.username || 'người xem'}</b>: <span className="line-clamp-1 inline">“{target.content}”</span>
          </p>
          {onClearTarget && (
            <button type="button" onClick={onClearTarget} className="rounded p-0.5 text-subtle hover:bg-surface-3 hover:text-fg" aria-label="Bỏ chọn bình luận">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="relative min-w-0 flex-1">
          <Textarea
            rows={2}
            autoFocus={autoFocus}
            value={text}
            maxLength={MAX}
            invalid={Boolean(blocked)}
            onChange={(e) => {
              setText(e.target.value);
              setWarning(null);
              setBlocked(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(false);
              }
            }}
            placeholder={placeholder ?? (target ? 'Nhập câu trả lời… (Enter để gửi)' : 'Gửi bình luận từ shop… (Enter để gửi)')}
            className="min-h-[60px] resize-none pr-14"
          />
          <span className={cn('pointer-events-none absolute bottom-2 right-2.5 text-[11px] tabular', text.length > MAX - 20 ? 'text-amber-600 dark:text-amber-400' : 'text-subtle')}>
            {text.length}/{MAX}
          </span>
        </div>
        <Button variant="primary" icon={<Send className="size-4" />} loading={sending && !warning} disabled={!text.trim()} onClick={() => void send(false)}>
          Gửi
        </Button>
      </div>
      {warning && (
        <Callout
          tone="warning"
          title="Nội dung có thể vi phạm quy định"
          action={
            <div className="flex flex-col gap-1.5 sm:flex-row">
              <Button size="xs" variant="ghost" onClick={() => setWarning(null)}>
                Sửa lại
              </Button>
              <Button size="xs" variant="primary" loading={sending} onClick={() => void send(true)}>
                Vẫn gửi
              </Button>
            </div>
          }
        >
          {warning}
        </Callout>
      )}
      {blocked && (
        <Callout tone="danger" title="Không thể gửi nội dung này">
          {blocked} Hãy bỏ link, số điện thoại, thông tin liên hệ ngoài hoặc từ ngữ không phù hợp rồi gửi lại.
        </Callout>
      )}
    </div>
  );
}
