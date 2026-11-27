import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock, Image as ImageIcon, ImagePlus, ListVideo, MoonStar, Plus } from 'lucide-react';
import { WEEKDAY_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtDate, fmtDuration, todayVn } from '@/lib/format';
import type { Schedule, TemplateSummary } from '@/lib/types';
import { CoverUpload } from '@/components/domain/CoverUpload';
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { isOvernight, minutesLabel, TIME_RE, WEEK_ORDER, WEEKDAY_FULL, weekdayOfStr, windowLabel, windowMinutes, type ScheduleField } from './utils';

export interface ScheduleFormValue {
  /** '' = dùng tiêu đề live của mẫu phát */
  title: string;
  description: string;
  templateId: number | null;
  /** null = dùng ảnh bìa của mẫu phát */
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

/** Lịch từ API: title đã được điền theo mẫu khi để trống (titleFromTemplate) */
export type ScheduleRow = Schedule & { titleFromTemplate?: boolean; coverFromTemplate?: boolean };

export function scheduleToForm(s: ScheduleRow): ScheduleFormValue {
  return {
    title: s.titleFromTemplate ? '' : s.title,
    description: s.description ?? '',
    templateId: s.templateId,
    coverKey: s.coverFromTemplate ? null : s.coverKey,
    repeat: s.repeat,
    weekdays: s.weekdays ?? [],
    startDate: s.startDate,
    endDate: s.endDate ?? '',
    startTime: s.startTime,
    endTime: s.endTime,
  };
}

export function validateScheduleForm(v: ScheduleFormValue, opts: { requireTemplate: boolean; coverError?: string | null }): ScheduleErrors {
  const e: ScheduleErrors = {};
  if (opts.requireTemplate && !v.templateId) e.templateId = 'Cần chọn mẫu phát';
  if (opts.coverError && !v.coverKey) e.coverKey = opts.coverError;
  if (v.repeat === 'weekly' && !v.weekdays.length) e.weekdays = 'Chọn ít nhất một thứ trong tuần';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startDate)) e.startDate = 'Chọn ngày bắt đầu';
  if (v.repeat !== 'once' && v.endDate && v.endDate < v.startDate) e.endDate = 'Ngày kết thúc phải sau ngày bắt đầu';
  if (!TIME_RE.test(v.startTime) || !TIME_RE.test(v.endTime)) e.time = 'Giờ theo định dạng 24 giờ HH:mm, ví dụ 08:30 hoặc 20:00';
  else if (v.startTime === v.endTime) e.time = 'Giờ tắt phải khác giờ bật';
  return e;
}

/** Tiêu đề / ảnh bìa để trống → dùng của mẫu phát */
export function formToPayload(v: ScheduleFormValue) {
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    coverKey: v.coverKey || null,
    repeat: v.repeat,
    weekdays: v.repeat === 'weekly' ? [...v.weekdays].sort((a, b) => a - b) : [],
    startDate: v.startDate,
    endDate: v.repeat === 'once' ? null : v.endDate || null,
    startTime: v.startTime,
    endTime: v.endTime,
  };
}

export const coverUrl = (key: string) => `/api/files/cover?key=${encodeURIComponent(key)}`;

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
      leading={<Clock className="size-3.5" />}
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
    <div className="flex flex-wrap items-center gap-1.5">
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
              'h-7 min-w-10 rounded-md border px-2 text-xs font-medium transition-colors',
              on ? 'border-brand-500 bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'border-line-strong bg-surface text-muted hover:border-brand-300 hover:text-fg',
            )}
          >
            {WEEKDAY_LABELS[d]}
          </button>
        );
      })}
      <span className="mx-0.5 text-subtle">·</span>
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

export type TemplatesResp = { items: TemplateSummary[]; counts: { all: number; warn: number } };

export function templatesQuery(shopId: number | null | undefined) {
  return {
    queryKey: ['shop', shopId, 'templates'],
    queryFn: () => api.get<TemplatesResp>(`/api/shops/${shopId}/templates`),
    staleTime: 30_000,
  };
}

