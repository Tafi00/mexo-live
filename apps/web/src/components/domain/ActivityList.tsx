import { ACTIVITY_LABELS } from '@mexo/shared';
import { fmtDateTime } from '@/lib/format';
import type { ActivityRow } from '@/lib/types';
import { Avatar, Badge, EmptyState } from '@/components/ui/misc';
import { ScrollText } from 'lucide-react';

/** Diễn giải tham số nhật ký thành câu dễ đọc */
export function describeActivity(a: ActivityRow): string {
  const p = a.params ?? {};
  const s = (k: string) => (p[k] === undefined || p[k] === null ? '' : String(p[k]));
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v === 'none' ? 'không thời hạn' : v);
  switch (a.code) {
    case 'service_expiry_set':
      return `${date(s('from') || 'none')} → ${date(s('to') || 'none')}`;
    case 'alias_set':
      return s('alias') && s('alias') !== 'set' ? `“${s('alias')}”` : '';
    case 'suspended':
      return s('reason');
    case 'reopened':
      return `hạn mới ${date(s('to'))}`;
    case 'session_created':
    case 'session_ended':
    case 'session_started':
      return [s('title'), s('sessionId') && `#${s('sessionId')}`, s('reason') && `(${s('reason')})`].filter(Boolean).join(' ');
    case 'stream_started':
      return [s('template') && `mẫu “${s('template')}”`, s('server') && `máy ${s('server')}`].filter(Boolean).join(', ');
    case 'video_uploaded':
    case 'video_deleted':
    case 'template_created':
    case 'template_updated':
    case 'template_deleted':
      return s('name');
    case 'video_renamed':
      return `“${s('from')}” → “${s('to')}”`;
    case 'schedule_created':
    case 'schedule_updated':
    case 'schedule_paused':
    case 'schedule_resumed':
    case 'schedule_cancelled':
      return [s('title'), s('time')].filter(Boolean).join(' ');
    case 'products_synced':
      return `${s('count')} sản phẩm`;
    case 'role_changed':
      return `${s('from')} → ${s('to')}`;
    case 'connected':
      return s('role') ? `bởi ${s('role') === 'admin' ? 'quản trị viên' : s('role')}` : '';
    case 'owner_set':
      return s('verification') ? `xác minh: ${s('verification')}` : '';
    case 'system_frozen':
      return s('reason');
    default:
      return '';
  }
}

export function ActivityList({ items, showShop }: { items: ActivityRow[]; showShop?: boolean }) {
  if (!items.length) return <EmptyState compact icon={ScrollText} title="Chưa có nhật ký" />;
  return (
    <ol className="divide-y divide-line">
      {items.map((a) => {
        const detail = describeActivity(a);
        return (
          <li key={a.id} className="flex items-start gap-3 px-4 py-3">
            <Avatar name={a.actorName} className="mt-0.5 size-7 text-2xs" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <b className="font-semibold">{a.actorName}</b> <span className="text-muted">·</span> {ACTIVITY_LABELS[a.code] ?? a.label ?? a.code}
                {detail && <span className="text-muted"> — {detail}</span>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                {fmtDateTime(a.at, { seconds: true })}
                {showShop && a.shopName && <span>· {a.shopName}</span>}
                {a.targetUsername && <span>· @{a.targetUsername}</span>}
                {Boolean(a.params?.legacy) && (
                  <Badge tone="muted" size="sm">
                    Hệ thống cũ
                  </Badge>
                )}
                {a.ip && <span className="font-mono text-2xs text-subtle">{a.ip}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
