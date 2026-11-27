import { useEffect, useState } from 'react';
import { Ban, Folder, FolderOpen, Link2 } from 'lucide-react';
import { LIMITS } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtClock, fmtDateTime, fmtDuration } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { Video } from '@/lib/types';
import { VideoStatusBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Badge, Callout, KV } from '@/components/ui/misc';
import { fmtResolution, validateVideoName, videoFailText } from './labels';

export interface VideoFolder {
  id: number;
  shopId: number;
  name: string;
  createdAt: string;
}

export interface BulkDeleteResult {
  deleted: number[];
  blocked: { id: number; name: string; templates: string[] }[];
}

// ───────────── Đổi tên ─────────────
export function RenameVideoDialog({ shopId, video, all, onClose }: { shopId: number; video: Video | null; all: Video[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (video) {
      setName(video.name);
      setTouched(false);
    }
  }, [video]);
  const error = video ? validateVideoName(name, all, video.id) : null;
  const save = useAction(() => api.patch(`/api/shops/${shopId}/videos/${video!.id}`, { name: name.trim() }), {
    success: 'Đã đổi tên video',
    invalidate: [
      ['shop', shopId, 'videos'],
      ['shop', shopId, 'templates'],
    ],
    onSuccess: onClose,
  });
  const unchanged = video ? name.trim() === video.name : true;
  return (
    <Dialog
      open={Boolean(video)}
      onClose={onClose}
      title="Đổi tên video"
      description="Tên dùng để tìm kiếm, hiển thị trong mẫu phát và để khớp video khi sao chép mẫu sang shop khác."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={Boolean(error) || unchanged} onClick={() => save.mutate()}>
            Lưu tên
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!error && !unchanged) save.mutate();
        }}
      >
        <Field
          label="Tên video"
          required
          error={touched || name !== video?.name ? error : null}
          hint="Không chứa < > |, không kết thúc bằng dấu chấm, không trùng tên video khác trong shop."
          aside={<span className={cn('text-2xs tabular', name.trim().length > LIMITS.videoNameMax ? 'text-rose-600' : 'text-subtle')}>{name.trim().length}/{LIMITS.videoNameMax}</span>}
        >
          <Input autoFocus value={name} invalid={Boolean(error) && touched} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        {video?.sourceFileName && <p className="mt-3 text-xs text-muted">Tên file gốc: <span className="font-mono">{video.sourceFileName}</span> (không đổi)</p>}
      </form>
    </Dialog>
  );
}

