import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard,
  CloudUpload,
  Eye,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LayoutGrid,
  Link2,
  List,
  MoreHorizontal,
  PencilLine,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtClock, fmtDate, fmtPercent } from '@/lib/format';
import { useAction, useDebounced, useLocalState } from '@/lib/hooks';
import type { Video } from '@/lib/types';
import { VideoStatusBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Checkbox, SearchInput, Segmented, Select } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, ErrorState, Menu, Progress, Skeleton, Tabs, Tooltip, type MenuItem } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { fmtResolution, matchText, VIDEO_ACCEPT, videoFailText } from '@/components/catalog/labels';
import { bindQueryClient, enqueueUploads, isActivePhase, useUploads, type UploadItem } from '@/components/catalog/uploadStore';
import { BulkDeleteResultDialog, MoveVideosDialog, RenameVideoDialog, VideoDetailDialog, type BulkDeleteResult, type VideoFolder } from '@/components/catalog/VideoDialogs';
import { VideoThumb } from '@/components/catalog/VideoThumb';
import { useShop } from './ShopLayout';

type Status = Video['status'];
type StatusFilter = 'all' | Status;
type FolderSel = 'all' | 'none' | number;

interface VideoListRes {
  items: Video[];
  counts: Record<'all' | Status, number>;
  storage: { usedBytes: number; quotaBytes: number };
}

function shortRes(w: number | null, h: number | null) {
  if (!w || !h) return null;
  const p = Math.min(w, h);
  return `${p >= 2160 ? '4K' : `${p}p`}${h > w ? ' dọc' : ''}`;
}

/** Dòng phụ dưới tên video: tiến độ tải, lý do lỗi, hướng dẫn gắn lại */
function VideoNote({ v, up }: { v: Video; up: UploadItem | undefined }) {
  if (up && (isActivePhase(up.phase) || up.phase === 'paused')) {
    const pct = up.size ? Math.floor((up.uploaded / up.size) * 100) : 0;
    return (
      <div className="mt-1.5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span>{up.phase === 'paused' ? 'Tạm dừng' : up.relinked ? 'Đang gắn lại file gốc' : up.uploaded >= up.size ? 'Đang kiểm tra…' : 'Đang tải lên'}</span>
          <span className="tabular">{pct}%</span>
        </div>
        <Progress value={up.uploaded} max={up.size} size="sm" tone={up.phase === 'paused' ? 'warning' : 'brand'} />
      </div>
    );
  }
  if (v.status === 'uploading')
    return (
      <p className="mt-1 text-[11px] leading-snug text-sky-700 dark:text-sky-300">
        Tải dở {fmtPercent(v.sizeBytes ? v.uploadedBytes / v.sizeBytes : 0, 0)} — chọn lại đúng file để tiếp tục.
      </p>
    );
  if (v.status === 'missing_file')
    return (
      <p className="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
        {v.sourceFileName ? (
          <>
            Cần file gốc <span className="break-all font-mono">{v.sourceFileName}</span> ({fmtBytes(v.sizeBytes)})
          </>
        ) : (
          'Hệ thống cũ không lưu tên file gốc — tải video mới và thay trong mẫu phát.'
        )}
      </p>
    );
  if (v.status === 'failed') return <p className="mt-1 text-[11px] leading-snug text-rose-600 dark:text-rose-400">{videoFailText(v.failReason) ?? 'Video lỗi'}</p>;
  return null;
}

