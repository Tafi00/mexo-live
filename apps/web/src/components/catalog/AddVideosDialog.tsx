import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtClock } from '@/lib/format';
import type { Video } from '@/lib/types';
import { VideoStatusBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, SearchInput } from '@/components/ui/form';
import { Badge, EmptyState, Spinner } from '@/components/ui/misc';
import { fmtResolution, matchText } from './labels';
import { VideoThumb } from './VideoThumb';

/**
 * Chọn video trong thư viện để đưa vào mẫu phát.
 * Chỉ video "Sẵn sàng" được chọn; thứ tự thêm theo thứ tự bấm chọn.
 */
export function AddVideosDialog({
  shopId,
  open,
  onClose,
  videos,
  loading,
  usage,
  multiple = true,
  title,
  onPick,
}: {
  shopId: number;
  open: boolean;
  onClose: () => void;
  videos: Video[];
  loading?: boolean;
  /** videoId → số lần đã có trong mẫu */
  usage: Map<number, number>;
  multiple?: boolean;
  title?: string;
  onPick: (v: Video[]) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Video[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (open) {
      setQ('');
      setSel([]);
      setShowAll(false);
    }
  }, [open]);

  const list = useMemo(() => videos.filter((v) => (showAll || v.status === 'ready') && matchText(q, v.name, v.sourceFileName, `#${v.number}`)), [videos, showAll, q]);
  const readyInList = list.filter((v) => v.status === 'ready');
  const notReady = videos.filter((v) => v.status !== 'ready').length;
  const selIds = new Set(sel.map((v) => v.id));
  const allSel = readyInList.length > 0 && readyInList.every((v) => selIds.has(v.id));
  const totalSec = sel.reduce((s, v) => s + (v.durationSec ?? 0), 0);

  function toggle(v: Video) {
    if (v.status !== 'ready') return;
    if (!multiple) {
      onPick([v]);
      onClose();
      return;
    }
    setSel((cur) => (cur.some((x) => x.id === v.id) ? cur.filter((x) => x.id !== v.id) : [...cur, v]));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title ?? 'Thêm video từ thư viện'}
      description="Chỉ chọn được video đã sẵn sàng. Video được thêm vào cuối danh sách theo thứ tự bạn chọn."
      size="lg"
      footer={
        multiple && (
          <>
            <span className="mr-auto text-xs text-muted">
              Đã chọn {sel.length} video{sel.length ? ` · ${fmtClock(totalSec)}` : ''}
            </span>
            <Button variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button
              variant="primary"
              disabled={!sel.length}
              onClick={() => {
                onPick(sel);
                onClose();
              }}
            >
              Thêm {sel.length || ''} video
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tên video, tên file…" autoFocus className="min-w-0 flex-1" />
          {notReady > 0 && <Checkbox checked={showAll} onChange={setShowAll} label={<span className="text-xs text-muted">Hiện cả {notReady} video chưa sẵn sàng</span>} />}
        </div>
        {multiple && readyInList.length > 1 && (
          <Checkbox
            checked={allSel}
            indeterminate={!allSel && readyInList.some((v) => selIds.has(v.id))}
            onChange={(on) => setSel((cur) => (on ? [...cur, ...readyInList.filter((v) => !cur.some((x) => x.id === v.id))] : cur.filter((x) => !readyInList.some((v) => v.id === x.id))))}
            label={<span className="text-xs text-muted">Chọn tất cả kết quả ({readyInList.length})</span>}
          />
        )}
        <div className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {loading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : !list.length ? (
            <EmptyState
              compact
              icon={Clapperboard}
              title={videos.length ? 'Không có video phù hợp' : 'Thư viện chưa có video sẵn sàng'}
              description={
                <Link to={`/shops/${shopId}/videos`} className="text-brand-600 hover:underline dark:text-brand-400">
                  Mở Thư viện video để tải lên
                </Link>
              }
            />
          ) : (
            list.map((v) => {
              const ready = v.status === 'ready';
              const order = sel.findIndex((x) => x.id === v.id);
              const used = usage.get(v.id) ?? 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={!ready}
                  onClick={() => toggle(v)}
                  className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55', order >= 0 ? 'bg-brand-50/70 dark:bg-brand-950/30' : 'hover:bg-surface-2')}
                >
                  {multiple && (
                    <span className={cn('grid size-5 shrink-0 place-items-center rounded border text-[10px] font-bold', order >= 0 ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>
                      {order >= 0 ? order + 1 : null}
                    </span>
                  )}
                  <VideoThumb shopId={shopId} videoId={v.id} ready={ready} className="h-10 w-[72px] shrink-0 rounded-md" iconClassName="size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{v.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-muted">
                      <span className="tabular">{fmtClock(v.durationSec)}</span>
                      <span>{fmtResolution(v.width, v.height)}</span>
                      <span>{fmtBytes(v.sizeBytes)}</span>
                    </span>
                  </span>
                  {!ready ? (
                    <VideoStatusBadge status={v.status} size="sm" />
                  ) : used > 0 ? (
                    <Badge tone="muted" size="sm">
                      Đã có{used > 1 ? ` ×${used}` : ''}
                    </Badge>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <p className="text-[11px] text-subtle">Một video có thể xuất hiện nhiều lần trong danh sách phát nếu cần.</p>
      </div>
    </Dialog>
  );
}
