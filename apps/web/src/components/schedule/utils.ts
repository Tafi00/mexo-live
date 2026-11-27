import { REPEAT_LABELS, RUN_ISSUE_LABELS, RUN_STATE_LABELS, WEEKDAY_LABELS } from '@mexo/shared';
import { ApiError } from '@/lib/api';
import { addDaysStr, todayVn } from '@/lib/format';
import type { Tone } from '@/components/ui/misc';

// ───────────── Lặp lại & khung giờ ─────────────

/** Thứ tự hiển thị trong tuần: T2 → CN (index theo WEEKDAY_LABELS, 0 = CN) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function weekdaysLabel(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Cả tuần';
  return WEEK_ORDER.filter((d) => set.has(d))
    .map((d) => WEEKDAY_LABELS[d])
    .join(', ');
}

export function repeatSummary(s: { repeat: string; weekdays?: number[] | null }): string {
  if (s.repeat === 'once') return 'Một lần';
  if (s.repeat === 'daily') return 'Hằng ngày';
  if (!s.weekdays) return REPEAT_LABELS.weekly;
  const days = s.weekdays;
  if (!days.length) return 'Theo thứ (chưa chọn)';
  return weekdaysLabel(days);
}

export function isOvernight(startTime: string, endTime: string): boolean {
  return endTime <= startTime;
}

/** "14:00 → 09:40 (hôm sau)" */
export function windowLabel(startTime: string, endTime: string): string {
  return `${startTime} → ${endTime}${isOvernight(startTime, endTime) ? ' (hôm sau)' : ''}`;
}

/** Số phút của khung giờ (tính cả qua đêm) */
export function windowMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let d = eh * 60 + em - (sh * 60 + sm);
  if (d <= 0) d += 24 * 60;
  return d;
}

export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ───────────── Giờ Việt Nam ─────────────

const VN_MS = 7 * 3600000;
export const DAY_MS = 86400000;

/** Mốc 00:00 giờ VN của ngày (epoch ms) */
export function vnDayStart(date: string): number {
  return Date.parse(`${date}T00:00:00+07:00`);
}

/** Ngày (YYYY-MM-DD) và số phút trong ngày theo giờ VN */
export function vnParts(d: string | number | Date): { date: string; minutes: number } {
  const x = new Date(new Date(d).getTime() + VN_MS);
  return { date: x.toISOString().slice(0, 10), minutes: x.getUTCHours() * 60 + x.getUTCMinutes() };
}

/** "HH:mm" giờ VN */
export function vnHm(d: string | number | Date): string {
  const x = new Date(new Date(d).getTime() + VN_MS);
  return x.toISOString().slice(11, 16);
}

