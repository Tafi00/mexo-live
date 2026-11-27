import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, ListVideo, MoonStar } from 'lucide-react';
import { WEEKDAY_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtDate, fmtDuration, todayVn } from '@/lib/format';
import type { Schedule, TemplateSummary } from '@/lib/types';
import { CoverUpload } from '@/components/domain/CoverUpload';
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { isOvernight, minutesLabel, TIME_RE, WEEK_ORDER, WEEKDAY_FULL, weekdayOfStr, windowLabel, windowMinutes, type ScheduleField } from './utils';

export interface ScheduleFormValue {
  title: string;
  description: string;
  templateId: number | null;
  coverKey: string | null;
  repeat: 'once' | 'daily' | 'weekly';
  weekdays: number[];
  startDate: string;
  /** '' = không giới hạn */
  endDate: string;
  startTime: string;
  endTime: string;
}

export type ScheduleErrors = Partial<Record<ScheduleField, string>>;

export function emptyScheduleForm(): ScheduleFormValue {
  const t = todayVn();
  return { title: '', description: '', templateId: null, coverKey: null, repeat: 'daily', weekdays: [weekdayOfStr(t)], startDate: addDaysStr(t, 1), endDate: '', startTime: '20:00', endTime: '22:00' };
}

export function scheduleToForm(s: Schedule): ScheduleFormValue {
  return {
    title: s.title,
    description: s.description ?? '',
    templateId: s.templateId,
    coverKey: s.coverKey,
    repeat: s.repeat,
    weekdays: s.weekdays ?? [],
    startDate: s.startDate,
    endDate: s.endDate ?? '',
    startTime: s.startTime,
    endTime: s.endTime,
  };
}

export function validateScheduleForm(v: ScheduleFormValue, opts: { requireTemplate: boolean }): ScheduleErrors {
  const e: ScheduleErrors = {};
  if (!v.title.trim()) e.title = 'Cần nhập tiêu đề phiên';
  if (opts.requireTemplate && !v.templateId) e.templateId = 'Cần chọn mẫu phát';
  if (!v.coverKey) e.coverKey = 'Cần ảnh bìa cho phiên live';
  if (v.repeat === 'weekly' && !v.weekdays.length) e.weekdays = 'Chọn ít nhất một thứ trong tuần';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)) e.startDate = 'Chọn ngày bắt đầu';
  if (v.repeat !== 'once' && v.endDate && v.endDate < v.startDate) e.endDate = 'Ngày kết thúc phải sau ngày bắt đầu';
  if (!TIME_RE.test(v.startTime) || !TIME_RE.test(v.endTime)) e.time = 'Giờ theo định dạng 24 giờ HH:mm, ví dụ 08:30 hoặc 20:00';
  else if (v.startTime === v.endTime) e.time = 'Giờ tắt phải khác giờ bật';
  return e;
}

export function formToPayload(v: ScheduleFormValue) {
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    coverKey: v.coverKey ?? '',
    repeat: v.repeat,
    weekdays: v.repeat === 'weekly' ? [...v.weekdays].sort((a, b) => a - b) : [],
    startDate: v.startDate,
    endDate: v.repeat === 'once' ? null : v.endDate || null,
    startTime: v.startTime,
    endTime: v.endTime,
  };
}

// ───────────── Ô nhập giờ 24h ─────────────

function maskTime(raw: string): string {
  const r = raw.replace(/[^\d:]/g, '');
  const m = r.match(/^(\d{1,2}):(\d{0,2})/);
  if (m) return `${m[1]}:${m[2]}`;
  const d = r.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

function normalizeTime(v: string): string {
  const m = v.match(/^(\d{1,2}):?(\d{0,2})$/);
  if (!m) return v;
  const h = m[1].padStart(2, '0');
  const mm = (m[2] || '0').padStart(2, '0');
  return `${h}:${mm}`;
}

export function TimeInput({ value, onChange, invalid, id }: { value: string; onChange: (v: string) => void; invalid?: boolean; id?: string }) {
  return (
    <Input
      id={id}
      value={value}
      inputMode="numeric"
      placeholder="HH:mm"
      maxLength={5}
      autoComplete="off"
      invalid={invalid}
      leading={<Clock className="size-4" />}
      className="tabular"
      onChange={(e) => onChange(maskTime(e.target.value))}
      onBlur={() => value && onChange(normalizeTime(value))}
    />
  );
}

// ───────────── Chọn thứ trong tuần ─────────────

export function WeekdayChips({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const set = new Set(value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEK_ORDER.map((d) => {
        const on = set.has(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            title={WEEKDAY_FULL[d]}
            onClick={() => {
              const n = new Set(set);
              if (on) n.delete(d);
              else n.add(d);
              onChange([...n]);
            }}
            className={cn(
              'h-8 min-w-11 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
              on ? 'border-brand-500 bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'border-line-strong bg-surface text-muted hover:border-brand-300 hover:text-fg',
            )}
          >
            {WEEKDAY_LABELS[d]}
          </button>
        );
      })}
      <span className="mx-1 self-center text-subtle">·</span>
      <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => onChange([1, 2, 3, 4, 5])}>
        T2–T6
      </button>
      <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => onChange([6, 0])}>
        Cuối tuần
      </button>
    </div>
  );
}

