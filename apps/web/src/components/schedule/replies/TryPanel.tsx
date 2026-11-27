import { useState } from 'react';
import { Bot, FlaskConical, Hand, MessageCircleOff, ScrollText, Send, ShieldAlert, Timer } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Badge, Card, CardHeader, type Tone } from '@/components/ui/misc';
import { useReplyRules } from './RulesCard';
import { fmtLatency, type TryResult } from './types';

const STATUS: Record<TryResult['status'], { label: string; tone: Tone; icon: typeof Send; text: string }> = {
  reply: { label: 'Sẽ trả lời', tone: 'success', icon: Send, text: 'Câu trả lời này sẽ được đăng vào phiên live.' },
  skip: { label: 'Không trả lời', tone: 'muted', icon: MessageCircleOff, text: 'Bình luận này sẽ được bỏ qua.' },
  blocked: { label: 'Bị lớp lọc chặn', tone: 'danger', icon: ShieldAlert, text: 'Câu trả lời vi phạm lớp lọc nên sẽ không được đăng.' },
  handoff: { label: 'Chuyển nhân viên', tone: 'warning', icon: Hand, text: 'AI đánh giá câu này cần nhân viên trả lời trực tiếp.' },
};

const SAMPLES = ['Shop ơi áo này bảo hành bao lâu?', 'Bao lâu thì nhận được hàng vậy?', 'Mình cao 1m6 nặng 50kg mặc size gì?', 'Có màu đen không shop'];

/** Thử một câu hỏi — dùng cài đặt đang sửa (chưa lưu), không gửi gì lên Shopee */
export function TryPanel({ shopId, unmatched, context, dirty }: { shopId: number; unmatched: 'none' | 'ai'; context: string; dirty: boolean }) {
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<(TryResult & { comment: string }) | null>(null);
  const rules = useReplyRules(shopId);
  const run = useAction((c: string) => api.post<TryResult>(`/api/shops/${shopId}/replies/try`, { comment: c, unmatched, context }), {
    onSuccess: (r, c) => setResult({ ...r, comment: c }),
  });
  const go = (c = comment) => {
    const t = c.trim();
    if (!t) return;
    setComment(t);
    run.mutate(t);
  };
  const rule = result?.ruleId ? rules.data?.items.find((r) => r.id === result.ruleId) : null;
  const st = result ? STATUS[result.status] : null;

  return (
    <Card>
      <CardHeader title="Thử một câu hỏi" icon={<FlaskConical className="size-4" />} description="Xem hệ thống sẽ trả lời thế nào. Không gửi gì lên Shopee." />
      <div className="space-y-3 p-4">
        <Textarea
          rows={2}
          className="min-h-[64px]"
          maxLength={300}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              go();
            }
          }}
          placeholder="Nhập bình luận như người xem, ví dụ: shop ơi bao lâu nhận hàng?"
        />
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button key={s} type="button" onClick={() => go(s)} className="rounded-full border border-line px-2 py-0.5 text-2xs text-muted hover:border-line-strong hover:text-fg">
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-subtle">
            {unmatched === 'ai' ? 'Câu không khớp: AI trả lời' : 'Câu không khớp: không trả lời'}
            {dirty && ' · theo cài đặt chưa lưu'}
          </p>
          <Button size="sm" variant="primary" icon={<FlaskConical className="size-3.5" />} loading={run.isPending} disabled={!comment.trim()} onClick={() => go()}>
            Thử
          </Button>
        </div>

        {result && st && (
          <div className="space-y-2.5 rounded-lg border border-line bg-surface-2/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={st.tone} icon={<st.icon className="size-3" />}>
                {st.label}
              </Badge>
              {result.source === 'rule' && (
                <Badge tone="info" size="sm" icon={<ScrollText className="size-3" />}>
                  Kịch bản{rule ? `: ${rule.topic}` : ''}
                </Badge>
              )}
              {result.source === 'ai' && (
                <Badge tone="violet" size="sm" icon={<Bot className="size-3" />}>
                  AI
                </Badge>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-2xs tabular text-muted">
                <Timer className="size-3" />
                {fmtLatency(result.latencyMs)}
              </span>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-start">
                <p className="max-w-[90%] rounded-2xl rounded-bl-sm bg-surface px-3 py-1.5 ring-1 ring-line">
                  <span className="block text-2xs font-medium uppercase tracking-wide text-subtle">Người xem</span>
                  {result.comment}
                </p>
              </div>
              {result.answer && (
                <div className="flex justify-end">
                  <p
                    className={cn(
                      'max-w-[90%] rounded-2xl rounded-br-sm px-3 py-1.5',
                      result.status === 'blocked' ? 'bg-rose-50 text-rose-900 line-through decoration-rose-400/70 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900' : 'bg-brand-500 text-white',
                    )}
                  >
                    <span className={cn('block text-2xs font-medium uppercase tracking-wide', result.status === 'blocked' ? 'text-rose-500 no-underline' : 'text-white/75')}>Shop</span>
                    {result.answer}
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted">
              {st.text}
              {result.reason && <span className="block font-medium text-fg">Lý do: {result.reason}</span>}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