export default function ShopVideos() {
  const { shop } = useShop();
  const { can } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canManage = can('video.manage');
  const uploads = useUploads();
  useEffect(() => bindQueryClient(qc), [qc]);

  const [view, setView] = useLocalState<'grid' | 'list'>('mexo-video-view', 'grid');
  const [folder, setFolder] = useState<FolderSel>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<Video | null>(null);
  const [renaming, setRenaming] = useState<Video | null>(null);
  const [moving, setMoving] = useState<{ ids: number[]; current: number | null } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkDeleteResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const relinkRef = useRef<HTMLInputElement>(null);
  const relinkTarget = useRef<Video | null>(null);

  const list = useQuery({
    queryKey: ['shop', shop.id, 'videos', 'library'],
    queryFn: () => api.get<VideoListRes>(`/api/shops/${shop.id}/videos`),
    refetchInterval: (query) => (query.state.data?.items.some((v) => v.status === 'processing') ? 4000 : false),
  });
  const foldersQ = useQuery({
    queryKey: ['shop', shop.id, 'videos', 'folders'],
    queryFn: () => api.get<{ items: VideoFolder[] }>(`/api/shops/${shop.id}/video-folders`),
  });
  const folders = foldersQ.data?.items ?? [];
  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const storage = list.data?.storage;

  useEffect(() => setSelected(new Set()), [folder, status, dq]);
  useEffect(() => {
    if (typeof folder === 'number' && foldersQ.data && !folders.some((f) => f.id === folder)) setFolder('all');
  }, [folder, folders, foldersQ.data]);

  const upByVideo = useMemo(() => {
    const m = new Map<number, UploadItem>();
    for (const u of uploads) if (u.shopId === shop.id && u.videoId && u.phase !== 'cancelled') m.set(u.videoId, u);
    return m;
  }, [uploads, shop.id]);

  const inFolder = useMemo(() => all.filter((v) => (folder === 'all' ? true : folder === 'none' ? !v.folderId : v.folderId === folder)), [all, folder]);
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: inFolder.length, ready: 0, uploading: 0, processing: 0, missing_file: 0, failed: 0 };
    for (const v of inFolder) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [inFolder]);
  const folderCounts = useMemo(() => {
    const m = new Map<number | 'none', number>();
    for (const v of all) m.set(v.folderId ?? 'none', (m.get(v.folderId ?? 'none') ?? 0) + 1);
    return m;
  }, [all]);
  const filtered = useMemo(() => inFolder.filter((v) => (status === 'all' || v.status === status) && matchText(dq, v.name, v.sourceFileName, `#${v.number}`)), [inFolder, status, dq]);
  const missingTotal = list.data?.counts.missing_file ?? 0;
  const currentFolderId = typeof folder === 'number' ? folder : null;
  const currentFolderName = folder === 'all' ? 'Tất cả video' : folder === 'none' ? 'Chưa phân thư mục' : (folders.find((f) => f.id === folder)?.name ?? 'Thư mục');

  // ───────────── Tải lên ─────────────
  function startUpload(files: File[], folderId: number | null = currentFolderId) {
    if (!canManage || !files.length) return;
    const legacy = all.filter((v) => v.status === 'missing_file' && v.sourceFileName);
    for (const f of files) {
      const same = legacy.find((v) => v.sourceFileName === f.name);
      if (same && same.sizeBytes > 0 && same.sizeBytes !== f.size)
        toast.warning(`“${f.name}” trùng tên video cũ nhưng khác dung lượng`, {
          description: `Video cũ cần đúng ${fmtBytes(same.sizeBytes)}, file đã chọn ${fmtBytes(f.size)} — file này sẽ thành video mới, không gắn lại được.`,
        });
    }
    if (storage?.quotaBytes) {
      const total = files.reduce((s, f) => s + f.size, 0);
      if (storage.usedBytes + total > storage.quotaBytes) toast.warning('Có thể vượt dung lượng lưu trữ của shop', { description: `Còn trống ${fmtBytes(Math.max(0, storage.quotaBytes - storage.usedBytes))}, cần ${fmtBytes(total)}. File vượt hạn mức sẽ bị từ chối.` });
    }
    enqueueUploads(files, { shopId: shop.id, shopName: shop.name, folderId });
  }

  function pickRelink(v: Video) {
    relinkTarget.current = v;
    relinkRef.current?.click();
  }

  async function onRelinkPicked(f: File) {
    const v = relinkTarget.current;
    relinkTarget.current = null;
    if (!v) return;
    const nameOk = !v.sourceFileName || v.sourceFileName === f.name;
    const sizeOk = !v.sizeBytes || v.sizeBytes === f.size;
    if (!nameOk || !sizeOk) {
      const r = await confirm({
        title: 'File không khớp với video này',
        description: (
          <span>
            Video “{v.name}” cần đúng file <b className="break-all font-mono">{v.sourceFileName ?? '(không rõ tên)'}</b> ({fmtBytes(v.sizeBytes)}). File bạn chọn là <b className="break-all font-mono">{f.name}</b> ({fmtBytes(f.size)}), nên sẽ được tải lên thành <b>video mới</b>
            {v.status === 'missing_file' ? '; video cũ vẫn ở trạng thái “Chưa có file” và mẫu phát chưa được sửa.' : '.'}
          </span>
        ),
        confirmText: 'Vẫn tải lên thành video mới',
      });
      if (!r.ok) return;
    }
    setDetail(null);
    startUpload([f], v.folderId);
  }

  const onDragEnter = (e: DragEvent) => {
    if (!canManage || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current++;
    setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!canManage) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragOver(false);
  };
  const onDragOver = (e: DragEvent) => {
    if (!canManage || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    if (!canManage) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    startUpload(Array.from(e.dataTransfer.files));
  };

  // ───────────── Thư mục ─────────────
  const createFolder = async () => {
    const r = await confirm({ title: 'Tạo thư mục mới', input: { label: 'Tên thư mục', required: true, placeholder: 'vd: Son môi, Video tháng 11…' }, confirmText: 'Tạo thư mục' });
    if (!r.ok) return;
    try {
      const f = await api.post<VideoFolder>(`/api/shops/${shop.id}/video-folders`, { name: r.value.trim().slice(0, 60) });
      toast.success('Đã tạo thư mục');
      await qc.invalidateQueries({ queryKey: ['shop', shop.id, 'videos', 'folders'] });
      setFolder(f.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không tạo được thư mục');
    }
  };
  const renameFolder = useAction((p: { id: number; name: string }) => api.patch(`/api/shops/${shop.id}/video-folders/${p.id}`, { name: p.name }), {
    success: 'Đã đổi tên thư mục',
    invalidate: [['shop', shop.id, 'videos', 'folders']],
  });
  const deleteFolder = useAction((id: number) => api.del(`/api/shops/${shop.id}/video-folders/${id}`), {
    success: 'Đã xóa thư mục',
    invalidate: [['shop', shop.id, 'videos']],
    onSuccess: (_r, id) => folder === id && setFolder('all'),
  });
  const folderMenu = (f: VideoFolder): MenuItem[] => [
    {
      label: 'Đổi tên',
      icon: <PencilLine />,
      onClick: async () => {
        const r = await confirm({ title: 'Đổi tên thư mục', input: { label: 'Tên thư mục', required: true, defaultValue: f.name }, confirmText: 'Lưu' });
        if (r.ok && r.value.trim() && r.value.trim() !== f.name) renameFolder.mutate({ id: f.id, name: r.value.trim().slice(0, 60) });
      },
    },
    {
      label: 'Xóa thư mục',
      icon: <Trash2 />,
      danger: true,
      onClick: async () => {
        const n = folderCounts.get(f.id) ?? 0;
        const r = await confirm({
          title: `Xóa thư mục “${f.name}”?`,
          description: n ? `${n} video trong thư mục sẽ chuyển sang “Chưa phân thư mục”. Video không bị xóa.` : 'Thư mục đang trống.',
          danger: true,
          confirmText: 'Xóa thư mục',
        });
        if (r.ok) deleteFolder.mutate(f.id);
      },
    },
  ];

  // ───────────── Xóa video ─────────────
  const deleteOne = useAction((v: Video) => api.del(`/api/shops/${shop.id}/videos/${v.id}`), {
    success: 'Đã xóa video',
    invalidate: [['shop', shop.id, 'videos']],
  });
  const bulkDelete = useAction((ids: number[]) => api.post<BulkDeleteResult>(`/api/shops/${shop.id}/videos/bulk-delete`, { ids }), {
    invalidate: [['shop', shop.id, 'videos']],
    onSuccess: (r) => {
      setSelected(new Set());
      if (r.blocked.length) setBulkResult(r);
      else toast.success(`Đã xóa ${r.deleted.length} video`);
    },
  });
  async function askDelete(v: Video) {
    const r = await confirm({
      title: `Xóa video “${v.name}”?`,
      description: v.templateCount
        ? `Video đang nằm trong ${v.templateCount} mẫu phát nên hệ thống sẽ không cho xóa. Hãy gỡ video khỏi các mẫu đó trước.`
        : 'File video bị xóa vĩnh viễn khỏi kho lưu trữ và không khôi phục được.',
      danger: true,
      confirmText: v.templateCount ? 'Vẫn thử xóa' : 'Xóa video',
    });
    if (r.ok) deleteOne.mutate(v);
  }
  async function askBulkDelete() {
    const ids = [...selected];
    const used = all.filter((v) => selected.has(v.id) && v.templateCount > 0).length;
    const r = await confirm({
      title: `Xóa ${ids.length} video đã chọn?`,
      description: (
        <span>
          File video bị xóa vĩnh viễn và không khôi phục được.
          {used > 0 && (
            <>
              {' '}
              <b>{used}</b> video đang dùng trong mẫu phát sẽ được giữ lại.
            </>
          )}
        </span>
      ),
      danger: true,
      confirmText: `Xóa ${ids.length} video`,
    });
    if (r.ok) bulkDelete.mutate(ids);
  }

  const videoMenu = (v: Video): MenuItem[] => [
    { label: v.status === 'ready' ? 'Xem trước' : 'Xem chi tiết', icon: v.status === 'ready' ? <Play /> : <Eye />, onClick: () => setDetail(v) },
    { label: 'Đổi tên', icon: <PencilLine />, hidden: !canManage, onClick: () => setRenaming(v) },
    { label: 'Chuyển thư mục', icon: <FolderInput />, hidden: !canManage, onClick: () => setMoving({ ids: [v.id], current: v.folderId }) },
    {
      label: v.status === 'uploading' ? 'Chọn file để tải tiếp' : v.status === 'failed' ? 'Tải lại file' : 'Chọn file gốc để gắn lại',
      icon: v.status === 'missing_file' ? <Link2 /> : <RotateCcw />,
      hidden: !canManage || !['missing_file', 'failed', 'uploading'].includes(v.status) || upByVideo.has(v.id) || (v.status === 'missing_file' && !v.sourceFileName),
      onClick: () => pickRelink(v),
    },
    { divider: true, label: '', hidden: !canManage },
    { label: 'Xóa video', icon: <Trash2 />, danger: true, hidden: !canManage, onClick: () => void askDelete(v) },
  ];

  const toggleSel = (id: number, on: boolean) => {
    const n = new Set(selected);
    if (on) n.add(id);
    else n.delete(id);
    setSelected(n);
  };
  const allSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));

  const usedPct = storage?.quotaBytes ? storage.usedBytes / storage.quotaBytes : 0;
  const uploadingHere = uploads.filter((u) => u.shopId === shop.id && isActivePhase(u.phase)).length;

  const relinkAction = (v: Video, up: UploadItem | undefined): ReactNode =>
    canManage && !up && ['missing_file', 'failed', 'uploading'].includes(v.status) && !(v.status === 'missing_file' && !v.sourceFileName) ? (
      <Button size="xs" variant={v.status === 'missing_file' ? 'outline' : 'ghost'} className="mt-2" icon={v.status === 'missing_file' ? <Link2 className="size-3.5" /> : <RotateCcw className="size-3.5" />} onClick={() => pickRelink(v)}>
        {v.status === 'missing_file' ? 'Chọn file gốc' : v.status === 'uploading' ? 'Tải tiếp' : 'Tải lại'}
      </Button>
    ) : null;

  const folderButton = (key: FolderSel, label: string, count: number, icon: ReactNode, menu?: MenuItem[]) => (
    <div key={String(key)} className={cn('group/f flex items-center rounded-md', folder === key ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'text-fg hover:bg-surface-2')}>
      <button type="button" onClick={() => setFolder(key)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-[13px]">
        <span className={cn('shrink-0', folder === key ? 'text-brand-500' : 'text-muted')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[11px] tabular text-subtle">{count}</span>
      </button>
      {menu && canManage && (
        <Menu
          width="w-44"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="mr-1 rounded p-0.5 text-subtle opacity-0 hover:bg-surface-3 hover:text-fg group-hover/f:opacity-100 focus:opacity-100" aria-label="Tùy chọn thư mục">
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
          items={menu}
        />
      )}
    </div>
  );

  return (
    <div className="relative space-y-4" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/85 backdrop-blur-[1px] dark:bg-brand-950/70">
          <div className="text-center">
            <CloudUpload className="mx-auto size-10 text-brand-500" />
            <p className="mt-2 text-[15px] font-semibold text-brand-700 dark:text-brand-300">Thả file để tải lên</p>
            <p className="text-[13px] text-brand-700/80 dark:text-brand-300/80">Vào thư mục: {currentFolderId ? currentFolderName : 'Chưa phân thư mục'}</p>
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={VIDEO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          startUpload(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={relinkRef}
        type="file"
        accept={VIDEO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onRelinkPicked(f);
          e.target.value = '';
        }}
      />

      {/* Dung lượng + tải lên */}
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Card className="flex items-center gap-4 p-4">
          <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', usedPct >= 0.9 ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400' : 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400')}>
            <HardDrive className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[13px] font-semibold">Dung lượng lưu trữ</p>
              {storage ? (
                <p className="text-xs tabular text-muted">
                  <b className="font-semibold text-fg">{fmtBytes(storage.usedBytes)}</b> / {fmtBytes(storage.quotaBytes)} · {fmtPercent(usedPct, 0)}
                </p>
              ) : (
                <Skeleton className="h-3.5 w-32" />
              )}
            </div>
            <Progress value={storage?.usedBytes ?? 0} max={storage?.quotaBytes || 1} tone={usedPct >= 0.9 ? 'danger' : usedPct >= 0.75 ? 'warning' : 'info'} className="mt-2" />
            <p className="mt-1.5 text-[11px] text-muted">
              {list.data ? `${list.data.counts.all} video · ${list.data.counts.ready} sẵn sàng` : '…'}
              {usedPct >= 0.9 && ' · Sắp hết dung lượng, hãy xóa video không dùng.'}
            </p>
          </div>
        </Card>
        {canManage && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group flex items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-5 py-4 text-left shadow-card transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-950/20"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-500 text-white shadow-sm shadow-brand-500/30">
              <CloudUpload className="size-5" />
            </span>
            <span>
              <span className="block text-[13px] font-semibold">Tải video lên{uploadingHere ? ` · đang tải ${uploadingHere}` : ''}</span>
              <span className="block text-xs text-muted">Kéo thả nhiều file vào trang · MP4, MOV, MKV, WEBM, FLV, TS · ≤ 4 GB</span>
              <span className="block text-[11px] text-subtle">Mất mạng vẫn tải tiếp được từ chỗ dở</span>
            </span>
          </button>
        )}
      </div>

      {missingTotal > 0 && (
        <Callout
          tone="warning"
          icon={<Link2 className="size-4" />}
          title={`${missingTotal} video nhập từ hệ thống cũ chưa có file`}
          action={
            status !== 'missing_file' && (
              <Button
                size="sm"
                onClick={() => {
                  setFolder('all');
                  setStatus('missing_file');
                }}
              >
                Xem danh sách
              </Button>
            )
          }
        >
          Hệ thống cũ chỉ chuyển sang thông tin video, chưa có file. Hãy <b>tải lại đúng file gốc — cùng tên file và cùng dung lượng</b>: hệ thống tự nhận ra và gắn file vào video cũ, giữ nguyên tên, thư mục và các mẫu phát đang dùng video đó. Mẫu phát sẽ hợp lệ trở lại ngay khi tải xong. Có thể kéo thả nhiều file gốc cùng lúc.
        </Callout>
      )}

      <div className="flex items-start gap-4">
        {/* Cột thư mục */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <Card className="p-2">
            <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Thư mục</p>
              {canManage && (
                <Tooltip content="Tạo thư mục">
                  <button type="button" onClick={createFolder} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Tạo thư mục">
                    <FolderPlus className="size-4" />
                  </button>
                </Tooltip>
              )}
            </div>
            <div className="space-y-0.5">
              {folderButton('all', 'Tất cả video', all.length, <Clapperboard className="size-4" />)}
              {folderButton('none', 'Chưa phân thư mục', folderCounts.get('none') ?? 0, <Folder className="size-4" />)}
              {folders.length > 0 && <div className="mx-2 my-1.5 h-px bg-line" />}
              {folders.map((f) => folderButton(f.id, f.name, folderCounts.get(f.id) ?? 0, folder === f.id ? <FolderOpen className="size-4" /> : <Folder className="size-4" />, folderMenu(f)))}
            </div>
            {!folders.length && canManage && (
              <button type="button" onClick={createFolder} className="mt-2 w-full rounded-md border border-dashed border-line px-2 py-2 text-xs text-muted hover:border-line-strong hover:text-fg">
                + Tạo thư mục để sắp xếp video
              </button>
            )}
          </Card>
        </aside>

        <div className="min-w-0 flex-1">
          <Card>
            <div className="px-4 pt-2">
              <Tabs<StatusFilter>
                value={status}
                onChange={setStatus}
                items={[
                  { value: 'all', label: 'Tất cả', count: counts.all },
                  { value: 'ready', label: 'Sẵn sàng', count: counts.ready },
                  { value: 'uploading', label: 'Đang tải lên', count: counts.uploading, tone: 'info' },
                  ...(counts.processing ? [{ value: 'processing' as const, label: 'Đang xử lý', count: counts.processing, tone: 'info' as const }] : []),
                  { value: 'missing_file', label: 'Chưa có file', count: counts.missing_file, tone: 'warning' },
                  { value: 'failed', label: 'Lỗi', count: counts.failed, tone: 'danger' },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              {/* Chọn thư mục trên màn nhỏ */}
              <div className="flex w-full gap-2 lg:hidden">
                <Select
                  className="flex-1"
                  value={String(folder)}
                  onChange={(e) => setFolder(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}
                  aria-label="Thư mục"
                >
                  <option value="all">Tất cả video ({all.length})</option>
                  <option value="none">Chưa phân thư mục ({folderCounts.get('none') ?? 0})</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({folderCounts.get(f.id) ?? 0})
                    </option>
                  ))}
                </Select>
                {canManage && <Button iconOnly icon={<FolderPlus className="size-4" />} onClick={createFolder} aria-label="Tạo thư mục" />}
              </div>
              <SearchInput value={q} onChange={setQ} placeholder="Tên video, tên file gốc…" className="w-full sm:w-72" />
              <div className="ml-auto flex items-center gap-2">
                <Segmented
                  size="sm"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'grid', label: <LayoutGrid className="size-3.5" aria-label="Lưới" /> },
                    { value: 'list', label: <List className="size-3.5" aria-label="Danh sách" /> },
                  ]}
                />
                <Button iconOnly variant="ghost" icon={<RefreshCw className={cn('size-4', list.isFetching && 'animate-spin')} />} onClick={() => list.refetch()} aria-label="Làm mới" />
              </div>
            </div>

            {status === 'missing_file' && counts.missing_file > 0 && (
              <div className="border-b border-line bg-amber-50/60 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                Tìm trên máy các file có <b>đúng tên và dung lượng</b> như bên dưới, rồi kéo thả cùng lúc vào trang này — hệ thống tự gắn từng file vào đúng video cũ.
              </div>
            )}

            {canManage && selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50/60 px-4 py-2 dark:bg-brand-950/20">
                <span className="text-[13px] font-medium">Đã chọn {selected.size} video</span>
                <button onClick={() => setSelected(new Set())} className="rounded p-0.5 text-muted hover:text-fg" aria-label="Bỏ chọn">
                  <X className="size-4" />
                </button>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" icon={<FolderInput className="size-3.5" />} onClick={() => setMoving({ ids: [...selected], current: currentFolderId })}>
                    Chuyển thư mục
                  </Button>
                  <Button size="sm" variant="danger-outline" icon={<Trash2 className="size-3.5" />} loading={bulkDelete.isPending} onClick={() => void askBulkDelete()}>
                    Xóa
                  </Button>
                </div>
              </div>
            )}

            {list.isError ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : list.isLoading ? (
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-video" />
                ))}
              </div>
            ) : all.length === 0 ? (
              <EmptyState
                icon={CloudUpload}
                title="Thư viện video đang trống"
                description="Tải các video sẽ phát trong livestream. Kéo thả nhiều file vào trang này hoặc bấm nút bên dưới. Việc tải vẫn tiếp tục khi bạn chuyển sang trang khác trong ứng dụng."
                action={
                  canManage && (
                    <Button variant="primary" icon={<CloudUpload className="size-4" />} onClick={() => fileRef.current?.click()}>
                      Chọn video để tải lên
                    </Button>
                  )
                }
              />
            ) : filtered.length === 0 ? (
              <EmptyState compact icon={Clapperboard} title={dq ? 'Không tìm thấy video phù hợp' : 'Không có video trong mục này'} description={dq ? 'Thử từ khóa khác hoặc chọn “Tất cả video”.' : undefined} />
            ) : view === 'grid' ? (
              <div className="p-4">
                {canManage && (
                  <div className="mb-3">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={!allSelected && filtered.some((v) => selected.has(v.id))}
                      onChange={(on) => {
                        const n = new Set(selected);
                        filtered.forEach((v) => (on ? n.add(v.id) : n.delete(v.id)));
                        setSelected(n);
                      }}
                      label={<span className="text-xs text-muted">Chọn tất cả ({filtered.length})</span>}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {filtered.map((v) => {
                    const up = upByVideo.get(v.id);
                    const sel = selected.has(v.id);
                    const res = shortRes(v.width, v.height);
                    const folderName = v.folderId ? folders.find((f) => f.id === v.folderId)?.name : null;
                    return (
                      <div key={v.id} className={cn('group relative flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card transition-colors', sel ? 'border-brand-400 ring-1 ring-brand-400' : 'border-line hover:border-line-strong')}>
                        <VideoThumb shopId={shop.id} videoId={v.id} ready={v.status === 'ready'} className="aspect-video">
                          <button type="button" className="absolute inset-0 grid place-items-center" onClick={() => setDetail(v)} aria-label={v.status === 'ready' ? `Xem trước ${v.name}` : `Chi tiết ${v.name}`}>
                            {v.status === 'ready' && (
                              <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                <Play className="ml-0.5 size-5 fill-white" />
                              </span>
                            )}
                          </button>
                          {canManage && (
                            <span className={cn('absolute left-2 top-2 rounded bg-white/90 p-0.5 shadow transition-opacity dark:bg-slate-900/90', sel || selected.size ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                              <Checkbox checked={sel} onChange={(on) => toggleSel(v.id, on)} />
                            </span>
                          )}
                          {v.status !== 'ready' && (
                            <span className="absolute right-2 top-2">
                              <VideoStatusBadge status={v.status} size="sm" />
                            </span>
                          )}
                          {v.durationSec ? <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-px text-[11px] font-medium tabular text-white">{fmtClock(v.durationSec)}</span> : null}
                          {res && <span className="absolute bottom-2 left-2 rounded bg-black/55 px-1.5 py-px text-[10px] font-medium text-white/90">{res}</span>}
                        </VideoThumb>
                        <div className="flex flex-1 flex-col p-3">
                          <div className="flex items-start gap-1.5">
                            <p className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-snug" title={v.name}>
                              {v.name}
                            </p>
                            <Menu
                              width="w-52"
                              trigger={({ toggle }) => (
                                <button type="button" onClick={toggle} className="-mr-1 -mt-0.5 rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Thao tác">
                                  <MoreHorizontal className="size-4" />
                                </button>
                              )}
                              items={videoMenu(v)}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-muted">
                            #{v.number} · {fmtBytes(v.sizeBytes)} · {fmtDate(v.createdAt)}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {v.templateCount > 0 && (
                              <Badge tone="brand" size="sm">
                                Trong {v.templateCount} mẫu phát
                              </Badge>
                            )}
                            {folder === 'all' && folderName && (
                              <Badge tone="muted" size="sm" icon={<Folder className="size-3" />}>
                                {folderName}
                              </Badge>
                            )}
                          </div>
                          <VideoNote v={v} up={up} />
                          {relinkAction(v, up)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Table minWidth={980}>
                <THead>
                  <tr>
                    {canManage && (
                      <Th className="w-10">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={!allSelected && filtered.some((v) => selected.has(v.id))}
                          onChange={(on) => {
                            const n = new Set(selected);
                            filtered.forEach((v) => (on ? n.add(v.id) : n.delete(v.id)));
                            setSelected(n);
                          }}
                        />
                      </Th>
                    )}
                    <Th className="w-12">#</Th>
                    <Th>Video</Th>
                    <Th>Trạng thái</Th>
                    <Th align="right">Thời lượng</Th>
                    <Th>Độ phân giải</Th>
                    <Th align="right">Dung lượng</Th>
                    <Th>Mẫu phát</Th>
                    <Th>Ngày tải lên</Th>
                    <Th className="w-10" />
                  </tr>
                </THead>
                <tbody>
                  {filtered.map((v) => {
                    const up = upByVideo.get(v.id);
                    return (
                      <Tr key={v.id} selected={selected.has(v.id)}>
                        {canManage && (
                          <Td>
                            <Checkbox checked={selected.has(v.id)} onChange={(on) => toggleSel(v.id, on)} />
                          </Td>
                        )}
                        <Td className="text-xs tabular text-subtle">{v.number}</Td>
                        <Td className="max-w-[360px]">
                          <div className="flex items-start gap-3">
                            <button type="button" onClick={() => setDetail(v)} className="shrink-0" aria-label={`Xem ${v.name}`}>
                              <VideoThumb shopId={shop.id} videoId={v.id} ready={v.status === 'ready'} className="h-9 w-16 rounded-md" iconClassName="size-4" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <button type="button" onClick={() => setDetail(v)} className="block max-w-full truncate text-left font-medium hover:text-brand-600" title={v.name}>
                                {v.name}
                              </button>
                              {v.sourceFileName && <p className="truncate font-mono text-[11px] text-subtle">{v.sourceFileName}</p>}
                              <VideoNote v={v} up={up} />
                              {relinkAction(v, up)}
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <VideoStatusBadge status={v.status} size="sm" />
                        </Td>
                        <Td align="right" className="tabular">
                          {fmtClock(v.durationSec)}
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-muted">{fmtResolution(v.width, v.height)}</Td>
                        <Td align="right" className="whitespace-nowrap tabular">
                          {fmtBytes(v.sizeBytes)}
                        </Td>
                        <Td>{v.templateCount ? <Badge tone="brand" size="sm">{v.templateCount} mẫu</Badge> : <span className="text-xs text-subtle">—</span>}</Td>
                        <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(v.createdAt)}</Td>
                        <Td>
                          <Menu
                            width="w-52"
                            trigger={({ toggle }) => (
                              <button type="button" onClick={toggle} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Thao tác">
                                <MoreHorizontal className="size-4" />
                              </button>
                            )}
                            items={videoMenu(v)}
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          {!canManage && <p className="mt-2 px-1 text-xs text-muted">Bạn chỉ có quyền xem thư viện. Cần quyền “Tải lên và quản lý video” để tải lên, đổi tên hoặc xóa.</p>}
        </div>
      </div>

      <VideoDetailDialog shopId={shop.id} video={detail} folders={folders} onClose={() => setDetail(null)} onRelink={canManage ? pickRelink : undefined} />
      <RenameVideoDialog shopId={shop.id} video={renaming} all={all} onClose={() => setRenaming(null)} />
      <MoveVideosDialog shopId={shop.id} ids={moving?.ids ?? null} folders={folders} currentFolderId={moving?.current ?? null} onClose={() => setMoving(null)} onDone={() => setSelected(new Set())} />
      <BulkDeleteResultDialog result={bulkResult} onClose={() => setBulkResult(null)} />
    </div>
  );
}
