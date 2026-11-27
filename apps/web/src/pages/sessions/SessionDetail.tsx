import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Hash,
  Link2,
  ListVideo,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  Square,
  Store,
  Timer,
  Unlock,
  UserRound,
  XOctagon,
  Zap,
} from 'lucide-react';
import { SHOPEE_STATUS_LABELS, STREAM_STATE_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtClock, fmtDateTime, fmtDuration, fmtNumber, fmtRelative, fmtTime } from '@/lib/format';
import { useAction, useCopy, useNow } from '@/lib/hooks';
import type { LiveSession } from '@/lib/types';
import { SessionStateBadge, StreamStateBadge } from '@/components/domain/status';
import { AutoFlowSteps, flowStatus } from '@/components/live/AutoFlow';
import { CartPanel } from '@/components/live/CartPanel';
import { CommentsPanel } from '@/components/live/CommentsPanel';
import { EditSessionDialog } from '@/components/live/EditSessionDialog';
import { EventTimeline } from '@/components/live/EventTimeline';
import { endedReasonLabel, liveSeconds, OriginBadge } from '@/components/live/helpers';
import { MetricsPanel } from '@/components/live/MetricsPanel';
import { NowPlayingPanel } from '@/components/live/NowPlayingPanel';
import { PinnedPanel } from '@/components/live/PinnedPanel';
import { StartStreamDialog } from '@/components/live/StartStreamDialog';
import type { CartView, SessionDetailResponse } from '@/components/live/types';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Callout, Card, CardHeader, Dot, ErrorState, KV, Menu, PageLoading, type MenuItem, type Tone } from '@/components/ui/misc';

const shopeeTone: Record<string, Tone> = { ongoing: 'brand', not_started: 'neutral', ended: 'muted', unknown: 'warning' };
const streamTone: Record<string, Tone> = { idle: 'muted', waiting_server: 'info', preparing: 'info', pushing: 'success', error: 'danger', lost: 'danger', stopped: 'muted' };

function LiveTimer({ s }: { s: LiveSession }) {
  const now = useNow();
  const sec = liveSeconds(s.startedAt, s.endedAt, now);
  if (sec === null)
    return (
      <span className="inline-flex items-center gap-1">
        <Timer className="size-3.5" />
        Chưa lên sóng · tạo {fmtRelative(s.createdAt)}
      </span>
    );
  if (s.endedAt)
    return (
      <span className="inline-flex items-center gap-1">
        <Timer className="size-3.5" />
        Đã phát {fmtDuration(sec)}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-fg">
      <Dot tone="danger" pulse={s.state === 'live'} />
      <span className="tabular">{fmtClock(sec)}</span>
      <span className="font-normal text-muted">đang phát</span>
    </span>
  );
}

function MetaItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 [&>svg]:size-3.5 [&>svg]:shrink-0">
      {icon}
      {children}
    </span>
  );
}

