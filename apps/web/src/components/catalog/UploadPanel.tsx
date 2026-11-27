import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clapperboard, Link2, Loader2, Pause, Play, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtDuration } from '@/lib/format';
import { Badge, Progress, Tooltip } from '@/components/ui/misc';
import { videoFailText } from './labels';
import { cancelUpload, clearFinishedUploads, dismissUpload, isActivePhase, pauseUpload, resumeUpload, useUploads, type UploadItem } from './uploadStore';

/**
 * Bảng tiến độ tải lên nổi ở góc màn hình.
 * Gắn vào một React root riêng trên document.body nên vẫn hiển thị khi chuyển trang trong ứng dụng.
 */
let mounted = false;
export function ensureUploadPanel() {
  if (mounted || typeof document === 'undefined') return;
  const w = window as unknown as { __mexoUploadPanel?: boolean };
  mounted = true;
  if (w.__mexoUploadPanel) return;
  w.__mexoUploadPanel = true;
  const el = document.createElement('div');
  el.id = 'mexo-upload-panel';
  document.body.appendChild(el);
  createRoot(el).render(<UploadPanel />);
}

function phaseText(it: UploadItem): string {
  switch (it.phase) {
    case 'queued':
      return 'Đang chờ…';
    case 'probing':
      return 'Đang đọc thông tin video…';
    case 'starting':
      return it.retryIn ? `Mất kết nối — thử lại sau ${it.retryIn} giây` : 'Đang chuẩn bị…';
    case 'uploading': {
      if (it.retryIn) return `Mất kết nối — thử lại sau ${it.retryIn} giây`;
      if (it.uploaded >= it.size) return 'Đang kiểm tra video…';
      const parts = [`${fmtBytes(it.uploaded)} / ${fmtBytes(it.size)}`];
      if (it.speed > 0) {
        parts.push(`${fmtBytes(it.speed)}/giây`);
        parts.push(`còn ${fmtDuration((it.size - it.uploaded) / it.speed)}`);
      }
      return parts.join(' · ');
    }
    case 'paused':
      return `Tạm dừng ở ${fmtBytes(it.uploaded)} / ${fmtBytes(it.size)}`;
    case 'done':
      return `Hoàn tất · ${fmtBytes(it.size)}`;
    case 'failed':
      return videoFailText(it.failReason) ?? 'Video không hợp lệ';
    case 'error':
      return it.error ?? 'Lỗi tải lên';
    case 'cancelled':
      return 'Đã hủy';
  }
}