export function useShopTemplates(shopId: number | null | undefined, enabled = true) {
  return useQuery({ ...templatesQuery(shopId), enabled: Boolean(shopId) && enabled });
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
  if (q.isLoading)
    return (
      <Select inputSize={inputSize} disabled>
        <option>Đang tải mẫu phát…</option>
      </Select>
    );
  if (!items.length)
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-dashed border-amber-300 px-2.5 text-xs text-amber-800 dark:border-amber-800 dark:text-amber-300', inputSize === 'sm' ? 'h-7' : 'h-8')}>
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
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
          <ListVideo className="size-3.5" />
          <span>{sel.videoCount} video</span>·<span>{sel.productCount} sản phẩm ghim</span>·<span>{fmtDuration(sel.durationSec)}</span>
          {sel.loop && <span>· phát lặp lại</span>}
        </p>
      )}
      {showInfo && sel && sel.issueCount > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Mẫu đang có {sel.issueCount} vấn đề{sel.issues[0] ? ` (${sel.issues[0].message})` : ''}. Nếu tới giờ mẫu vẫn không đạt kiểm tra, lần phát sẽ bị bỏ lỡ.
          </span>
        </p>
      )}
    </div>
  );
}

// ───────────── Ảnh bìa ─────────────

/**
 * Ảnh bìa của lịch. Để trống → dùng ảnh bìa của mẫu phát (nếu mẫu có).
 * - template: mẫu đang chọn (1 shop); null/undefined = chưa chọn
 * - bulk: chế độ nhiều shop — tên các shop có mẫu chưa có ảnh bìa
 */
function CoverField({ value, onChange, error, template, bulk }: { value: string | null; onChange: (k: string | null) => void; error?: string; template?: TemplateSummary | null; bulk?: { missing: string[] } }) {
  const tplCover = template?.coverKey ?? null;

  if (bulk) {
    const n = bulk.missing.length;
    return (
      <Field label="Ảnh bìa chung" required={n > 0} aside={n ? undefined : <span className="text-2xs text-subtle">Không bắt buộc</span>} error={error}>
        <CoverUpload value={value} onChange={onChange} required={n > 0} />
        {!error && (
          <p className={cn('mt-1.5 text-xs', n && !value ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}>
            {n
              ? `${n} shop có mẫu phát chưa có ảnh bìa (${bulk.missing.slice(0, 3).join(', ')}${n > 3 ? '…' : ''}) — cần ảnh bìa chung.`
              : 'Để trống: mỗi shop dùng ảnh bìa trong mẫu phát của shop đó.'}
          </p>
        )}
      </Field>
    );
  }

  // Mẫu có ảnh bìa: hiển thị ảnh của mẫu, bấm vào ảnh để dùng ảnh khác (cùng cách với "Phát ngay")
  if (tplCover)
    return (
      <Field
        label="Ảnh bìa"
        error={error}
        aside={
          value ? (
            <button type="button" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => onChange(null)}>
              Dùng lại ảnh của mẫu phát
            </button>
          ) : undefined
        }
      >
        <div className={cn('mb-2 flex items-center gap-1.5 text-xs', value ? 'text-muted' : 'font-medium text-emerald-700 dark:text-emerald-400')}>
          {value ? <ImagePlus className="size-3.5" /> : <ImageIcon className="size-3.5" />}
          {value ? 'Đang dùng ảnh riêng cho lịch này' : `Dùng ảnh bìa của mẫu phát “${template?.name}”`}
          {!value && <span className="font-normal text-muted">· bấm vào ảnh để dùng ảnh khác</span>}
        </div>
        <CoverUpload value={value ?? tplCover} onChange={onChange} removable={Boolean(value)} />
      </Field>
    );

  const required = Boolean(template);
  return (
    <Field label="Ảnh bìa" required={required} error={error}>
      <CoverUpload value={value} onChange={onChange} required={required} />
      {!error && required && <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">Mẫu phát này chưa có ảnh bìa — tải ảnh cho lịch, hoặc thêm ảnh bìa vào mẫu phát để các lịch sau dùng chung.</p>}
      {!error && !template && <p className="mt-1.5 text-xs text-muted">Chọn mẫu phát trước: nếu mẫu có ảnh bìa, lịch dùng luôn ảnh đó.</p>}
    </Field>
  );
}

// ───────────── Bộ trường chung ─────────────

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-2xs font-semibold uppercase tracking-wide text-subtle">{children}</p>;
}

