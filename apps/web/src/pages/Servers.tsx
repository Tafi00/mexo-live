import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cpu, Gauge, HardDrive, HelpCircle, KeyRound, ListVideo, MemoryStick, MoreHorizontal, Network, PauseCircle, PencilLine, PlayCircle, Plus, RotateCcw, Server, ShieldOff, Trash2, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtDate, fmtDateTime, fmtNumber, fmtRelative } from '@/lib/format';
import { useLocalState, useNow } from '@/lib/hooks';
import { MetricBar } from '@/components/admin/common';
import { cmpVersion, JobsDrawer, ServerFormDialog, ServerKeyDialog, serverStateHelp, type ServerRow, type ServersResponse } from '@/components/admin/serverParts';
import { ServerStateBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Callout, Card, CardHeader, EmptyState, ErrorState, Menu, PageHeader, Progress, Skeleton, StatCard, Tooltip, type Tone } from '@/components/ui/misc';

function Heartbeat({ at, state }: { at: string | null; state: string }) {
  useNow(5000);
  if (!at) return <span className="text-subtle">Chưa có tín hiệu</span>;
  const sec = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  const txt = sec < 60 ? `${sec} giây trước` : fmtRelative(at);
  return (
    <span className={cn('inline-flex items-center gap-1 tabular', state === 'online' ? 'text-fg' : 'text-rose-600 dark:text-rose-400')} title={fmtDateTime(at, { seconds: true })}>
      {state === 'online' ? <Wifi className="size-3.5 text-emerald-500" /> : <WifiOff className="size-3.5" />}
      {txt}
    </span>
  );
}

