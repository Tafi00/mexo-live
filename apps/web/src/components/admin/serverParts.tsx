import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, ListVideo, Server as ServerIcon, Terminal } from 'lucide-react';
import { SERVER_STATE_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { fmtClock, fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';
import { useAction, useCopy } from '@/lib/hooks';
import { ServerStateBadge, SessionStateBadge, StreamStateBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Field, Input, Segmented, Textarea } from '@/components/ui/form';
import { Badge, Callout, EmptyState, PageLoading } from '@/components/ui/misc';
import { SecretBox, SecretDialog } from './common';

export interface ServerMetrics {
  cpu?: number;
  ram?: number;
  ramTotal?: number;
  netOutMbps?: number;
  diskUsed?: number;
  diskTotal?: number;
  load?: number;
}

export interface ServerRow {
  id: number;
  name: string;
  state: string;
  version: string | null;
  maxStreams: number;
  runningStreams: number;
  host: string | null;
  ip: string | null;
  metrics: ServerMetrics | null;
  lastHeartbeatAt: string | null;
  keyState: string;
  keyHint: string | null;
  keyExpiresAt: string | null;
  suspended: boolean;
  note: string | null;
  createdAt: string;
}

export interface ServersResponse {
  items: ServerRow[];
  counts: { all: number; online: number; attention: number; inactive: number };
  capacity: { used: number; total: number; online: number };
  canEdit: boolean;
  minVersion: string;
  lostAfterSeconds: number;
  apiUrl: string;
}

export function cmpVersion(a: string | null | undefined, b: string): number {
  const pa = String(a ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Giải thích từng trạng thái máy chủ phát */
export function serverStateHelp(lostAfterSeconds: number, minVersion: string): { state: string; text: string }[] {
  return [
    { state: 'online', text: 'Máy gửi tín hiệu đều đặn và đang nhận việc phát mới.' },
    { state: 'lost', text: `Không nhận được tín hiệu quá ${lostAfterSeconds} giây. Không giao việc mới; luồng đang chạy trên máy được tự chuyển sang máy khác còn trống (nếu có) sau khoảng 1 phút.` },
    { state: 'rejected', text: `Phiên bản MexoStreamer thấp hơn mức tối thiểu ${minVersion}. Máy được yêu cầu dừng mọi luồng — hãy cập nhật rồi khởi động lại.` },
    { state: 'pending', text: 'Đã tạo khóa nhưng máy chưa gửi tín hiệu lần nào. Kiểm tra cài đặt MEXO_API_URL / MEXO_SERVER_KEY trên máy.' },
    { state: 'suspended', text: 'Không nhận việc mới; các luồng đang chạy vẫn phát tiếp cho đến khi phiên kết thúc. Dùng khi cần bảo trì máy.' },
    { state: 'revoked', text: 'Khóa đã bị thu hồi, máy không kết nối được nữa và không nhận việc. Cấp khóa mới nếu muốn dùng lại máy này.' },
    { state: 'key_expired', text: 'Khóa có hạn 180 ngày và đã hết hạn. Cấp khóa mới, cập nhật trên máy rồi khởi động lại.' },
  ];
}

// ───────────── Hiện khóa máy chủ một lần + hướng dẫn cài đặt ─────────────
export function ServerKeyDialog({ data, apiUrl, onClose }: { data: { name: string; key: string; keyExpiresAt: string | null; rotated: boolean } | null; apiUrl: string; onClose: () => void }) {
  const copy = useCopy();
  const env = data ? `MEXO_API_URL=${apiUrl}\nMEXO_SERVER_KEY=${data.key}\n# Tùy chọn\nMAX_STREAMS=50\nSTREAMER_MODE=ffmpeg` : '';
  return (
    <SecretDialog
      open={Boolean(data)}
      onClose={onClose}
      title={data?.rotated ? `Khóa mới cho “${data?.name}”` : `Đã thêm máy chủ “${data?.name}”`}
      description={data?.keyExpiresAt ? `Khóa có hiệu lực đến ${fmtDate(data.keyExpiresAt)} (180 ngày).` : undefined}
      warning={
        <>
          Khóa máy chủ <b>chỉ hiện một lần</b> và không lưu dạng đọc được trên hệ thống. Nếu làm mất, phải cấp khóa mới. Không gửi khóa qua kênh công khai.
          {data?.rotated && <> Khóa cũ <b>đã ngừng hoạt động</b> — máy sẽ mất kết nối cho đến khi cập nhật khóa mới.</>}
        </>
      }
    >
      {data && (
        <div className="space-y-4">
          <SecretBox label="Khóa máy chủ (MEXO_SERVER_KEY)" value={data.key} />
          <div className="space-y-2 rounded-lg border border-line p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              <Terminal className="size-4" />
              Cài đặt MexoStreamer trên máy phát
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-muted">
              <li>
                Cài <b className="text-fg">Node.js 20+</b> và <b className="text-fg">FFmpeg</b> (bắt buộc ở chế độ <code className="font-mono text-xs">ffmpeg</code>; kiểm tra bằng <code className="font-mono text-xs">ffmpeg -version</code>).
              </li>
              <li>
                Tạo file <code className="font-mono text-xs">.env</code> trong thư mục MexoStreamer (hoặc đặt biến môi trường):
                <div className="relative mt-1.5">
                  <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 pr-12 font-mono text-xs leading-relaxed text-slate-100">{env}</pre>
                  <button type="button" onClick={() => void copy(env, 'Đã sao chép cấu hình')} className="absolute right-2 top-2 rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Sao chép cấu hình">
                    <Copy className="size-3.5" />
                  </button>
                </div>
                <span className="mt-1 block text-xs">
                  <code className="font-mono">MAX_STREAMS</code>: số luồng tối đa máy nhận (mặc định 50). <code className="font-mono">STREAMER_MODE</code>: <code className="font-mono">ffmpeg</code> (phát thật) hoặc <code className="font-mono">simulate</code> (chạy thử, không cần FFmpeg, không đẩy hình thật).
                </span>
              </li>
              <li>
                Chạy: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">node dist/index.js</code> hoặc trong mã nguồn <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">pnpm --filter @mexo/streamer start</code>.
              </li>
              <li>Trong vài giây máy sẽ chuyển sang “Đang kết nối” trên trang này.</li>
            </ol>
          </div>
        </div>
      )}
    </SecretDialog>
  );
}

// ───────────── Thêm / sửa máy chủ ─────────────
export function ServerFormDialog({ open, server, onClose, onCreated }: { open: boolean; server: ServerRow | null; onClose: () => void; onCreated?: (r: { id: number; key: string; keyExpiresAt: string | null; name: string }) => void }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(server?.name ?? '');
    setNote(server?.note ?? '');
  }, [open, server]);
  const save = useAction(
    async () => {
      if (server) {
        await api.patch(`/api/servers/${server.id}`, { name: name.trim(), note: note.trim() || null });
        return null;
      }
      return api.post<{ id: number; key: string; keyExpiresAt: string | null }>('/api/servers', { name: name.trim(), note: note.trim() || undefined });
    },
    {
      success: server ? 'Đã lưu máy chủ' : undefined,
      invalidate: [['servers'], ['shell']],
      onSuccess: (r) => {
        if (r && onCreated) onCreated({ ...r, name: name.trim() });
        onClose();
      },
    },
  );
  const invalid = !name.trim() || name.trim().length > 60;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <ServerIcon className="size-4" />
          {server ? `Sửa máy chủ — ${server.name}` : 'Thêm máy chủ phát'}
        </span>
      }
      description={server ? undefined : 'Hệ thống tạo khóa riêng cho máy này. Khóa chỉ hiện một lần sau khi tạo.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>
            {server ? 'Lưu' : 'Tạo máy chủ & khóa'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên máy chủ" required hint="Tên dễ nhận biết, vd: “VPS Hà Nội 01”. Tối đa 60 ký tự.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="Ghi chú" hint="Nhà cung cấp, cấu hình, người phụ trách…">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="min-h-[64px]" />
        </Field>
      </div>
    </Dialog>
  );
}

// ───────────── Danh sách luồng của máy ─────────────
interface JobRow {
  id: number;
  sessionId: number;
  shopId: number;
  desired: string;
  state: string;
  resumeIndex: number;
  videoIndex: number | null;
  positionSec: number | null;
  restarts: number;
  error: string | null;
  lastReportAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  sessionTitle: string;
  sessionState: string;
}

export function JobsDrawer({ server, onClose }: { server: ServerRow | null; onClose: () => void }) {
  const [filter, setFilter] = useState<'run' | 'all'>('run');
  const q = useQuery({
    queryKey: ['servers', server?.id, 'jobs'],
    queryFn: () => api.get<{ items: JobRow[] }>(`/api/servers/${server!.id}/jobs`),
    enabled: Boolean(server),
    refetchInterval: 5000,
  });
  const items = (q.data?.items ?? []).filter((j) => filter === 'all' || j.desired === 'run');
  const running = (q.data?.items ?? []).filter((j) => j.desired === 'run').length;
  return (
    <Sheet open={Boolean(server)} onClose={onClose} title={server ? `Luồng phát — ${server.name}` : ''} description={server ? `${SERVER_STATE_LABELS[server.state] ?? server.state} · ${server.runningStreams}/${server.maxStreams} luồng` : ''} width="max-w-2xl">
      <div className="-mx-5 -my-4">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <Segmented<'run' | 'all'>
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'run', label: 'Đang giao', count: running },
              { value: 'all', label: '200 gần nhất', count: q.data?.items.length },
            ]}
          />
          {server && <ServerStateBadge state={server.state} size="sm" />}
        </div>
        {q.isLoading ? (
          <PageLoading />
        ) : items.length ? (
          <ul className="divide-y divide-line">
            {items.map((j) => (
              <li key={j.id} className="space-y-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/sessions/${j.sessionId}`} className="min-w-0 truncate text-[13px] font-medium hover:text-brand-600" onClick={onClose}>
                    {j.sessionTitle || `Phiên #${j.sessionId}`}
                  </Link>
                  <span className="text-xs text-subtle">#{j.id}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <StreamStateBadge state={j.state} size="sm" />
                    <SessionStateBadge state={j.sessionState} size="sm" />
                  </span>
                </div>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <Link to={`/shops/${j.shopId}`} className="hover:text-fg hover:underline" onClick={onClose}>
                    Shop #{j.shopId}
                  </Link>
                  {j.videoIndex !== null && <span>Video {j.videoIndex + 1}{j.positionSec !== null ? ` · ${fmtClock(j.positionSec)}` : ''}</span>}
                  {j.restarts > 0 && <span className="text-amber-700 dark:text-amber-400">Khởi động lại {j.restarts} lần</span>}
                  {j.desired === 'stop' && (
                    <Badge tone="muted" size="sm">
                      Đã yêu cầu dừng
                    </Badge>
                  )}
                  <span title={fmtDateTime(j.lastReportAt)}>Báo cáo {fmtRelative(j.lastReportAt)}</span>
                  {j.startedAt && <span>Bắt đầu {fmtDateTime(j.startedAt)}</span>}
                </p>
                {j.error && <Callout tone="danger" className="py-2">{j.error}</Callout>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={ListVideo} title={filter === 'run' ? 'Máy không có luồng nào đang được giao' : 'Chưa có luồng nào'} />
        )}
      </div>
    </Sheet>
  );
}