export default function SessionDetail() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const { can, isStaff, isSysadmin } = useAuth();
  const confirm = useConfirm();
  const copy = useCopy();
  const [startOpen, setStartOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const q = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.get<SessionDetailResponse>(`/api/sessions/${id}`),
    refetchInterval: (query) => (query.state.data?.session.state === 'ended' ? 30_000 : 4_000),
    enabled: Number.isFinite(id) && id > 0,
  });
  const d = q.data;
  const s = d?.session;
  const shopId = s?.shopId ?? 0;

  const cartQ = useQuery({
    queryKey: ['session-cart', id],
    queryFn: () => api.get<CartView>(`/api/sessions/${id}/cart`),
    enabled: Boolean(s?.shopeeSessionId) && s?.state !== 'ended',
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });

  const inv = [['session', id], ['live'], ['shop', shopId], ['shops'], ['dashboard']];
  const stop = useAction(() => api.post(`/api/sessions/${id}/stream/stop`), { success: 'Đã dừng đẩy hình — phiên vẫn mở trên Shopee', invalidate: inv });
  const end = useAction(() => api.post<{ ok: boolean; result: 'ended' | 'already_ended' }>(`/api/sessions/${id}/end`), {
    success: (r) => (r.result === 'already_ended' ? 'Phiên đã kết thúc trên Shopee từ trước' : 'Đã kết thúc phiên live'),
    invalidate: inv,
  });
  const sync = useAction(() => api.post<{ ok: boolean; shopeeStatus: string }>(`/api/sessions/${id}/sync`), {
    success: (r) => `Đã đồng bộ — Shopee báo: ${SHOPEE_STATUS_LABELS[r.shopeeStatus] ?? r.shopeeStatus}`,
    invalidate: inv,
  });
  const release = useAction((b: { force: boolean; note: string }) => api.post<{ released: boolean; verified: boolean }>(`/api/sessions/${id}/release`, b), {
    success: (r) => (r.verified ? 'Shopee xác nhận phiên đã kết thúc — đã giải phóng khóa phiên' : 'Đã giải phóng khóa phiên (bắt buộc)'),
    invalidate: inv,
  });

  if (q.isLoading) return <PageLoading />;
  if (q.isError || !d || !s) return <ErrorState error={q.error ?? 'Không tìm thấy phiên'} onRetry={() => q.refetch()} />;

  const { shop, job, server } = d;
  const ended = s.state === 'ended';
  const external = s.origin === 'external';
  const controllable = !ended && !external;
  const canControl = can('session.control');
  const hasJob = Boolean(job);
  const showStart = controllable && canControl && !hasJob && s.state !== 'ending';
  const showStop = controllable && canControl && hasJob;
  const showEnd = controllable && canControl;
  const showEdit = s.state === 'not_started' && can('session.create') && !external;
  const needsRelease = !ended && (s.state === 'unknown' || s.state === 'sync_error' || s.stuck);
  const showRelease = isStaff && needsRelease;

  async function doStop() {
    const r = await confirm({
      title: 'Dừng đẩy hình?',
      description: 'Máy chủ sẽ ngừng đẩy video lên Shopee. Người xem sẽ thấy hình đứng, nhưng phiên vẫn mở trên Shopee. Bạn có thể bắt đầu phát tự động lại, hoặc bấm “Kết thúc live” để đóng hẳn phiên.',
      danger: true,
      confirmText: 'Dừng đẩy hình',
    });
    if (r.ok) stop.mutate();
  }

  async function doEnd() {
    const r = await confirm({
      title: 'Kết thúc phiên live?',
      description: (
        <>
          Phiên <b className="text-fg">{s!.title}</b> sẽ kết thúc trên Shopee và máy chủ ngừng đẩy hình. Người xem rời phiên ngay lập tức.
          <br />
          <b className="text-fg">Phiên đã kết thúc không thể mở lại</b> — muốn live tiếp phải tạo phiên mới.
        </>
      ),
      danger: true,
      confirmText: 'Kết thúc live',
    });
    if (r.ok) end.mutate();
  }

  async function doRelease(force: boolean) {
    const r = await confirm(
      force
        ? {
            title: 'Giải phóng khóa phiên bắt buộc?',
            description: 'Dùng khi không thể xác minh với Shopee (shop mất kết nối, Shopee lỗi kéo dài). Phiên sẽ được đánh dấu đã kết thúc trong MEXO để shop tạo được phiên mới. Nếu phiên thực ra vẫn đang live trên Shopee, cần tắt trên app Shopee.',
            danger: true,
            input: { label: 'Lý do (bắt buộc, lưu vào nhật ký)', required: true, multiline: true, placeholder: 'vd: Shopee báo lỗi 5 lần, đã kiểm tra trên app Shopee phiên đã tắt' },
            confirmText: 'Giải phóng bắt buộc',
          }
        : {
            title: 'Giải phóng khóa phiên',
            description: 'Hệ thống hỏi lại Shopee. Chỉ giải phóng khi Shopee xác nhận phiên đã kết thúc; nếu Shopee báo phiên vẫn đang live, hãy kết thúc phiên thay vì giải phóng.',
            input: { label: 'Ghi chú (không bắt buộc)', multiline: true },
            confirmText: 'Kiểm tra và giải phóng',
          },
    );
    if (r.ok) release.mutate({ force, note: r.value.trim() });
  }

  const menuItems: MenuItem[] = [
    { label: 'Sửa thông tin phiên', icon: <Pencil />, onClick: () => setEditOpen(true), hidden: !showEdit },
    { label: 'Sao chép link chia sẻ', icon: <Link2 />, onClick: () => s.shareUrl && copy(s.shareUrl, 'Đã chép link chia sẻ'), hidden: !s.shareUrl },
    { label: 'Mở phiên trên Shopee', icon: <ExternalLink />, onClick: () => s.shareUrl && window.open(s.shareUrl, '_blank', 'noopener'), hidden: !s.shareUrl },
    { label: 'Sao chép Session ID', icon: <Hash />, onClick: () => copy(String(s.shopeeSessionId), 'Đã chép Session ID'), hidden: !s.shopeeSessionId },
    { label: '', divider: true, hidden: !showRelease },
    { label: 'Giải phóng khóa phiên', icon: <Unlock />, onClick: () => void doRelease(false), hidden: !showRelease },
    { label: 'Giải phóng bắt buộc', icon: <ShieldAlert />, danger: true, onClick: () => void doRelease(true), hidden: !showRelease || !isSysadmin },
  ];

  const status = flowStatus(s, hasJob);
  // Đã lên sóng và mọi bước đều xong/đang chạy → chỉ cần 1 dòng tóm tắt
  const flowSteady = hasJob && status.every((st) => st === 'done' || st === 'run' || st === 'off');

  return (
    <div className="space-y-4">
      {/* ───── Tiêu đề ───── */}
      <div>
        <Link to={`/shops/${shop.id}/sessions`} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> {shop.name}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">{s.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <SessionStateBadge state={s.state} stuck={s.stuck} />
              {!external && <StreamStateBadge state={s.streamState} />}
              <OriginBadge origin={s.origin} size="md" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <MetaItem icon={<Store />}>
                <Link to={`/shops/${shop.id}`} className="truncate font-medium text-fg hover:text-brand-600">
                  {shop.name}
                </Link>
              </MetaItem>
              {s.shopeeSessionId && (
                <button type="button" onClick={() => copy(String(s.shopeeSessionId), 'Đã chép Session ID')} className="inline-flex items-center gap-1 font-mono hover:text-fg" title="Sao chép Session ID">
                  Session ID {s.shopeeSessionId} <Copy className="size-3" />
                </button>
              )}
              {s.shareUrl && (
                <button type="button" onClick={() => copy(s.shareUrl!, 'Đã chép link chia sẻ')} className="inline-flex items-center gap-1 hover:text-fg" title={s.shareUrl}>
                  <Link2 className="size-3.5" /> Link chia sẻ <Copy className="size-3" />
                </button>
              )}
              <LiveTimer s={s} />
              {s.templateName && <MetaItem icon={<ListVideo />}>{s.templateName}</MetaItem>}
              {s.createdByName && <MetaItem icon={<UserRound />}>{s.createdByName}</MetaItem>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showStart && (
              <Button variant="primary" icon={<Play className="size-4" />} onClick={() => setStartOpen(true)}>
                Bắt đầu phát tự động
              </Button>
            )}
            {showStop && (
              <Button icon={<Square className="size-4" />} loading={stop.isPending} onClick={() => void doStop()}>
                Dừng đẩy hình
              </Button>
            )}
            {!ended && s.shopeeSessionId && (
              <Button icon={<RefreshCw className={cn('size-4', sync.isPending && 'animate-spin')} />} disabled={sync.isPending} onClick={() => sync.mutate()} title="Hỏi lại Shopee trạng thái và số liệu mới nhất">
                Đồng bộ
              </Button>
            )}
            {showEnd && (
              <Button variant="danger-outline" icon={<XOctagon className="size-4" />} loading={end.isPending} disabled={s.state === 'ending'} onClick={() => void doEnd()}>
                Kết thúc live
              </Button>
            )}
            {menuItems.some((m) => !m.hidden && !m.divider) && (
              <Menu trigger={({ toggle }) => <Button iconOnly icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="Thao tác khác" />} items={menuItems} width="w-60" />
            )}
          </div>
        </div>
      </div>

      {/* ───── Thông báo trạng thái ───── */}
      {ended && (
        <Callout
          tone="neutral"
          title={`Phiên đã kết thúc${s.endedAt ? ` lúc ${fmtDateTime(s.endedAt)}` : ''}`}
          action={
            can('session.create') && (
              <ButtonLink to={`/shops/${shop.id}/sessions?new=1`} size="sm" icon={<Zap className="size-3.5" />}>
                Phát phiên mới
              </ButtonLink>
            )
          }
        >
          Lý do: {endedReasonLabel(s.endedReason)}. Phiên đã kết thúc không thể mở lại — muốn live tiếp hãy phát phiên mới.
        </Callout>
      )}
      {external && !ended && (
        <Callout tone="info" title="Phiên mở từ app Shopee hoặc Shopee Live PC">
          MEXO chỉ theo dõi trạng thái và số liệu, không điều khiển được phiên này (không phát tự động, không kết thúc từ MEXO).
        </Callout>
      )}
      {s.origin === 'legacy' && !ended && <Callout tone="neutral">Phiên nhập từ hệ thống cũ — một số thông tin (mẫu phát, máy chủ, nhật ký) có thể không đầy đủ.</Callout>}
      {needsRelease && (
        <Callout
          tone="warning"
          title={s.stuck ? 'Phiên có vẻ bị treo' : s.state === 'sync_error' ? 'Không đồng bộ được trạng thái với Shopee' : 'Chưa xác minh được trạng thái phiên'}
          action={
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} onClick={() => sync.mutate()}>
                Đồng bộ
              </Button>
              {showRelease && (
                <Button size="sm" icon={<Unlock className="size-3.5" />} loading={release.isPending} onClick={() => void doRelease(false)}>
                  Giải phóng khóa
                </Button>
              )}
            </div>
          }
        >
          Hệ thống chưa nhận được xác nhận từ Shopee{s.syncFailures ? ` (${s.syncFailures} lần đồng bộ lỗi liên tiếp)` : ''}. Bấm “Đồng bộ” để hỏi lại Shopee.
          {isStaff ? ' Nếu Shopee xác nhận phiên đã kết thúc, có thể giải phóng khóa để shop tạo phiên mới.' : ' Nếu vẫn lỗi, liên hệ quản trị viên để giải phóng khóa phiên.'}
        </Callout>
      )}
      {!ended && s.state === 'live' && (s.streamState === 'lost' || s.streamState === 'error') && (
        <Callout tone="danger" title={s.streamState === 'lost' ? 'Máy chủ phát mất kết nối — người xem đang thấy hình đứng' : 'Máy chủ lỗi đẩy hình — đang tự chạy lại'}>
          Phiên vẫn mở trên Shopee. Hệ thống tự chuyển việc sang máy khác nếu máy hiện tại không trở lại. {s.feedLostAt ? `Mất hình từ ${fmtRelative(s.feedLostAt)}.` : ''}
        </Callout>
      )}
      {s.state === 'ending' && <Callout tone="info">Đã gửi lệnh kết thúc, đang chờ Shopee xác nhận…</Callout>}
      {s.state === 'connecting' && s.streamState === 'pushing' && <Callout tone="info">Máy chủ đang đẩy hình — hệ thống sẽ bắt đầu phiên ngay khi Shopee nhận hình ổn định.</Callout>}
      {s.state === 'not_started' && !hasJob && !external && (
        <Callout tone="info" title="Phiên đã tạo trên Shopee nhưng chưa bắt đầu">
          Bấm “Bắt đầu phát tự động” và chọn mẫu phát. Hệ thống chỉ bắt đầu phiên khi Shopee đã nhận hình từ máy chủ.
        </Callout>
      )}
      {s.liveCutAt && !ended && (
        <Callout tone="warning" title="Phiên sẽ tự ngắt">
          Shop hết hạn dùng — phiên sẽ tự kết thúc lúc {fmtDateTime(s.liveCutAt)}.
        </Callout>
      )}
      {s.lastError && !ended && !needsRelease && <Callout tone="warning" title="Lỗi gần nhất">{s.lastError}</Callout>}

      {/* ───── Hai lớp trạng thái: Shopee vs máy chủ nội bộ ───── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Trạng thái trên Shopee" icon={<Store className="size-4" />} description="Trạng thái thật do Shopee báo — quyết định người xem có thấy phiên." />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div>
                <p className="text-2xs font-medium uppercase tracking-wide text-muted">Shopee báo</p>
                <p className="flex items-center gap-2 text-lg font-semibold">
                  <Dot tone={shopeeTone[s.shopeeStatus] ?? 'neutral'} pulse={s.shopeeStatus === 'ongoing'} className="size-2.5" />
                  {SHOPEE_STATUS_LABELS[s.shopeeStatus] ?? s.shopeeStatus}
                </p>
              </div>
              <div className="text-right">
                <p className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-muted">Trong MEXO</p>
                <SessionStateBadge state={s.state} stuck={s.stuck} />
              </div>
            </div>
            <KV
              className="grid-cols-2 gap-y-2.5 border-t border-line pt-3"
              items={[
                { label: 'Lên sóng lúc', value: s.startedAt ? fmtDateTime(s.startedAt, { seconds: true }) : 'Chưa lên sóng' },
                { label: 'Kết thúc lúc', value: fmtDateTime(s.endedAt), hidden: !s.endedAt },
                { label: 'Đồng bộ gần nhất', value: s.lastShopeeSyncAt ? <span title={fmtDateTime(s.lastShopeeSyncAt, { seconds: true })}>{fmtRelative(s.lastShopeeSyncAt)}</span> : 'Chưa đồng bộ' },
                {
                  label: 'Đồng bộ lỗi liên tiếp',
                  value: <span className={s.syncFailures ? 'text-rose-600 dark:text-rose-400' : undefined}>{fmtNumber(s.syncFailures)} lần</span>,
                  hidden: ended,
                },
                { label: 'Lý do kết thúc', value: endedReasonLabel(s.endedReason), hidden: !ended },
                { label: 'Tạo lúc', value: fmtDateTime(s.createdAt) },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Máy chủ phát nội bộ" icon={<Server className="size-4" />} description="Máy chủ MEXO đẩy video lên Shopee — dừng hay lỗi không tự kết thúc phiên." />
          <div className="space-y-3 p-4">
            {external ? (
              <p className="text-sm text-muted">Phiên này không dùng máy chủ phát của MEXO.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                  <div>
                    <p className="text-2xs font-medium uppercase tracking-wide text-muted">Máy chủ báo</p>
                    <p className="flex items-center gap-2 text-lg font-semibold">
                      <Dot tone={streamTone[s.streamState] ?? 'neutral'} pulse={s.streamState === 'pushing'} className="size-2.5" />
                      {STREAM_STATE_LABELS[s.streamState as keyof typeof STREAM_STATE_LABELS] ?? s.streamState}
                    </p>
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-muted">Máy chủ</p>
                    <p className="truncate text-sm font-medium">{server?.name ?? (s.serverId ? `#${s.serverId}` : 'Chưa giao')}</p>
                  </div>
                </div>
                <KV
                  className="grid-cols-2 gap-y-2.5 border-t border-line pt-3"
                  items={[
                    { label: 'Việc phát', value: job ? `#${job.id} · ${job.state}` : 'Không có việc đang chạy' },
                    { label: 'Báo cáo gần nhất', value: job?.lastReportAt ? fmtRelative(job.lastReportAt) : '—', hidden: !job },
                    { label: 'Có hình từ', value: s.feedSince ? <span title={fmtDateTime(s.feedSince, { seconds: true })}>{fmtTime(s.feedSince)} ({fmtRelative(s.feedSince)})</span> : '—', hidden: !s.feedSince },
                    { label: 'Tự chạy lại', value: `${fmtNumber(job?.restarts ?? 0)} lần`, hidden: !job },
                    { label: 'Mất hình từ', value: <span className="text-rose-600 dark:text-rose-400">{fmtDateTime(s.feedLostAt, { seconds: true })}</span>, hidden: !s.feedLostAt },
                  ]}
                />
                {job?.error && (
                  <Callout tone="danger" title="Lỗi máy chủ phát">
                    {job.error}
                  </Callout>
                )}
                {hasJob ? (
                  flowSteady ? (
                    <p className="flex items-start gap-2 rounded-lg bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/25 dark:text-emerald-300">
                      <CheckCircle2 className="mt-px size-3.5 shrink-0" />
                      <span>
                        Phát tự động đang chạy ổn định · ghim theo video: <b className="font-medium">{status[4] === 'run' ? 'đang chạy' : 'đang tắt'}</b> · trả lời bình luận:{' '}
                        <b className="font-medium">{status[5] === 'run' ? 'đang chạy' : 'đang tắt'}</b>
                      </span>
                    </p>
                  ) : (
                    <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">
                      <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted">Tiến trình phát tự động</p>
                      <AutoFlowSteps status={status} compact />
                    </div>
                  )
                ) : (
                  !ended && (
                    <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                      {s.streamState === 'stopped' ? 'Đã dừng đẩy hình. Người xem thấy hình đứng cho tới khi bạn phát lại hoặc kết thúc phiên.' : 'Chưa có việc phát nào. Bấm “Bắt đầu phát tự động” để máy chủ nhận việc.'}
                    </p>
                  )
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ───── Điều khiển chi tiết ───── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          {!external && <NowPlayingPanel session={s} hasJob={hasJob} canControl={canControl} dataUpdatedAt={q.dataUpdatedAt} onStart={showStart ? () => setStartOpen(true) : undefined} />}
          <MetricsPanel session={s} samples={d.samples} />
          <CartPanel session={s} cartQ={cartQ} canManage={can('product.manage') && !external} canPin={can('product.pin') && !external} />
        </div>
        <div className="min-w-0 space-y-4">
          <PinnedPanel session={s} pinned={d.pinned} cart={cartQ.data} cartLoading={cartQ.isLoading} canPin={can('product.pin')} />
          <CommentsPanel session={s} canReply={can('comment.reply')} shopReplyEnabled={shop.replyEnabled} />
          <EventTimeline events={d.events} />
        </div>
      </div>

      {showStart && <StartStreamDialog session={s} open={startOpen} onClose={() => setStartOpen(false)} />}
      {showEdit && <EditSessionDialog session={s} open={editOpen} onClose={() => setEditOpen(false)} />}
    </div>
  );
}
