import { CONNECTION_LABELS, ROLE_LABELS, RUN_STATE_LABELS, SESSION_STATE_LABELS, STREAM_STATE_LABELS, VIDEO_STATE_LABELS, SERVER_STATE_LABELS, type Role } from '@mexo/shared';
import { Badge, Dot, Tooltip, type Tone } from '@/components/ui/misc';
import { cn } from '@/lib/cn';

const sessionTone: Record<string, Tone> = {
  not_started: 'neutral',
  preparing: 'info',
  connecting: 'info',
  live: 'brand',
  ending: 'warning',
  ended: 'muted',
  disconnected: 'danger',
  sync_error: 'danger',
  unknown: 'warning',
};

export function SessionStateBadge({ state, stuck, size }: { state: string; stuck?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={sessionTone[state] ?? 'neutral'} dot pulse={state === 'live'} size={size}>
        {SESSION_STATE_LABELS[state as keyof typeof SESSION_STATE_LABELS] ?? state}
      </Badge>
      {stuck && (
        <Badge tone="danger" size="sm">
          Có vẻ treo
        </Badge>
      )}
    </span>
  );
}

const streamTone: Record<string, Tone> = { idle: 'muted', waiting_server: 'info', preparing: 'info', pushing: 'success', error: 'danger', lost: 'danger', stopped: 'muted' };
export function StreamStateBadge({ state, size }: { state: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={streamTone[state] ?? 'neutral'} dot pulse={state === 'pushing'} size={size}>
      {STREAM_STATE_LABELS[state as keyof typeof STREAM_STATE_LABELS] ?? state}
    </Badge>
  );
}

const connTone: Record<string, Tone> = { ok: 'success', expiring: 'warning', expired: 'danger', revoked: 'danger', needs_reauth: 'warning', error: 'danger' };
export function ConnectionBadge({ state, size }: { state: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={connTone[state] ?? 'neutral'} dot size={size}>
      {CONNECTION_LABELS[state as keyof typeof CONNECTION_LABELS] ?? state}
    </Badge>
  );
}

export function ServiceBadge({ state, daysLeft, expiresOn, size }: { state: string; daysLeft: number | null; expiresOn?: string | null; size?: 'sm' | 'md' }) {
  if (state === 'suspended') return <Badge tone="muted" size={size}>Đã ngưng</Badge>;
  if (!expiresOn && state === 'active') return <Badge tone="violet" size={size}>Không thời hạn</Badge>;
  if (state === 'expired') return <Badge tone="danger" size={size}>Hết hạn</Badge>;
  if (state === 'expiring') return <Badge tone="warning" size={size}>Còn {daysLeft} ngày</Badge>;
  return (
    <span className="whitespace-nowrap text-[13px] tabular text-fg">
      Còn {daysLeft} ngày
    </span>
  );
}

const shopTone: Record<string, Tone> = { live: 'brand', ready: 'success', attention: 'warning', scheduled: 'info', expired: 'danger', suspended: 'muted', disconnected: 'warning' };
const shopLabel: Record<string, string> = { live: 'Đang live', ready: 'Sẵn sàng', attention: 'Cần xử lý', scheduled: 'Có lịch hôm nay', expired: 'Hết hạn', suspended: 'Đã ngưng', disconnected: 'Chưa kết nối' };
export function ShopStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={shopTone[status] ?? 'neutral'} dot pulse={status === 'live'} size={size}>
      {shopLabel[status] ?? status}
    </Badge>
  );
}

const videoTone: Record<string, Tone> = { ready: 'success', uploading: 'info', processing: 'info', missing_file: 'warning', failed: 'danger' };
export function VideoStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={videoTone[status] ?? 'neutral'} dot size={size}>
      {VIDEO_STATE_LABELS[status as keyof typeof VIDEO_STATE_LABELS] ?? status}
    </Badge>
  );
}

const runTone: Record<string, Tone> = { upcoming: 'info', starting: 'brand', live: 'brand', ending: 'warning', done: 'success', missed: 'danger', failed: 'danger', cancelled: 'muted' };
export function RunStatusBadge({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={runTone[status] ?? 'neutral'} dot pulse={status === 'live'} size={size}>
      {RUN_STATE_LABELS[status as keyof typeof RUN_STATE_LABELS] ?? status}
    </Badge>
  );
}

const serverTone: Record<string, Tone> = { online: 'success', lost: 'danger', rejected: 'danger', pending: 'muted', suspended: 'warning', revoked: 'muted', key_expired: 'danger' };
export function ServerStateBadge({ state, size }: { state: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={serverTone[state] ?? 'neutral'} dot pulse={state === 'online'} size={size}>
      {SERVER_STATE_LABELS[state] ?? state}
    </Badge>
  );
}

const roleTone: Record<string, Tone> = { sysadmin: 'violet', admin: 'info', owner: 'brand', member: 'neutral' };
export function RoleBadge({ role, size }: { role: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={roleTone[role] ?? 'neutral'} size={size}>
      {ROLE_LABELS[role as Role] ?? role}
    </Badge>
  );
}

const sigTone = { ok: 'success', attn: 'danger', off: 'muted' } as const;
const sigLabel = { ok: 'tốt', attn: 'có vấn đề', off: 'đang tắt' };

/** Tín hiệu sức khỏe phiên: Hình (máy đang đẩy), Ghim (sản phẩm khớp video), Trả lời (tự động trả lời) */
export function Signals({ signals, compact }: { signals: { feed: 'ok' | 'attn' | 'off'; pin: 'ok' | 'attn' | 'off'; reply: 'ok' | 'attn' | 'off' }; compact?: boolean }) {
  const items = [
    ['Hình', signals.feed],
    ['Ghim', signals.pin],
    ['Trả lời', signals.reply],
  ] as const;
  return (
    <span className="inline-flex items-center gap-2.5">
      {items.map(([label, v]) => (
        <Tooltip key={label} content={`${label}: ${sigLabel[v] ?? v}`}>
          <span className={cn('inline-flex items-center gap-1 text-[11px]', v === 'attn' ? 'text-rose-600 dark:text-rose-400' : v === 'off' ? 'text-subtle' : 'text-muted')}>
            <Dot tone={sigTone[v] ?? 'muted'} pulse={v === 'attn'} />
            {!compact && label}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
