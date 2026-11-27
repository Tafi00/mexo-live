import { useEffect, useRef, useState } from 'react';
import { CalendarCheck2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/misc';
import { emptyScheduleForm, formToPayload, ScheduleFields, scheduleToForm, TemplateField, useShopTemplates, validateScheduleForm, type ScheduleErrors, type ScheduleFormValue, type ScheduleRow } from './ScheduleForm';
import { parseScheduleError, type ParsedError } from './utils';

const COVER_REQUIRED = 'Mẫu phát này chưa có ảnh bìa — cần tải ảnh bìa cho lịch.';

/** Tạo / sửa lịch phát của 1 shop: chọn mẫu phát + giờ là đủ, tiêu đề & ảnh bìa mặc định theo mẫu */
export function ScheduleDialog({ open, onClose, shopId, schedule, notice }: { open: boolean; onClose: () => void; shopId: number; schedule?: ScheduleRow | null; notice?: string | null }) {
  const [form, setForm] = useState<ScheduleFormValue>(emptyScheduleForm);
  const [seed, setSeed] = useState(0);
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [apiError, setApiError] = useState<ParsedError | null>(null);
  const editing = Boolean(schedule);
  const bodyRef = useRef<HTMLDivElement>(null);
  const templates = useShopTemplates(shopId, open);
  const template = templates.data?.items.find((t) => t.id === form.templateId) ?? null;

  useEffect(() => {
    if (!open) return;
    setForm(schedule ? scheduleToForm(schedule) : emptyScheduleForm());
    setSeed((s) => s + 1);
    setErrors({});
    setApiError(null);
  }, [open, schedule]);

  // Cuộn tới lỗi đầu tiên
  useEffect(() => {
    if (!apiError && !Object.keys(errors).length) return;
    const el = bodyRef.current?.querySelector('[data-err], p.text-rose-600');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [errors, apiError]);

  const save = useAction(
    async ({ activate }: { activate: boolean }) => {
      const payload = { ...formToPayload(form), templateId: form.templateId };
      if (schedule) {
        await api.put(`/api/schedules/${schedule.id}`, payload);
        if (activate) await api.post(`/api/schedules/${schedule.id}/resume`);
      } else await api.post(`/api/shops/${shopId}/schedules`, payload);
      return activate;
    },
    {
      silentError: true,
      success: (activated) => (activated ? 'Đã lưu và bật lịch' : editing ? 'Đã lưu lịch phát' : 'Đã tạo lịch phát'),
      invalidate: [['shop', shopId], ['schedule-runs']],
      onError: (e) => {
        const p = parseScheduleError(e);
        if (p.field !== 'general') setErrors({ [p.field]: p.hint ? `${p.message}. ${p.hint}` : p.message });
        else setApiError(p);
      },
      onSuccess: () => onClose(),
    },
  );

  function submit(activate = false) {
    const coverError = template && !template.coverKey ? COVER_REQUIRED : null;
    const e = validateScheduleForm(form, { requireTemplate: true, coverError });
    setErrors(e);
    setApiError(null);
    if (Object.keys(e).length) return;
    save.mutate({ activate });
  }

  const paused = schedule?.state === 'paused';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Sửa lịch phát' : 'Tạo lịch phát'}
      description={editing ? 'Lưu xong, các lần phát sắp tới được tạo lại theo cài đặt mới. Lần đang phát không bị ảnh hưởng.' : 'Chọn mẫu phát và giờ là đủ — tiêu đề, ảnh bìa mặc định lấy theo mẫu.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          {paused && (
            <Button icon={<CalendarCheck2 className="size-4" />} loading={save.isPending && save.variables?.activate} disabled={save.isPending} onClick={() => submit(true)}>
              Lưu & bật lịch
            </Button>
          )}
          <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending && !save.variables?.activate} disabled={save.isPending} onClick={() => submit(false)}>
            {editing ? 'Lưu thay đổi' : 'Tạo lịch'}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {notice && <Callout tone="warning">{notice}</Callout>}
        {paused && !notice && <Callout tone="neutral">Lịch đang tạm dừng: lưu thay đổi không tự bật lại. Bấm “Lưu & bật lịch” để kích hoạt ngay.</Callout>}
        <ScheduleFields
          key={seed}
          value={form}
          onChange={setForm}
          errors={errors}
          template={template}
          templateField={<TemplateField shopId={shopId} value={form.templateId} onChange={(id) => setForm((f) => ({ ...f, templateId: id }))} error={errors.templateId} />}
        />
        {apiError && (
          <div data-err>
            <Callout tone="danger" title={apiError.code === 'schedule_overlap' ? 'Trùng khung giờ' : 'Không lưu được lịch'}>
              {apiError.message}
              {apiError.hint && <span className="mt-1 block opacity-80">{apiError.hint}</span>}
            </Callout>
          </div>
        )}
      </div>
    </Dialog>
  );
}
