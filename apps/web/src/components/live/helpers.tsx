import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtClock, fmtDuration } from '@/lib/format';
import type { LiveSession, Signal, TemplateSummary } from '@/lib/types';
import { Badge, type Tone } from '@/components/ui/misc';

export const ORIGIN_LABELS: Record<string, string> = {
  manual: 'Thủ công',
  schedule: 'Lịch phát',
  legacy: 'Hệ thống cũ',
  external: 'App Shopee',
};

const originTone: Record<string, Tone> = { manual: 'muted', schedule: 'info', legacy: 'warning', external: 'violet' };

export function OriginBadge({ origin, size = 'sm' }: { origin: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={originTone[origin] ?? 'muted'} size={size}>
      {ORIGIN_LABELS[origin] ?? origin}
    </Badge>
  );
}

export const ENDED_REASON_LABELS: Record<string, string> = {
  manual: 'Kết thúc thủ công',
  schedule_ended: 'Hết giờ theo lịch',
  ended_on_shopee: 'Kết thúc trên Shopee',
  not_found_on_shopee: 'Không còn trên Shopee',
  lock_released: 'Giải phóng khóa',
  service_expired: 'Tự ngắt do hết hạn',
  schedule_start_failed: 'Lịch bật thất bại',
  migrated: 'Nhập từ hệ thống cũ',
};

export function endedReasonLabel(r: string | null | undefined): string {
  if (!r) return '—';
  return ENDED_REASON_LABELS[r] ?? r;
}

export const HANDLED_META: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Chưa xử lý', tone: 'neutral' },
  replied: { label: 'Đã trả lời', tone: 'success' },
  skipped: { label: 'Bỏ qua', tone: 'muted' },
  blocked: { label: 'Bị chặn', tone: 'danger' },
  escalated: { label: 'Cần nhân viên', tone: 'warning' },
  failed: { label: 'Gửi lỗi', tone: 'danger' },
};

export function HandledBadge({ handled }: { handled: string | null }) {
  const m = HANDLED_META[handled ?? 'pending'] ?? { label: handled ?? '', tone: 'neutral' as Tone };
  return (
    <Badge tone={m.tone} size="sm" dot={handled === 'escalated'}>
      {m.label}
    </Badge>
  );
}

/** Tín hiệu sức khỏe phiên tính từ bản ghi đầy đủ (giống backend sessionSummary) */
export function sessionSignals(s: Pick<LiveSession, 'streamState' | 'pinState' | 'replyState'>): { feed: Signal; pin: Signal; reply: Signal } {
  const feed: Signal = s.streamState === 'pushing' ? 'ok' : s.streamState === 'idle' || s.streamState === 'stopped' ? 'off' : 'attn';
  return { feed, pin: s.pinState, reply: s.replyState };
}

/** Thời lượng phát (giây): từ lúc lên sóng tới lúc kết thúc hoặc hiện tại */
export function liveSeconds(startedAt: string | null | undefined, endedAt: string | null | undefined, now: number): number | null {
  if (!startedAt) return null;
  const end = endedAt ? Date.parse(endedAt) : now;
  return Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
}

/** Thời lượng live gọn: "1:02:05", hoặc "2 ngày 3 giờ" khi quá 24 giờ */
export function fmtLive(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  return sec >= 86400 ? fmtDuration(sec) : fmtClock(sec);
}

/** Danh sách mẫu phát của shop (dùng chung queryKey với các trang shop) */
export function useShopTemplates(shopId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: ['shop', shopId, 'templates'],
    queryFn: () => api.get<{ items: TemplateSummary[]; counts: { all: number; warn: number } }>(`/api/shops/${shopId}/templates`),
    enabled: Boolean(shopId) && enabled,
    staleTime: 30_000,
  });
}

export function eventTone(level: string): { dot: string; text: string } {
  if (level === 'error') return { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' };
  if (level === 'warn') return { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' };
  return { dot: 'bg-slate-300 dark:bg-slate-600', text: 'text-fg' };
}