export function ScheduleFields({
  value: v,
  onChange,
  errors = {},
  templateField,
  template,
  bulk,
}: {
  value: ScheduleFormValue;
  onChange: (v: ScheduleFormValue) => void;
  errors?: ScheduleErrors;
  templateField?: ReactNode;
  /** Mẫu đang chọn (1 shop) — gợi ý tiêu đề / ảnh bìa mặc định */
  template?: TemplateSummary | null;
  /** Chế độ nhiều shop */
  bulk?: { missing: string[] };
}) {
  const set = <K extends keyof ScheduleFormValue>(k: K, val: ScheduleFormValue[K]) => onChange({ ...v, [k]: val });
  const [showDesc, setShowDesc] = useState(Boolean(v.description));
  const timesOk = TIME_RE.test(v.startTime) && TIME_RE.test(v.endTime) && v.startTime !== v.endTime;
  const overnight = timesOk && isOvernight(v.startTime, v.endTime);
  const today = todayVn();
  const defaultTitle = template ? template.liveTitle || template.name : null;

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
    <div className="@container space-y-4">
      {templateField}

      <div className="space-y-3">
        <SectionTitle>Thời gian · giờ Việt Nam (UTC+7)</SectionTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented
            value={v.repeat}
            onChange={(r) => onChange({ ...v, repeat: r, weekdays: r === 'weekly' && !v.weekdays.length ? [weekdayOfStr(v.startDate || today)] : v.weekdays })}
            options={[
              { value: 'once', label: 'Một lần' },
              { value: 'daily', label: 'Hằng ngày' },
              { value: 'weekly', label: 'Theo thứ' },
            ]}
          />
          {v.repeat === 'weekly' && <WeekdayChips value={v.weekdays} onChange={(w) => set('weekdays', w)} />}
        </div>
        {errors.weekdays && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.weekdays}</p>}
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <Field label="Giờ bật" required>
            <TimeInput value={v.startTime} invalid={Boolean(errors.time)} onChange={(t) => set('startTime', t)} />
          </Field>
          <Field label="Giờ tắt" required>
            <TimeInput value={v.endTime} invalid={Boolean(errors.time)} onChange={(t) => set('endTime', t)} />
          </Field>
          <Field label={v.repeat === 'once' ? 'Ngày phát' : 'Từ ngày'} required error={errors.startDate}>
            <Input type="date" min={today} value={v.startDate} invalid={Boolean(errors.startDate)} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          {v.repeat !== 'once' && (
            <Field
              label="Đến ngày"
              error={errors.endDate}
              aside={
                v.endDate ? (
                  <button type="button" className="text-2xs font-medium text-muted hover:text-fg" onClick={() => set('endDate', '')}>
                    Bỏ
                  </button>
                ) : (
                  <span className="text-2xs text-subtle">Không giới hạn</span>
                )
              }
            >
              <Input type="date" min={v.startDate || today} value={v.endDate} invalid={Boolean(errors.endDate)} onChange={(e) => set('endDate', e.target.value)} />
            </Field>
          )}
        </div>
        {errors.time && <p className="text-xs text-rose-600 dark:text-rose-400">{errors.time}</p>}
        {timesOk && (
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm">
            {overnight ? <MoonStar className="mt-0.5 size-4 shrink-0 text-violet-500" /> : <Clock className="mt-0.5 size-4 shrink-0 text-muted" />}
            <div className="min-w-0">
              <p>
                <span className="font-medium">{when}</span> · <span className="tabular">{windowLabel(v.startTime, v.endTime)}</span> · {minutesLabel(windowMinutes(v.startTime, v.endTime))}
              </p>
              {(overnight || v.repeat !== 'once') && (
                <p className="text-xs text-muted">
                  {overnight && `Qua nửa đêm, tự tắt lúc ${v.endTime} hôm sau. `}
                  {v.repeat !== 'once' && (v.endDate ? `Áp dụng ${fmtDate(v.startDate)} – ${fmtDate(v.endDate)}.` : `Từ ${fmtDate(v.startDate)}, lặp đến khi tạm dừng hoặc hủy.`)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <SectionTitle>Tiêu đề & ảnh bìa · để trống sẽ dùng theo mẫu phát</SectionTitle>
        <Field label="Tiêu đề phiên live" aside={<span className="text-2xs text-subtle">Không bắt buộc</span>} error={errors.title}>
          <Input
            value={v.title}
            maxLength={200}
            invalid={Boolean(errors.title)}
            onChange={(e) => set('title', e.target.value)}
            placeholder={bulk ? 'Mặc định: tiêu đề live trong mẫu phát của từng shop' : defaultTitle ? `Mặc định: ${defaultTitle}` : 'Mặc định: tiêu đề live của mẫu phát'}
          />
        </Field>
        <CoverField value={v.coverKey} onChange={(k) => set('coverKey', k)} error={errors.coverKey} template={template} bulk={bulk} />
        {showDesc || v.description ? (
          <Field label="Mô tả" aside={<span className="text-2xs tabular text-subtle">{v.description.length}/1000</span>}>
            <Textarea rows={2} className="min-h-[56px]" maxLength={1000} value={v.description} onChange={(e) => set('description', e.target.value)} placeholder="Mô tả ngắn cho phiên live" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowDesc(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            <Plus className="size-3.5" /> Thêm mô tả phiên
          </button>
        )}
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
