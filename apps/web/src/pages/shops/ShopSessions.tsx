import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, Eye, Heart, History, ImageOff, ListVideo, Lock, Plug, Plus, Radio, ShoppingBag, Timer } from 'lucide-react';
import { SHOPEE_STATUS_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtClock, fmtDateTime, fmtDuration, fmtNumber, fmtRelative } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import type { LiveSession, ShopDetail } from '@/lib/types';
import { SessionStateBadge, Signals, StreamStateBadge } from '@/components/domain/status';
import { CreateSessionDialog } from '@/components/live/CreateSessionDialog';
import { endedReasonLabel, liveSeconds, OriginBadge, sessionSignals } from '@/components/live/helpers';
import type { ShopSessionsResponse } from '@/components/live/types';
import { Button, ButtonLink } from '@/components/ui/button';
import { Callout, Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/misc';
import { useShop } from './ShopLayout';

/** Lý do không cho tạo phiên mới (null = được tạo) */
function createBlock(shop: ShopDetail, open: LiveSession | null, canCreate: boolean): { title: string; text: string; action?: { to: string; label: string; icon: typeof Plug } } | null {
  if (!canCreate) return { title: 'Bạn chưa có quyền tạo phiên live', text: 'Liên hệ chủ shop hoặc quản trị viên để được cấp quyền "Tạo phiên livestream".' };
  if (shop.service.state === 'suspended' || shop.status === 'suspended')
    return { title: 'Shop đã ngưng dịch vụ', text: `Không thể tạo phiên mới cho shop đã ngưng dịch vụ${shop.service.suspendReason ? ` (${shop.service.suspendReason})` : ''}. Liên hệ quản trị viên để mở lại.` };
  if (shop.service.state === 'expired')
    return { title: 'Shop đã hết hạn dùng', text: 'Shop hết hạn dịch vụ nên không tạo được phiên mới. Bạn vẫn xem được lịch sử và dữ liệu cũ. Liên hệ quản trị viên để gia hạn.' };
  if (shop.connection !== 'ok' && shop.connection !== 'expiring')
    return {
      title: 'Shop chưa kết nối Shopee hoặc cần cấp quyền lại',
      text: 'MEXO cần quyền Shopee còn hiệu lực để tạo phiên. Chủ shop cần đăng nhập Shopee và đồng ý cấp quyền lại.',
      action: { to: `/shops/${shop.id}/connection`, label: 'Xem kết nối', icon: Plug },
    };
  if (open)
    return {
      title: 'Shop đang có một phiên chưa kết thúc',
      text: 'Mỗi shop chỉ có 1 phiên mở tại một thời điểm. Hãy kết thúc phiên hiện tại trước khi tạo phiên mới.',
      action: { to: `/sessions/${open.id}`, label: 'Mở phiên hiện tại', icon: Radio },
    };
  return null;
}

function CurrentSession({ s, shop }: { s: LiveSession; shop: ShopDetail }) {
  const now = useNow();
  const dur = liveSeconds(s.startedAt, s.endedAt, now);
  const signals = shop.session?.id === s.id ? shop.session.signals : sessionSignals(s);
  const playlist = s.playlist ?? [];
  const video = s.videoIndex !== null ? playlist[s.videoIndex] : null;
  const m = s.metrics ?? {};
  return (
    <Card>
      <CardHeader
        title="Phiên đang mở"
        icon={<Radio className="size-4" />}
        actions={
          <ButtonLink to={`/sessions/${s.id}`} variant="primary" size="sm" icon={<ArrowRight className="size-4" />}>
            Mở bảng điều khiển
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-5 p-5 sm:flex-row">
        <Link to={`/sessions/${s.id}`} className="relative block aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
          {s.coverKey ? (
            <img src={`/api/files/cover?key=${encodeURIComponent(s.coverKey)}`} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-subtle">
              <ImageOff className="size-5" />
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SessionStateBadge state={s.state} stuck={s.stuck} />
            {s.origin !== 'external' && <StreamStateBadge state={s.streamState} />}
            <OriginBadge origin={s.origin} />
          </div>
          <Link to={`/sessions/${s.id}`} className="mt-2 block text-[15px] font-semibold hover:text-brand-600">
            {s.title}
          </Link>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            {s.shopeeSessionId && <span className="font-mono text-xs leading-5">Session ID {s.shopeeSessionId}</span>}
            <span>Shopee: {SHOPEE_STATUS_LABELS[s.shopeeStatus] ?? s.shopeeStatus}</span>
            <span>{s.startedAt ? `Lên sóng ${fmtRelative(s.startedAt)}` : `Tạo ${fmtRelative(s.createdAt)}`}</span>
            {s.templateName && (
              <span className="inline-flex items-center gap-1">
                <ListVideo className="size-3.5" />
                {s.templateName}
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: Timer, label: 'Thời lượng', value: dur !== null ? fmtClock(dur) : '—' },
              { icon: Eye, label: 'Đang xem', value: fmtNumber(m.viewers ?? 0) },
              { icon: Heart, label: 'Lượt thích', value: fmtNumber(m.likes ?? 0) },
              { icon: ShoppingBag, label: 'Đơn hàng', value: fmtNumber(m.orders ?? 0) },
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-surface-2 px-3 py-2">
                <p className="flex items-center gap-1 text-xs text-muted">
                  <x.icon className="size-3.5" />
                  {x.label}
                </p>
                <p className="text-base font-semibold tabular">{x.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            {s.origin !== 'external' && (
              <span className="inline-flex items-center gap-2">
                Tín hiệu: <Signals signals={signals} />
              </span>
            )}
            {video && (
              <span className="min-w-0 truncate">
                Video {(s.videoIndex ?? 0) + 1}/{playlist.length}: {video.name}
              </span>
            )}
          </div>
          {s.origin === 'external' && (
            <Callout tone="neutral" className="mt-3">
              Phiên mở từ app Shopee hoặc Shopee Live PC — MEXO chỉ theo dõi, không điều khiển được phiên này.
            </Callout>
          )}
          {s.lastError && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{s.lastError}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function ShopSessions() {
  const { shop } = useShop();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);

  const q = useQuery({
    queryKey: ['shop', shop.id, 'sessions', 'recent'],
    queryFn: () => api.get<ShopSessionsResponse>(`/api/shops/${shop.id}/sessions`, { page: 1, pageSize: 5 }),
    refetchInterval: 10_000,
  });

  const open = q.data?.open ?? null;
  const block = q.data ? createBlock(shop, open, can('session.create')) : null;
  const wantNew = params.get('new') === '1';

  // Tự mở hộp tạo phiên khi URL có ?new=1 (chỉ khi được phép tạo)
  useEffect(() => {
    if (!wantNew || !q.data) return;
    if (!block) setCreateOpen(true);
    const p = new URLSearchParams(params);
    p.delete('new');
    setParams(p, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantNew, q.data]);

  const recent = q.data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Phiên live</h2>
          <p className="text-[13px] text-muted">Phiên đang mở của shop và các phiên gần đây. Mỗi shop chỉ có 1 phiên mở tại một thời điểm.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} disabled={!q.data || Boolean(block)} onClick={() => setCreateOpen(true)}>
          Tạo phiên live
        </Button>
      </div>

      {q.isLoading ? (
        <Skeleton className="h-56 rounded-xl" />
      ) : (
        <>
          {block && !(open && block.action?.to === `/sessions/${open.id}`) && (
            <Callout
              tone={block.action?.icon === Plug || shop.service.state === 'expired' ? 'warning' : 'neutral'}
              icon={<Lock className="size-4" />}
              title={block.title}
              action={
                block.action && (
                  <ButtonLink to={block.action.to} size="sm" icon={<block.action.icon className="size-3.5" />}>
                    {block.action.label}
                  </ButtonLink>
                )
              }
            >
              {block.text}
            </Callout>
          )}
          {open ? (
            <>
              <CurrentSession s={open} shop={shop} />
              {can('session.create') && <p className="px-1 text-xs text-muted">Muốn tạo phiên mới? Kết thúc phiên đang mở trước — Shopee và MEXO chỉ cho phép 1 phiên mở mỗi shop.</p>}
            </>
          ) : (
            <Card>
              <EmptyState
                icon={Radio}
                title="Shop chưa có phiên nào đang mở"
                description={block ? block.text : 'Tạo phiên mới trên Shopee, sau đó bắt đầu phát tự động bằng mẫu phát. Hoặc đặt lịch phát để hệ thống tự bật.'}
                action={
                  !block && (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                        Tạo phiên live
                      </Button>
                      <ButtonLink to={`/shops/${shop.id}/schedules`}>Đặt lịch phát</ButtonLink>
                    </div>
                  )
                }
              />
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader
          title="Phiên đã kết thúc gần đây"
          icon={<History className="size-4" />}
          description={q.data ? `${fmtNumber(q.data.total)} phiên đã kết thúc` : undefined}
          actions={
            can('report.view') && (
              <ButtonLink to={`/shops/${shop.id}/history`} size="sm" icon={<History className="size-3.5" />}>
                Xem toàn bộ lịch sử
              </ButtonLink>
            )
          }
        />
        {q.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : recent.length ? (
          <ul className="divide-y divide-line">
            {recent.map((s) => {
              const dur = liveSeconds(s.startedAt, s.endedAt, Date.now());
              const m = s.metrics ?? {};
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => nav(`/sessions/${s.id}`)} className="flex w-full flex-wrap items-center gap-x-5 gap-y-1.5 px-5 py-3 text-left transition-colors hover:bg-surface-2/60">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="truncate text-[13px] font-medium">{s.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                        <span>{fmtDateTime(s.startedAt ?? s.createdAt)}</span>
                        {s.shopeeSessionId && <span className="font-mono">#{s.shopeeSessionId}</span>}
                        <OriginBadge origin={s.origin} />
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1 tabular">
                        <Clock className="size-3.5" />
                        {s.startedAt ? fmtDuration(dur) : 'Không lên sóng'}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular">
                        <Eye className="size-3.5" />
                        {fmtNumber(m.peakViewers ?? 0)}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular">
                        <ShoppingBag className="size-3.5" />
                        {fmtNumber(m.orders ?? 0)}
                      </span>
                      <span className="w-36 truncate text-right">{endedReasonLabel(s.endedReason)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={History} title="Chưa có phiên nào kết thúc" />
        )}
      </Card>

      <CreateSessionDialog shop={shop} open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
