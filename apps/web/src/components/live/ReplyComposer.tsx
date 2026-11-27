import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, CornerDownRight, MessageSquareText, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { foldVi } from '@mexo/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useClickOutside } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { SearchInput, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';

const MAX = 300;
const CHIP_COUNT = 4;

export interface ReplyTarget {
  id: number;
  username: string | null;
  content: string;
}

interface QuickRule {
  id: number;
  topic: string;
  answer: string;
  enabled: boolean;
  hits?: number;
}

/** Kịch bản trả lời đang bật của shop — dùng làm "câu trả lời mẫu" */
function useQuickReplies(shopId: number | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['quick-replies', shopId],
    queryFn: async () => {
      const r = await api.get<{ items: QuickRule[] }>(`/api/shops/${shopId}/reply-rules`);
      return r.items.filter((x) => x.enabled && x.answer.trim()).sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0));
    },
    enabled: Boolean(shopId) && enabled,
    staleTime: 60_000,
  });
}

function QuickReplyMenu({ rules, onPick }: { rules: QuickRule[]; onPick: (r: QuickRule) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const list = useMemo(() => {
    const f = foldVi(q);
    return f ? rules.filter((r) => foldVi(r.topic).includes(f) || foldVi(r.answer).includes(f)) : rules;
  }, [rules, q]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 text-2xs font-medium text-muted transition-colors hover:border-line-strong hover:text-fg', open && 'border-line-strong text-fg')}
      >
        Tất cả ({rules.length})
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1.5 w-[min(22rem,calc(100vw-3rem))] animate-slide-up rounded-lg border border-line bg-surface p-1.5 shadow-pop">
          {rules.length > 6 && <SearchInput value={q} onChange={setQ} inputSize="sm" placeholder="Tìm câu trả lời mẫu…" autoFocus className="mb-1.5" />}
          <ul className="max-h-64 overflow-y-auto">
            {list.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r);
                    setOpen(false);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className="block text-xs font-medium">{r.topic}</span>
                  <span className="line-clamp-2 text-2xs text-muted">{r.answer}</span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 py-3 text-center text-xs text-muted">Không có câu trả lời phù hợp</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Ô trả lời bình luận (thủ công). Nội dung vẫn qua lớp lọc của hệ thống:
 * - 409 content_warning → cảnh báo, cho phép "Vẫn gửi" (force)
 * - content_blocked → chặn cứng, phải sửa nội dung
 * Có "câu trả lời mẫu" lấy từ kịch bản đang bật của shop; trả lời 1 bình luận thì tự điền "@tên ".
 */
export function ReplyComposer({
  sessionId,
  shopId,
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
  shopId?: number;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefixRef = useRef('');
  const quick = useQuickReplies(shopId, !disabled);
  const rules = quick.data ?? [];

  function focusEnd() {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  // Trả lời 1 bình luận → điền sẵn "@tên " để người xem biết câu trả lời dành cho mình
  useEffect(() => {
    const next = target?.username ? `@${target.username.trim()} ` : '';
    const prev = prefixRef.current;
    prefixRef.current = next;
    setText((t) => {
      const rest = prev && t.startsWith(prev) ? t.slice(prev.length) : t;
      return (next + rest).slice(0, MAX);
    });
    if (target && (autoFocus || prev !== next)) focusEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  function insertAnswer(answer: string) {
    setWarning(null);
    setBlocked(null);
    setText((t) => {
      const prefix = prefixRef.current;
      const body = prefix && t.startsWith(prefix) ? t.slice(prefix.length) : t;
      const merged = body.trim() ? `${body.trimEnd()} ${answer}` : answer;
      return (prefix + merged).slice(0, MAX);
    });
    focusEnd();
  }

  async function send(force = false) {
    const t = text.trim();
    if (!t || t === prefixRef.current.trim() || sending) return;
    setSending(true);
    try {
      await api.post(`/api/sessions/${sessionId}/comments`, { text: t, force, ...(target ? { commentId: target.id } : {}) });
      toast.success(target ? 'Đã trả lời bình luận' : 'Đã gửi bình luận');
      setText(prefixRef.current && !onSent ? prefixRef.current : '');
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
    return <div className={cn('rounded-lg border border-dashed border-line-strong bg-surface-2/60 px-3 py-2 text-xs text-muted', className)}>{disabledReason ?? 'Không gửi được bình luận lúc này.'}</div>;

  const empty = !text.trim() || text.trim() === prefixRef.current.trim();

  return (
    <div className={cn('space-y-2', className)}>
      {target && (
        <div className="flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">
          <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-subtle" />
          <p className="min-w-0 flex-1 text-muted">
            Trả lời <b className="font-semibold text-fg">{target.username || 'người xem'}</b>: <span className="line-clamp-2 inline">“{target.content}”</span>
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
            ref={inputRef}
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
            className="min-h-[56px] resize-none py-1.5 pr-14"
          />
          <span className={cn('pointer-events-none absolute bottom-1.5 right-2.5 text-2xs tabular', text.length > MAX - 20 ? 'text-amber-600 dark:text-amber-400' : 'text-subtle')}>
            {text.length}/{MAX}
          </span>
        </div>
        <Button variant="primary" icon={<Send className="size-4" />} loading={sending && !warning} disabled={empty} onClick={() => void send(false)}>
          Gửi
        </Button>
      </div>
      {rules.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-muted" title="Câu trả lời mẫu từ kịch bản đang bật của shop">
            <MessageSquareText className="size-3.5" />
            Mẫu:
          </span>
          <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {rules.slice(0, CHIP_COUNT).map((r) => (
              <button
                key={r.id}
                type="button"
                title={r.answer}
                onClick={() => insertAnswer(r.answer)}
                className="inline-flex h-6 max-w-[11rem] shrink-0 items-center rounded-md bg-surface-2 px-2 text-2xs font-medium text-fg ring-1 ring-inset ring-line transition-colors hover:bg-surface-3"
              >
                <span className="truncate">{r.topic}</span>
              </button>
            ))}
          </div>
          {rules.length > CHIP_COUNT && <QuickReplyMenu rules={rules} onPick={(r) => insertAnswer(r.answer)} />}
        </div>
      )}
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