// ───────────── Chuyển thư mục ─────────────
export function MoveVideosDialog({ shopId, ids, folders, currentFolderId, onClose, onDone }: { shopId: number; ids: number[] | null; folders: VideoFolder[]; currentFolderId: number | null; onClose: () => void; onDone?: () => void }) {
  const [target, setTarget] = useState<number | null>(null);
  useEffect(() => {
    if (ids) setTarget(currentFolderId);
  }, [ids, currentFolderId]);
  const move = useAction(
    async () => {
      for (const id of ids ?? []) await api.patch(`/api/shops/${shopId}/videos/${id}`, { folderId: target });
      return ids?.length ?? 0;
    },
    {
      success: (n) => `Đã chuyển ${n} video`,
      invalidate: [['shop', shopId, 'videos']],
      onSuccess: () => {
        onDone?.();
        onClose();
      },
    },
  );
  const options: { id: number | null; name: string }[] = [{ id: null, name: 'Chưa phân thư mục' }, ...folders.map((f) => ({ id: f.id, name: f.name }))];
  return (
    <Dialog
      open={Boolean(ids)}
      onClose={onClose}
      title={ids && ids.length > 1 ? `Chuyển ${ids.length} video sang thư mục` : 'Chuyển thư mục'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={move.isPending} onClick={() => move.mutate()}>
            Chuyển
          </Button>
        </>
      }
    >
      <div className="max-h-[50vh] space-y-1 overflow-y-auto">
        {options.map((o) => (
          <button
            key={o.id ?? 'none'}
            type="button"
            onClick={() => setTarget(o.id)}
            className={cn('flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors', target === o.id ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-400 dark:bg-brand-950/20' : 'border-line hover:bg-surface-2')}
          >
            {target === o.id ? <FolderOpen className="size-4 text-brand-500" /> : <Folder className="size-4 text-muted" />}
            <span className={cn('flex-1 truncate', o.id === null && 'text-muted')}>{o.name}</span>
            {o.id === currentFolderId && <span className="text-2xs text-subtle">Hiện tại</span>}
          </button>
        ))}
        {!folders.length && <p className="px-1 pt-2 text-xs text-muted">Chưa có thư mục nào. Tạo thư mục ở cột bên trái thư viện.</p>}
      </div>
    </Dialog>
  );
}

// ───────────── Xem trước / chi tiết ─────────────
export function VideoDetailDialog({ shopId, video, folders, onClose, onRelink }: { shopId: number; video: Video | null; folders: VideoFolder[]; onClose: () => void; onRelink?: (v: Video) => void }) {
  if (!video) return null;
  const ready = video.status === 'ready';
  const folder = folders.find((f) => f.id === video.folderId);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{video.name}</span>
          <VideoStatusBadge status={video.status} size="sm" />
        </span>
      }
      description={`#${video.number} · ${fmtClock(video.durationSec)} · ${fmtResolution(video.width, video.height)}`}
    >
      <div className="space-y-4">
        {ready ? (
          <video key={video.id} src={`/api/shops/${shopId}/videos/${video.id}/file`} controls autoPlay playsInline className="max-h-[62vh] w-full rounded-lg bg-black" />
        ) : (
          <Callout tone={video.status === 'failed' ? 'danger' : video.status === 'missing_file' ? 'warning' : 'info'} title="Video chưa phát được" action={onRelink && video.status !== 'processing' && <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => onRelink(video)}>Chọn file gốc</Button>}>
            {video.status === 'uploading'
              ? `Đang tải lên hoặc tải dở (${fmtBytes(video.uploadedBytes)} / ${fmtBytes(video.sizeBytes)}). Chọn lại đúng file đó để tiếp tục.`
              : (videoFailText(video.failReason) ?? 'Video đang được xử lý.')}
          </Callout>
        )}
        <KV
          cols={3}
          items={[
            { label: 'Tên file gốc', value: <span className="break-all font-mono text-xs">{video.sourceFileName ?? '—'}</span> },
            { label: 'Dung lượng', value: fmtBytes(video.sizeBytes) },
            { label: 'Thời lượng', value: video.durationSec ? `${fmtClock(video.durationSec)} (${fmtDuration(video.durationSec)})` : '—' },
            { label: 'Độ phân giải', value: fmtResolution(video.width, video.height) },
            { label: 'Mã hóa', value: video.codec ?? '—' },
            { label: 'Thư mục', value: folder?.name ?? 'Chưa phân thư mục' },
            { label: 'Ngày tải lên', value: fmtDateTime(video.createdAt) },
            { label: 'Cập nhật', value: fmtDateTime(video.updatedAt) },
            {
              label: 'Mẫu phát sử dụng',
              value: video.templateCount ? (
                <Badge tone="brand" size="sm">
                  {video.templateCount} mẫu phát
                </Badge>
              ) : (
                <span className="text-muted">Chưa dùng</span>
              ),
            },
          ]}
        />
      </div>
    </Dialog>
  );
}

// ───────────── Kết quả xóa hàng loạt ─────────────
export function BulkDeleteResultDialog({ result, onClose }: { result: BulkDeleteResult | null; onClose: () => void }) {
  return (
    <Dialog
      open={Boolean(result)}
      onClose={onClose}
      title="Kết quả xóa video"
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Đã hiểu
        </Button>
      }
    >
      {result && (
        <div className="space-y-3">
          <p className="text-sm">
            Đã xóa <b>{result.deleted.length}</b> video.{' '}
            {result.blocked.length > 0 && (
              <>
                <b className="text-amber-700 dark:text-amber-400">{result.blocked.length}</b> video được giữ lại vì đang nằm trong mẫu phát:
              </>
            )}
          </p>
          {result.blocked.length > 0 && (
            <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {result.blocked.map((b) => (
                <li key={b.id} className="flex items-start gap-2.5 px-3 py-2">
                  <Ban className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.name}</p>
                    <p className="text-xs text-muted">Dùng trong: {b.templates.join(', ')}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {result.blocked.length > 0 && <p className="text-xs text-muted">Gỡ video khỏi các mẫu phát trên (hoặc thay video khác) rồi xóa lại.</p>}
        </div>
      )}
    </Dialog>
  );
}
