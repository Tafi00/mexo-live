import { useEffect, useRef, useState } from 'react';
import { CalendarCheck2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { Schedule } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/misc';
import { emptyScheduleForm, formToPayload, ScheduleFields, scheduleToForm, TemplateField, validateScheduleForm, type ScheduleErrors, type ScheduleFormValue } from './ScheduleForm';
import { parseScheduleError, type ParsedError } from './utils';

/** Tạo / sửa lịch phát của 1 shop */
export function ScheduleDialog({ open, onClose, shopId, schedule, notice }: { open: boolean; onClose: () => void; shopId: number; schedule?: Schedule | null; notice?: string | null }) {
  const [form, setForm] = useState<ScheduleFormValue>(emptyScheduleForm);
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [apiError, setApiError] = useState<ParsedError | null>(null);
  const editing = Boolean(schedule);
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (apiError) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [apiError]);

  useEffect(() => {
    if (!open) return;
    setForm(schedule ? scheduleToForm(schedule) : emptyScheduleForm());
    setErrors({});
    setApiError(null);
  }, [open, schedule]);

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
      onError: (e) => setApiError(parseScheduleError(e)),
      onSuccess: () => onClose(),
    },
  );

  function submit(activate = false) {
    const e = validateScheduleForm(form, { requireTemplate: true });
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
      description={editing ? 'Sau khi lưu, các lần phát sắp tới được tạo lại theo cài đặt mới. Lần đang phát không bị ảnh hưởng.' : 'Hệ thống tự tạo phiên, phát mẫu và tắt phiên đúng giờ đã hẹn.'}
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
      <div className="space-y-4">
        {notice && <Callout tone="warning">{notice}</Callout>}
        {paused && !notice && <Callout tone="neutral">Lịch đang tạm dừng: lưu thay đổi không tự bật lại. Bấm “Lưu & bật lịch” để kích hoạt ngay.</Callout>}
        <ScheduleFields
          value={form}
          onChange={setForm}
          errors={errors}
          templateField={<TemplateField shopId={shopId} value={form.templateId} onChange={(id) => setForm((f) => ({ ...f, templateId: id }))} error={errors.templateId} />}
        />
        {apiError && (
          <div ref={errRef}>
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
