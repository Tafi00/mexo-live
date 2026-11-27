import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { foldVi, LIMITS } from '@mexo/shared';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Switch, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { KeywordInput } from './KeywordInput';
import type { ReplyRule } from './types';

interface RuleForm {
  topic: string;
  keywords: string[];
  sample: string;
  answer: string;
  enabled: boolean;
}

const empty: RuleForm = { topic: '', keywords: [], sample: '', answer: '', enabled: true };

export function RuleDialog({ open, onClose, shopId, rule }: { open: boolean; onClose: () => void; shopId: number; rule: ReplyRule | null }) {
  const [f, setF] = useState<RuleForm>(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof RuleForm, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setF(rule ? { topic: rule.topic, keywords: rule.keywords, sample: rule.sample ?? '', answer: rule.answer, enabled: rule.enabled } : empty);
    setErrors({});
    setApiError(null);
  }, [open, rule]);

  const save = useAction(
    () => {
      const body = { topic: f.topic.trim(), keywords: f.keywords, sample: f.sample.trim(), answer: f.answer.trim(), enabled: f.enabled };
      return rule ? api.put(`/api/shops/${shopId}/reply-rules/${rule.id}`, body) : api.post(`/api/shops/${shopId}/reply-rules`, body);
    },
    {
      silentError: true,
      success: rule ? 'Đã lưu kịch bản' : 'Đã thêm kịch bản',
      invalidate: [['shop', shopId, 'reply-rules'], ['shop', shopId, 'replies']],
      onError: (e) => setApiError(errorMessage(e)),
      onSuccess: () => onClose(),
    },
  );

  function submit() {
    const e: typeof errors = {};
    if (!f.topic.trim()) e.topic = 'Cần nhập chủ đề';
    if (!f.keywords.length) e.keywords = 'Cần ít nhất 1 từ khóa';
    if (!f.answer.trim()) e.answer = 'Cần nhập câu trả lời';
    setErrors(e);
    setApiError(null);
    if (Object.keys(e).length) return;
    save.mutate();
  }

  const sampleKw = f.keywords.find((k) => foldVi(k) !== k.toLowerCase());
  const over = f.answer.length > LIMITS.ruleAnswerMax;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={rule ? 'Sửa kịch bản trả lời' : 'Thêm kịch bản trả lời'}
      description="Bình luận chứa từ khóa sẽ được trả lời bằng câu trả lời bên dưới. Khớp nhiều từ khóa nhất sẽ thắng."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={over} onClick={submit}>
            {rule ? 'Lưu kịch bản' : 'Thêm kịch bản'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {rule?.disabledReason && (
          <Callout tone="warning" title="Kịch bản đã bị tự tắt">
            Vi phạm lớp lọc: {rule.disabledReason}. Sửa câu trả lời rồi lưu để bật lại.
          </Callout>
        )}
        <Field label="Chủ đề" required error={errors.topic} hint="Tên gọi nội bộ, ví dụ: Bảo hành, Size, Giao hàng. Nhập file trùng chủ đề sẽ cập nhật kịch bản này.">
          <Input value={f.topic} maxLength={80} invalid={Boolean(errors.topic)} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="Ví dụ: Bảo hành" />
        </Field>
        <Field
          label="Từ khóa"
          required
          error={errors.keywords}
          aside={<span className="text-2xs tabular text-subtle">{f.keywords.length}/{LIMITS.ruleKeywordsMax}</span>}
          hint={
            sampleKw ? (
              <>
                Khớp cả có dấu và không dấu: “{sampleKw}” cũng khớp “{foldVi(sampleKw)}”.
              </>
            ) : (
              'Khớp cả có dấu và không dấu, không phân biệt hoa thường. Nhấn Enter hoặc dấu phẩy để thêm.'
            )
          }
        >
          <KeywordInput value={f.keywords} onChange={(k) => setF({ ...f, keywords: k })} invalid={Boolean(errors.keywords)} />
        </Field>
        <Field label="Câu hỏi mẫu" hint="Giúp đồng nghiệp hiểu kịch bản này dành cho câu hỏi nào (không bắt buộc)">
          <Input value={f.sample} maxLength={300} onChange={(e) => setF({ ...f, sample: e.target.value })} placeholder="Ví dụ: Sản phẩm này bảo hành bao lâu vậy shop?" />
        </Field>
        <Field
          label="Câu trả lời"
          required
          error={errors.answer ?? (over ? `Tối đa ${LIMITS.ruleAnswerMax} ký tự` : undefined)}
          aside={<span className={cn('text-2xs tabular', over ? 'font-semibold text-rose-600' : f.answer.length > LIMITS.ruleAnswerMax * 0.9 ? 'text-amber-600' : 'text-subtle')}>{f.answer.length}/{LIMITS.ruleAnswerMax}</span>}
          hint="Không chứa link, số điện thoại, kênh liên hệ ngoài Shopee, giá tiền hoặc tên sàn khác — sẽ bị lớp lọc chặn."
        >
          <Textarea rows={4} value={f.answer} invalid={Boolean(errors.answer) || over} onChange={(e) => setF({ ...f, answer: e.target.value })} placeholder="Dạ sản phẩm được bảo hành 12 tháng, lỗi do nhà sản xuất shop đổi mới trong 7 ngày ạ." />
        </Field>
        <Switch checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={f.enabled ? 'Đang bật — dùng để trả lời tự động' : 'Đang tắt — chưa dùng để trả lời'} />
        {apiError && (
          <Callout tone="danger" title="Không lưu được kịch bản">
            {apiError}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