export function weekdayOfStr(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

/** Thứ Hai của tuần chứa ngày */
export function mondayOf(date: string): string {
  const wd = weekdayOfStr(date);
  return addDaysStr(date, wd === 0 ? -6 : 1 - wd);
}

export const WEEKDAY_FULL = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

/** "T5, 27/11" */
export function shortDay(date: string): string {
  return `${WEEKDAY_LABELS[weekdayOfStr(date)]}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** "Hôm nay" / "Ngày mai" / "Hôm qua" hoặc null */
export function relativeDay(date: string): string | null {
  const t = todayVn();
  if (date === t) return 'Hôm nay';
  if (date === addDaysStr(t, 1)) return 'Ngày mai';
  if (date === addDaysStr(t, -1)) return 'Hôm qua';
  return null;
}

// ───────────── Trạng thái ─────────────

export const SCHEDULE_STATE: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Đang hoạt động', tone: 'success' },
  paused: { label: 'Tạm dừng', tone: 'warning' },
  cancelled: { label: 'Đã hủy', tone: 'muted' },
};

export function runStatusLabel(status: string): string {
  return RUN_STATE_LABELS[status as keyof typeof RUN_STATE_LABELS] ?? status;
}

export function runIssueLabel(issue: string | null | undefined): string | null {
  if (!issue) return null;
  return RUN_ISSUE_LABELS[issue] ?? issue;
}

/** Màu khối lịch theo trạng thái lần phát (luôn đi kèm nhãn chữ / chú thích) */
export const RUN_COLORS: Record<string, { block: string; dot: string; text: string }> = {
  upcoming: {
    block: 'border-sky-300 bg-sky-50 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:hover:bg-sky-950/80',
    dot: 'bg-sky-500',
    text: 'text-sky-900 dark:text-sky-100',
  },
  starting: {
    block: 'border-brand-300 bg-brand-50 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/50 dark:hover:bg-brand-950/80',
    dot: 'bg-brand-500',
    text: 'text-brand-900 dark:text-brand-100',
  },
  live: {
    block: 'border-brand-400 bg-brand-100 hover:bg-brand-200/70 dark:border-brand-700 dark:bg-brand-900/50 dark:hover:bg-brand-900/70',
    dot: 'bg-brand-500',
    text: 'text-brand-900 dark:text-brand-50',
  },
  ending: {
    block: 'border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:hover:bg-amber-950/80',
    dot: 'bg-amber-500',
    text: 'text-amber-900 dark:text-amber-100',
  },
  done: {
    block: 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:hover:bg-emerald-950/80',
    dot: 'bg-emerald-500',
    text: 'text-emerald-900 dark:text-emerald-100',
  },
  missed: {
    block: 'border-rose-300 bg-rose-50 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/50 dark:hover:bg-rose-950/80',
    dot: 'bg-rose-500',
    text: 'text-rose-900 dark:text-rose-100',
  },
  failed: {
    block: 'border-rose-400 bg-rose-100 hover:bg-rose-200/70 dark:border-rose-700 dark:bg-rose-900/50 dark:hover:bg-rose-900/70',
    dot: 'bg-rose-600',
    text: 'text-rose-900 dark:text-rose-50',
  },
  cancelled: {
    block: 'border-line-strong bg-surface-2 hover:bg-surface-3',
    dot: 'bg-slate-400 dark:bg-slate-500',
    text: 'text-muted line-through decoration-1',
  },
};

export function runColor(status: string) {
  return RUN_COLORS[status] ?? RUN_COLORS.upcoming;
}

/** Trạng thái hiển thị trong chú thích (gộp các trạng thái trung gian) */
export const LEGEND_STATUSES = ['upcoming', 'live', 'done', 'missed', 'failed', 'cancelled'] as const;

// ───────────── Lỗi API ─────────────

export type ScheduleField = 'title' | 'templateId' | 'coverKey' | 'weekdays' | 'startDate' | 'endDate' | 'time' | 'general';

const CODE_FIELD: Record<string, ScheduleField> = {
  bad_time: 'time',
  no_weekdays: 'weekdays',
  bad_dates: 'endDate',
  too_far: 'startDate',
  in_past: 'startDate',
  bad_template: 'templateId',
};

const CODE_HINT: Record<string, string> = {
  schedule_overlap: 'Mỗi shop chỉ phát một phiên tại một thời điểm. Hãy đổi giờ, đổi ngày hoặc tạm dừng lịch kia.',
  too_many: 'Tạm dừng hoặc hủy bớt lịch cũ không còn dùng.',
  in_past: 'Lịch một lần phải có giờ bật ở tương lai (giờ Việt Nam).',
  too_far: 'Hãy chọn ngày bắt đầu gần hơn.',
  shop_expired: 'Gia hạn shop để tạo hoặc sửa lịch.',
};

export interface ParsedError {
  code: string;
  message: string;
  hint?: string;
  field: ScheduleField;
}

export function parseScheduleError(e: unknown): ParsedError {
  if (e instanceof ApiError) {
    let field: ScheduleField = CODE_FIELD[e.code] ?? 'general';
    if (e.code === 'validation') {
      const m = e.message.split(':')[0];
      if (m === 'title') field = 'title';
      else if (m === 'templateId') field = 'templateId';
      else if (m === 'coverKey') field = 'coverKey';
      else if (m === 'startTime' || m === 'endTime') field = 'time';
      else if (m === 'startDate') field = 'startDate';
      else if (m === 'endDate') field = 'endDate';
    }
    return { code: e.code, message: e.message, hint: CODE_HINT[e.code], field };
  }
  return { code: 'error', message: e instanceof Error ? e.message : 'Đã có lỗi xảy ra', field: 'general' };
}