// ───────────── Chọn mẫu phát ─────────────

export function useShopTemplates(shopId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['shop', shopId, 'templates'],
    queryFn: () => api.get<{ items: TemplateSummary[]; counts: { all: number; warn: number } }>(`/api/shops/${shopId}/templates`),
    enabled: Boolean(shopId) && enabled,
    staleTime: 30_000,
  });
}

export function TemplateSelect({
  shopId,
  value,
  onChange,
  invalid,
  inputSize = 'md',
  autoPickSingle,
  showInfo,
}: {
  shopId: number;
  value: number | null;
  onChange: (id: number | null) => void;
  invalid?: boolean;
  inputSize?: 'sm' | 'md';
  autoPickSingle?: boolean;
  showInfo?: boolean;
}) {
  const q = useShopTemplates(shopId);
  const items = q.data?.items ?? [];
  useEffect(() => {
    if (autoPickSingle && !value && items.length === 1) onChange(items[0].id);
  }, [autoPickSingle, value, items, onChange]);
  const sel = items.find((t) => t.id === value);
  if (q.isLoading) return <Select inputSize={inputSize} disabled><option>Đang tải mẫu phát…</option></Select>;
  if (!items.length)
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-dashed border-amber-300 px-3 text-xs text-amber-800 dark:border-amber-800 dark:text-amber-300', inputSize === 'sm' ? 'h-8' : 'h-9')}>
        <AlertTriangle className="size-3.5 shrink-0" />
        <span className="truncate">Shop chưa có mẫu phát.</span>
        <Link to={`/shops/${shopId}/templates/new`} className="ml-auto shrink-0 font-medium underline" target="_blank">
          Tạo mẫu
        </Link>
      </div>
    );
  return (
    <div className="space-y-1.5">
      <Select inputSize={inputSize} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={cn(invalid && '[&>select]:border-rose-400')}>
        <option value="">— Chọn mẫu phát —</option>
        {items.map((t) => (
          <option key={t.id} value={t.id}>
            #{t.number} {t.name}
            {t.issueCount ? ` (⚠ ${t.issueCount} vấn đề)` : ''}
          </option>
        ))}
      </Select>
      {showInfo && sel && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          <ListVideo className="size-3.5" />
          <span>{sel.videoCount} video</span>·<span>{sel.productCount} sản phẩm ghim</span>·<span>{fmtDuration(sel.durationSec)}</span>
          {sel.loop && <span>· phát lặp lại</span>}
        </p>
      )}
      {showInfo && sel && sel.issueCount > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            Mẫu đang có {sel.issueCount} vấn đề{sel.issues[0] ? ` (${sel.issues[0].message})` : ''}. Nếu lúc tới giờ mẫu vẫn không đạt kiểm tra, lần phát sẽ bị bỏ lỡ.
          </span>
        </p>
      )}
    </div>
  );
}

// ───────────── Bộ trường chung ─────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{children}</p>;
}