function Row({ it }: { it: UploadItem }) {
  const [askCancel, setAskCancel] = useState(false);
  const active = isActivePhase(it.phase);
  const pct = it.size ? Math.floor((it.uploaded / it.size) * 100) : 0;
  const tone = it.phase === 'done' ? 'success' : it.phase === 'failed' || it.phase === 'error' ? 'danger' : it.phase === 'paused' || it.retryIn ? 'warning' : 'brand';
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md',
            it.phase === 'done'
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
              : it.phase === 'failed' || it.phase === 'error'
                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                : 'bg-surface-2 text-muted',
          )}
        >
          {it.phase === 'done' ? <CheckCircle2 className="size-4" /> : it.phase === 'failed' || it.phase === 'error' ? <CircleAlert className="size-4" /> : active ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={it.fileName}>
              {it.fileName}
            </p>
            {active && <span className="shrink-0 text-xs font-medium tabular text-muted">{pct}%</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {it.shopName && <span className="max-w-[140px] truncate text-2xs text-subtle">{it.shopName}</span>}
            {it.relinked && (
              <Badge tone="violet" size="sm" icon={<Link2 className="size-3" />}>
                Gắn lại video cũ
              </Badge>
            )}
            {it.resumed && it.resumedFrom > 0 && (
              <Badge tone="info" size="sm">
                Tiếp tục từ {Math.floor((it.resumedFrom / Math.max(1, it.size)) * 100)}%
              </Badge>
            )}
          </div>
          {(active || it.phase === 'paused') && <Progress value={it.uploaded} max={it.size} tone={tone} size="sm" className="mt-1.5" />}
          <p className={cn('mt-1 text-2xs leading-snug', it.phase === 'failed' || it.phase === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-muted')}>{phaseText(it)}</p>
          {askCancel && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-rose-50 px-2 py-1.5 text-2xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <span className="flex-1">{it.relinked || it.resumed ? 'Dừng tải? Phần đã tải được giữ để tiếp tục sau.' : 'Hủy tải lên và xóa phần đã tải?'}</span>
              <button className="font-semibold hover:underline" onClick={() => cancelUpload(it.id)}>
                Hủy tải
              </button>
              <button className="text-rose-700/70 hover:underline dark:text-rose-300/70" onClick={() => setAskCancel(false)}>
                Không
              </button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {active && (
            <Tooltip content="Tạm dừng">
              <button className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" onClick={() => pauseUpload(it.id)} aria-label="Tạm dừng">
                <Pause className="size-3.5" />
              </button>
            </Tooltip>
          )}
          {it.phase === 'paused' && (
            <Tooltip content="Tiếp tục">
              <button className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" onClick={() => resumeUpload(it.id)} aria-label="Tiếp tục">
                <Play className="size-3.5" />
              </button>
            </Tooltip>
          )}
          {(it.phase === 'error' || it.phase === 'cancelled') && (
            <Tooltip content={it.phase === 'error' ? 'Thử lại' : 'Tải lại'}>
              <button className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" onClick={() => resumeUpload(it.id)} aria-label="Thử lại">
                <RotateCcw className="size-3.5" />
              </button>
            </Tooltip>
          )}
          {active || it.phase === 'paused' ? (
            <Tooltip content="Hủy">
              <button className="rounded p-1 text-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" onClick={() => setAskCancel(true)} aria-label="Hủy tải lên">
                <X className="size-3.5" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Ẩn">
              <button className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" onClick={() => dismissUpload(it.id)} aria-label="Ẩn khỏi danh sách">
                <X className="size-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

export function UploadPanel() {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  const stats = useMemo(() => {
    const active = items.filter((i) => isActivePhase(i.phase));
    const done = items.filter((i) => i.phase === 'done').length;
    const bad = items.filter((i) => i.phase === 'failed' || i.phase === 'error').length;
    const total = active.reduce((s, i) => s + i.size, 0);
    const up = active.reduce((s, i) => s + i.uploaded, 0);
    const speed = active.reduce((s, i) => s + i.speed, 0);
    return { active: active.length, done, bad, total, up, speed, paused: items.filter((i) => i.phase === 'paused').length };
  }, [items]);
  if (!items.length) return null;

  const title = stats.active ? `Đang tải ${stats.active} video` : stats.paused ? `${stats.paused} video tạm dừng` : stats.bad ? `${stats.bad} video gặp lỗi` : `Đã tải xong ${stats.done} video`;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(380px,calc(100vw-2rem))] animate-slide-up overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-pop">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          {stats.active > 0 ? (
            <p className="text-2xs tabular text-muted">
              {fmtBytes(stats.up)} / {fmtBytes(stats.total)}
              {stats.speed > 0 && ` · ${fmtBytes(stats.speed)}/giây`}
            </p>
          ) : (
            <p className="text-2xs text-muted">
              {stats.done} hoàn tất{stats.bad ? ` · ${stats.bad} lỗi` : ''}
            </p>
          )}
        </div>
        {!stats.active && stats.done > 0 && (
          <button className="rounded px-1.5 py-1 text-2xs font-medium text-muted hover:bg-surface-3 hover:text-fg" onClick={clearFinishedUploads}>
            Xóa mục đã xong
          </button>
        )}
        <button className="rounded p-1 text-subtle hover:bg-surface-3 hover:text-fg" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'}>
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
      {stats.active > 0 && <Progress value={stats.up} max={stats.total || 1} size="sm" className="rounded-none" />}
      {!collapsed && (
        <>
          <div className="max-h-[320px] divide-y divide-line overflow-y-auto">
            {items
              .slice()
              .reverse()
              .map((it) => (
                <Row key={it.id} it={it} />
              ))}
          </div>
          {stats.active > 0 && <p className="border-t border-line bg-surface-2/40 px-3 py-2 text-2xs text-muted">Có thể chuyển sang trang khác trong ứng dụng, việc tải vẫn tiếp tục. Đừng đóng hoặc tải lại tab này.</p>}
        </>
      )}
    </div>
  );
}