function ServerCard({ s, data, onAction }: { s: ServerRow; data: ServersResponse; onAction: (s: ServerRow, a: string) => void }) {
  const m = s.metrics ?? {};
  const outdated = s.version && cmpVersion(s.version, data.minVersion) < 0;
  const loadPct = s.maxStreams ? (s.runningStreams / s.maxStreams) * 100 : 0;
  const loadTone: Tone = loadPct >= 90 ? 'danger' : loadPct >= 75 ? 'warning' : 'brand';
  const keyDays = s.keyExpiresAt ? Math.round((new Date(s.keyExpiresAt).getTime() - Date.now()) / 86400000) : null;
  const ramPct = m.ram !== undefined && m.ramTotal ? (m.ram / m.ramTotal) * 100 : null;
  const diskPct = m.diskUsed !== undefined && m.diskTotal ? (m.diskUsed / m.diskTotal) * 100 : null;
  const stale = s.state !== 'online';
  return (
    <Card className={cn('flex flex-col', ['lost', 'rejected', 'key_expired'].includes(s.state) && 'border-rose-200 dark:border-rose-900/60')}>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
        <div className={cn('grid size-8 shrink-0 place-items-center rounded-lg', s.state === 'online' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400' : 'bg-surface-2 text-muted')}>
          <Server className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{s.name}</p>
          <p className="truncate font-mono text-2xs text-muted">
            {s.host || '—'}
            {s.ip ? ` · ${s.ip}` : ''}
          </p>
        </div>
        <ServerStateBadge state={s.state} size="sm" />
        {data.canEdit && (
          <Menu
            width="w-60"
            trigger={({ toggle }) => <Button iconOnly size="xs" variant="ghost" icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="Thao tác máy chủ" />}
            items={[
              { label: 'Đổi tên / ghi chú', icon: <PencilLine />, onClick: () => onAction(s, 'edit') },
              s.suspended ? { label: 'Tiếp tục nhận việc', icon: <PlayCircle />, onClick: () => onAction(s, 'resume') } : { label: 'Tạm ngưng nhận việc', icon: <PauseCircle />, onClick: () => onAction(s, 'suspend') },
              { label: 'Luồng đang chạy', icon: <ListVideo />, onClick: () => onAction(s, 'jobs') },
              { divider: true, label: '' },
              { label: 'Cấp lại khóa', icon: <RotateCcw />, onClick: () => onAction(s, 'rotate') },
              { label: 'Thu hồi khóa', icon: <ShieldOff />, onClick: () => onAction(s, 'revoke'), hidden: s.keyState === 'revoked' },
              { divider: true, label: '' },
              { label: 'Xóa máy chủ', icon: <Trash2 />, danger: true, onClick: () => onAction(s, 'delete'), hint: s.runningStreams ? `${s.runningStreams} luồng` : undefined },
            ]}
          />
        )}
      </div>

      <div className="flex-1 space-y-3 p-4">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted">Luồng đang phát</span>
            <span className="font-semibold tabular">
              {s.runningStreams}
              <span className="font-normal text-muted"> / {s.maxStreams}</span>
            </span>
          </div>
          <Progress value={s.runningStreams} max={Math.max(1, s.maxStreams)} tone={loadTone} />
        </div>
        <div className={cn('grid grid-cols-2 gap-x-4 gap-y-3', stale && 'opacity-60')}>
          <MetricBar label="CPU" icon={<Cpu className="size-3" />} pct={m.cpu} text={m.cpu !== undefined ? `${Math.round(m.cpu)}%${m.load !== undefined ? ` · tải ${fmtNumber(m.load, 2)}` : ''}` : '—'} />
          <MetricBar label="RAM" icon={<MemoryStick className="size-3" />} pct={ramPct} text={m.ram !== undefined && m.ramTotal ? `${fmtBytes(m.ram)} / ${fmtBytes(m.ramTotal)}` : '—'} />
          <MetricBar label="Ổ đĩa" icon={<HardDrive className="size-3" />} pct={diskPct} text={m.diskUsed !== undefined && m.diskTotal ? `${fmtBytes(m.diskUsed)} / ${fmtBytes(m.diskTotal)}` : '—'} />
          <MetricBar label="Mạng ra" icon={<Network className="size-3" />} pct={null} text={m.netOutMbps !== undefined ? `${fmtNumber(m.netOutMbps, 1)} Mbps` : '—'} />
        </div>
        {stale && s.metrics && <p className="text-2xs text-muted">Số liệu từ lần tín hiệu cuối, có thể đã cũ.</p>}
      </div>

      <div className="space-y-1.5 border-t border-line bg-surface-2/40 px-4 py-2.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Tín hiệu cuối</span>
          <Heartbeat at={s.lastHeartbeatAt} state={s.state} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Phiên bản</span>
          {s.version ? (
            outdated ? (
              <Tooltip content={`Thấp hơn mức tối thiểu ${data.minVersion} — máy bị từ chối, cần cập nhật`}>
                <span className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="size-3.5" />v{s.version} · cần cập nhật
                </span>
              </Tooltip>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono">
                <CheckCircle2 className="size-3.5 text-emerald-500" />v{s.version}
              </span>
            )
          ) : (
            <span className="text-subtle">—</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Khóa</span>
          <span className="inline-flex items-center gap-1">
            <KeyRound className="size-3 text-muted" />
            <span className="font-mono">{s.keyHint ?? '—'}</span>
            {s.keyState === 'revoked' ? (
              <span className="font-medium text-rose-600 dark:text-rose-400">· đã thu hồi</span>
            ) : keyDays !== null ? (
              <span className={cn(keyDays < 0 ? 'font-medium text-rose-600 dark:text-rose-400' : keyDays <= 14 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted')} title={fmtDate(s.keyExpiresAt)}>
                · {keyDays < 0 ? 'đã hết hạn' : `còn ${keyDays} ngày`}
              </span>
            ) : null}
          </span>
        </div>
        {s.note && <p className="truncate pt-0.5 text-muted" title={s.note}>{s.note}</p>}
        <Button size="xs" variant="ghost" className="-ml-2 mt-0.5" icon={<ListVideo className="size-3.5" />} onClick={() => onAction(s, 'jobs')}>
          Xem luồng ({s.runningStreams})
        </Button>
      </div>
    </Card>
  );
}

export default function Servers() {
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServerRow | null>(null);
  const [keyData, setKeyData] = useState<{ name: string; key: string; keyExpiresAt: string | null; rotated: boolean } | null>(null);
  const [jobsOf, setJobsOf] = useState<ServerRow | null>(null);
  const [showHelp, setShowHelp] = useLocalState('mexo-servers-help', false);

  const q = useQuery({ queryKey: ['servers'], queryFn: () => api.get<ServersResponse>('/api/servers'), refetchInterval: 5000 });
  const d = q.data;

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      void q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function onAction(s: ServerRow, a: string) {
    if (a === 'edit') {
      setEditing(s);
      setFormOpen(true);
    } else if (a === 'jobs') setJobsOf(s);
    else if (a === 'suspend') {
      const r = await confirm({ title: `Tạm ngưng “${s.name}”?`, description: `Máy sẽ không nhận phiên mới. ${s.runningStreams} luồng đang chạy vẫn phát tiếp cho đến khi phiên kết thúc. Dùng trước khi bảo trì hoặc xóa máy.`, confirmText: 'Tạm ngưng' });
      if (r.ok) void act(() => api.patch(`/api/servers/${s.id}`, { suspended: true }), 'Đã tạm ngưng máy chủ');
    } else if (a === 'resume') {
      void act(() => api.patch(`/api/servers/${s.id}`, { suspended: false }), 'Máy chủ nhận việc trở lại');
    } else if (a === 'rotate') {
      const r = await confirm({
        title: `Cấp lại khóa cho “${s.name}”?`,
        description: (
          <>
            Khóa cũ <b>ngừng hoạt động ngay lập tức</b>. Máy sẽ mất kết nối (và {s.runningStreams} luồng đang phát có thể bị gián đoạn) cho đến khi bạn cập nhật <code className="font-mono">MEXO_SERVER_KEY</code> mới trên máy và khởi động lại.
          </>
        ),
        danger: true,
        confirmText: 'Cấp khóa mới',
      });
      if (!r.ok) return;
      try {
        const res = await api.post<{ key: string; keyExpiresAt: string | null }>(`/api/servers/${s.id}/rotate-key`);
        setKeyData({ name: s.name, key: res.key, keyExpiresAt: res.keyExpiresAt, rotated: true });
        void q.refetch();
      } catch (e) {
        toast.error(errorMessage(e));
      }
    } else if (a === 'revoke') {
      const r = await confirm({
        title: `Thu hồi khóa của “${s.name}”?`,
        description: s.runningStreams
          ? `Máy không kết nối được nữa ngay lập tức. ${s.runningStreams} luồng đang được giao cho máy này KHÔNG được tự chuyển sang máy khác — nên tạm ngưng máy và chờ các phiên kết thúc trước. Muốn dùng lại phải cấp khóa mới.`
          : 'Máy không kết nối được nữa ngay lập tức. Muốn dùng lại phải cấp khóa mới.',
        danger: true,
        requireText: s.name,
        confirmText: 'Thu hồi khóa',
      });
      if (r.ok) void act(() => api.post(`/api/servers/${s.id}/revoke-key`), 'Đã thu hồi khóa');
    } else if (a === 'delete') {
      if (s.runningStreams > 0) {
        toast.error(`Máy đang chạy ${s.runningStreams} luồng. Hãy tạm ngưng và chờ các phiên kết thúc trước khi xóa.`);
        return;
      }
      const r = await confirm({ title: `Xóa máy chủ “${s.name}”?`, description: 'Xóa vĩnh viễn máy chủ và khóa của nó. Không thể hoàn tác.', danger: true, requireText: s.name, confirmText: 'Xóa máy chủ' });
      if (r.ok) void act(() => api.del(`/api/servers/${s.id}`), 'Đã xóa máy chủ');
    }
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const capPct = d && d.capacity.total ? (d.capacity.used / d.capacity.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Máy chủ phát"
        description="Các máy chạy MexoStreamer đẩy video lên Shopee Live · tự cập nhật mỗi 5 giây"
        actions={
          <>
            <Button icon={<HelpCircle className="size-4" />} variant={showHelp ? 'secondary' : 'outline'} onClick={() => setShowHelp(!showHelp)}>
              Giải thích trạng thái
            </Button>
            {d?.canEdit && (
              <Button
                variant="primary"
                icon={<Plus className="size-4" />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Thêm máy chủ
              </Button>
            )}
          </>
        }
      />

      {!d ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Đang kết nối" value={`${d.counts.online}/${d.counts.all}`} hint="đang nhận việc" icon={<Wifi className="size-4" />} tone={d.counts.online ? 'success' : 'warning'} />
            <StatCard label="Cần chú ý" value={d.counts.attention} hint="mất kết nối · từ chối · hết khóa" icon={<AlertTriangle className="size-4" />} tone={d.counts.attention ? 'danger' : 'neutral'} />
            <StatCard label="Không hoạt động" value={d.counts.inactive} hint="chưa chạy · tạm ngưng · thu hồi" icon={<PauseCircle className="size-4" />} tone="muted" />
            <StatCard
              label="Công suất đang dùng"
              value={
                <>
                  {d.capacity.used}
                  <span className="text-sm font-normal text-muted"> / {d.capacity.total} luồng</span>
                </>
              }
              hint={capPct >= 90 ? 'Sắp hết chỗ — cân nhắc thêm máy' : `trên ${d.capacity.online} máy đang kết nối`}
              icon={<Gauge className="size-4" />}
              tone={capPct >= 90 ? 'danger' : capPct >= 75 ? 'warning' : 'brand'}
              footer={<Progress size="sm" value={d.capacity.used} max={Math.max(1, d.capacity.total)} tone={capPct >= 90 ? 'danger' : capPct >= 75 ? 'warning' : 'brand'} />}
            />
          </div>

          {!d.canEdit && <Callout tone="neutral">Bạn đang ở chế độ chỉ xem. Thêm, sửa, cấp khóa hay xóa máy chủ do Quản trị hệ thống thực hiện.</Callout>}

          {showHelp && (
            <Card>
              <CardHeader title="Trạng thái máy chủ" description={`Phiên bản tối thiểu: ${d.minVersion} · coi là mất kết nối sau ${d.lostAfterSeconds} giây không có tín hiệu`} />
              <div className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-2">
                {serverStateHelp(d.lostAfterSeconds, d.minVersion).map((h) => (
                  <div key={h.state} className="flex items-start gap-3">
                    <span className="w-32 shrink-0 pt-px">
                      <ServerStateBadge state={h.state} size="sm" />
                    </span>
                    <p className="text-sm text-muted">{h.text}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {d.items.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...d.items]
                .sort((a, b) => {
                  const rank = (s: ServerRow) => (['lost', 'rejected', 'key_expired'].includes(s.state) ? 0 : s.state === 'online' ? 1 : 2);
                  return rank(a) - rank(b) || a.id - b.id;
                })
                .map((s) => (
                  <ServerCard key={s.id} s={s} data={d} onAction={(srv, a) => void onAction(srv, a)} />
                ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={Server}
                title="Chưa có máy chủ phát nào"
                description="Thêm máy chủ để nhận khóa kết nối, sau đó cài MexoStreamer trên máy (VPS) để bắt đầu đẩy video lên Shopee Live."
                action={
                  d.canEdit && (
                    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setFormOpen(true)}>
                      Thêm máy chủ
                    </Button>
                  )
                }
              />
            </Card>
          )}
        </>
      )}

      <ServerFormDialog
        open={formOpen}
        server={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onCreated={(r) => setKeyData({ name: r.name, key: r.key, keyExpiresAt: r.keyExpiresAt, rotated: false })}
      />
      <ServerKeyDialog data={keyData} apiUrl={d?.apiUrl ?? ''} onClose={() => setKeyData(null)} />
      <JobsDrawer server={jobsOf ? (d?.items.find((x) => x.id === jobsOf.id) ?? jobsOf) : null} onClose={() => setJobsOf(null)} />
    </div>
  );
}