export function ScheduleFields({ value: v, onChange, errors = {}, templateField }: { value: ScheduleFormValue; onChange: (v: ScheduleFormValue) => void; errors?: ScheduleErrors; templateField?: ReactNode }) {
  const set = <K extends keyof ScheduleFormValue>(k: K, val: ScheduleFormValue[K]) => onChange({ ...v, [k]: val });
  const timesOk = TIME_RE.test(v.startTime) && TIME_RE.test(v.endTime) && v.startTime !== v.endTime;
  const overnight = timesOk && isOvernight(v.startTime, v.endTime);
  const today = todayVn();

  const when =
    v.repeat === 'once'
      ? `${WEEKDAY_FULL[weekdayOfStr(v.startDate)] ?? ''}, ${fmtDate(v.startDate)}`
      : v.repeat === 'daily'
        ? 'Hằng ngày'
        : v.weekdays.length
          ? `Mỗi ${WEEK_ORDER.filter((d) => v.weekdays.includes(d))
              .map((d) => WEEKDAY_FULL[d])
              .join(', ')}`
          : 'Chưa chọn thứ';

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <Field label="Tiêu đề phiên live" required error={errors.title} hint="Hiển thị trên Shopee cho người xem">
          <Input value={v.title} maxLength={200} invalid={Boolean(errors.title)} onChange={(e) => set('title', e.target.value)} placeholder="Ví dụ: Xả kho cuối tuần – freeship toàn quốc" />
        </Field>
        {templateField}
        <Field label="Mô tả" aside={<span className="text-[11px] tabular text-subtle">{v.description.length}/1000</span>}>
          <Textarea rows={2} className="min-h-[60px]" maxLength={1000} value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="Mô tả ngắn cho phiên live (không bắt buộc)" />
        </Field>
      </div>

      <div className="space-y-4 border-t border-line pt-4">
        <SectionTitle>Thời gian · giờ Việt Nam (UTC+7)</SectionTitle>
        <Field label="Lặp lại">
          <Segmented
            value={v.repeat}
            onChange={(r) => onChange({ ...v, repeat: r, weekdays: r === 'weekly' && !v.weekdays.length ? [weekdayOfStr(v.startDate || today)] : v.weekdays })}
            options={[
              { value: 'once', label: 'Một lần' },
              { value: 'daily', label: 'Hằng ngày' },
              { value: 'weekly', label: 'Theo thứ' },
            ]}
          />
        </Field>
        {v.repeat === 'weekly' && (
          <Field label="Các thứ phát" required error={errors.weekdays}>
            <WeekdayChips value={v.weekdays} onChange={(w) => set('weekdays', w)} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={v.repeat === 'once' ? 'Ngày phát' : 'Áp dụng từ ngày'} required error={errors.startDate}>
            <Input type="date" min={today} value={v.startDate} invalid={Boolean(errors.startDate)} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          {v.repeat !== 'once' && (
            <Field label="Đến ngày" error={errors.endDate} hint="Để trống nếu lặp lại không giới hạn">
              <div className="flex items-center gap-2">
                <Input type="date" min={v.startDate || today} value={v.endDate} invalid={Boolean(errors.endDate)} onChange={(e) => set('endDate', e.target.value)} />
                {v.endDate && (
                  <button type="button" className="shrink-0 text-xs font-medium text-muted hover:text-fg" onClick={() => set('endDate', '')}>
                    Bỏ
                  </button>
                )}
              </div>
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Giờ bật" required>
            <TimeInput value={v.startTime} invalid={Boolean(errors.time)} onChange={(t) => set('startTime', t)} />
          </Field>
          <Field label="Giờ tắt" required>
            <TimeInput value={v.endTime} invalid={Boolean(errors.time)} onChange={(t) => set('endTime', t)} />
          </Field>
        </div>
        {errors.time && <p className="-mt-2 text-xs text-rose-600 dark:text-rose-400">{errors.time}</p>}
        {timesOk && (
          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5 text-[13px]">
            {overnight ? <MoonStar className="mt-0.5 size-4 shrink-0 text-violet-500" /> : <Clock className="mt-0.5 size-4 shrink-0 text-muted" />}
            <div className="min-w-0">
              <p>
                <span className="font-medium">{when}</span> · <span className="tabular">{windowLabel(v.startTime, v.endTime)}</span> · {minutesLabel(windowMinutes(v.startTime, v.endTime))}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {overnight && `Phiên kéo qua nửa đêm, tự tắt lúc ${v.endTime} ngày hôm sau. `}
                {v.repeat !== 'once' && (v.endDate ? `Áp dụng ${fmtDate(v.startDate)} – ${fmtDate(v.endDate)}.` : `Bắt đầu từ ${fmtDate(v.startDate)}, lặp lại đến khi tạm dừng hoặc hủy.`)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <SectionTitle>Ảnh bìa phiên live</SectionTitle>
        <Field error={errors.coverKey}>
          <CoverUpload value={v.coverKey} onChange={(k) => set('coverKey', k)} required />
        </Field>
      </div>
    </div>
  );
}

export function TemplateField({ shopId, value, onChange, error }: { shopId: number; value: number | null; onChange: (id: number | null) => void; error?: string }) {
  return (
    <Field
      label="Mẫu phát"
      required
      error={error}
      aside={
        <Link to={`/shops/${shopId}/templates`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
          Quản lý mẫu phát
        </Link>
      }
    >
      <TemplateSelect shopId={shopId} value={value} onChange={onChange} invalid={Boolean(error)} showInfo autoPickSingle />
    </Field>
  );
}
