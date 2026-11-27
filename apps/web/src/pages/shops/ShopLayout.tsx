import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRightLeft,
  BarChart3,
  CalendarClock,
  Clapperboard,
  Copy,
  History,
  LayoutGrid,
  Link2,
  ListVideo,
  MessagesSquare,
  Package,
  Plug,
  Radio,
  ScrollText,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import type { ShopDetail } from '@/lib/types';
import { ConnectShopDialog } from '@/components/domain/ConnectShopDialog';
import { ConnectInvitesDialog } from '@/components/domain/ConnectInvitesDialog';
import { useConfirm } from '@/components/ui/dialog';
import { GoLiveDialog } from '@/components/live/GoLiveDialog';
import { ConnectionBadge, ShopStatusBadge } from '@/components/domain/status';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge, Callout, ErrorState, PageLoading } from '@/components/ui/misc';

export interface ShopCtx {
  shop: ShopDetail;
  refetch: () => void;
}

/** Dùng trong các tab của shop */
export function useShop(): ShopCtx {
  return useOutletContext<ShopCtx>();
}

export default function ShopLayout() {
  const { shopId } = useParams();
  const id = Number(shopId);
  const { can, role, isStaff } = useAuth();
  const copy = useCopy();
  const confirm = useConfirm();
  const [reauth, setReauth] = useState(false);
  const [goLive, setGoLive] = useState(false);
  const [invite, setInvite] = useState(false);
  const q = useQuery({ queryKey: ['shop', id], queryFn: () => api.get<ShopDetail>(`/api/shops/${id}`), refetchInterval: 20_000 });

  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const shop = q.data;

  async function cutover() {
    const connected = shop.connection === 'ok' || shop.connection === 'expiring';
    const r = await confirm({
      title: `Chuyển hẳn “${shop.name}” sang hệ thống mới?`,
      description: (
        <div className="space-y-2">
          <p>Từ lúc này hệ thống mới được tạo / kết thúc phiên, ghim sản phẩm, chạy lịch phát và trả lời bình luận cho shop này.</p>
          <p className="font-medium text-fg">Trước khi bấm, ở hệ thống cũ hãy tắt lịch phát, trả lời tự động và máy phát của shop — nếu không hai bên sẽ tranh phiên và trả lời trùng.</p>
          {shop.session?.origin === 'legacy' && <p>Phiên đang chạy từ hệ thống cũ: sau khi chuyển, mở phiên và bấm “Bắt đầu phát tự động” để máy phát mới tiếp quản (giữ nguyên phiên).</p>}
          {!connected && <p className="text-amber-700 dark:text-amber-400">Shop chưa cấp quyền cho hệ thống mới — cần cấp quyền trước khi phát.</p>}
        </div>
      ),
      danger: true,
      confirmText: 'Chuyển hẳn',
    });
    if (!r.ok) return;
    try {
      await api.post('/api/shops/legacy-hold', { shopIds: [shop.id], hold: false });
      toast.success('Đã chuyển hẳn shop sang hệ thống mới');
      void q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const tabs = [
    { to: '', label: 'Hôm nay', icon: LayoutGrid, end: true, show: true },
    { to: 'sessions', label: 'Phiên live', icon: Radio, show: true, badge: shop.session ? '●' : undefined },
    { to: 'products', label: 'Sản phẩm', icon: Package, show: true },
    { to: 'videos', label: 'Video', icon: Clapperboard, show: true },
    { to: 'templates', label: 'Mẫu phát', icon: ListVideo, show: true },
    { to: 'schedules', label: 'Lịch phát', icon: CalendarClock, show: true },
    { to: 'replies', label: 'Bình luận', icon: MessagesSquare, show: true },
    { to: 'history', label: 'Lịch sử', icon: History, show: can('report.view') },
    { to: 'connection', label: 'Kết nối & hạn', icon: Plug, show: true },
    { to: 'activity', label: 'Nhật ký', icon: ScrollText, show: role !== 'member' },
  ].filter((t) => t.show);

  const needsReauth = ['needs_reauth', 'revoked', 'expired'].includes(shop.connection);

  return (
    <div>
      <div className="mb-4">
        <Link to="/shops" className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> Gian hàng
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{shop.name}</h1>
              <ShopStatusBadge status={shop.status} />
              {shop.connection !== 'ok' && <ConnectionBadge state={shop.connection} />}
              {shop.legacyHold && <Badge tone="warning">Hệ thống cũ</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {shop.alias && <span>{shop.shopeeName}</span>}
              <button onClick={() => copy(String(shop.shopeeShopId), 'Đã chép Shop ID')} className="inline-flex items-center gap-1 font-mono text-xs hover:text-fg">
                ID {shop.shopeeShopId} <Copy className="size-3" />
              </button>
              {shop.owner && <span>Chủ shop: {shop.owner.name}</span>}
              {shop.assignee && <span>Phụ trách: {shop.assignee.name}</span>}
              {shop.tags.map((t) => (
                <Badge key={t} tone="muted" size="sm">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {needsReauth && can('shop.connect') && (
              <Button variant="primary" icon={<Plug className="size-4" />} onClick={() => setReauth(true)}>
                Cấp quyền lại
              </Button>
            )}
            {shop.session ? (
              <ButtonLink to={`/sessions/${shop.session.id}`} variant={needsReauth ? 'outline' : 'primary'} icon={<Radio className="size-4" />}>
                Mở phiên đang chạy
              </ButtonLink>
            ) : (
              can('session.create') &&
              can('session.control') &&
              !needsReauth &&
              !shop.legacyHold &&
              shop.status !== 'expired' &&
              shop.status !== 'suspended' && (
                <Button variant="primary" icon={<Zap className="size-4" />} onClick={() => setGoLive(true)}>
                  Phát ngay
                </Button>
              )
            )}
            {can('report.view') && (
              <ButtonLink to="history" icon={<BarChart3 className="size-4" />}>
                Báo cáo
              </ButtonLink>
            )}
          </div>
        </div>
      </div>

      {shop.status === 'suspended' && (
        <Callout tone="neutral" className="mb-4" title="Shop đã ngưng dịch vụ">
          {shop.service.suspendReason} — ngưng từ {fmtDate(shop.service.suspendedAt)}.
        </Callout>
      )}
      {shop.service.state === 'expired' && (
        <Callout tone="danger" className="mb-4" title="Shop đã hết hạn dùng">
          Vẫn xem được dữ liệu và kết thúc phiên đang live, nhưng không tạo hoặc bắt đầu phiên mới. Liên hệ quản trị viên để gia hạn.
        </Callout>
      )}
      {shop.legacyHold && shop.status !== 'suspended' && (
        <Callout
          tone="info"
          className="mb-4"
          icon={<ArrowRightLeft className="size-4" />}
          title="Đang chạy ở hệ thống cũ — hệ thống mới chỉ theo dõi"
          action={
            <div className="flex flex-wrap gap-2">
              {needsReauth && can('shop.connect') && (
                <Button size="sm" icon={<Link2 className="size-3.5" />} onClick={() => setInvite(true)}>
                  Link gửi chủ shop
                </Button>
              )}
              {isStaff && (
                <Button size="sm" variant={needsReauth ? 'outline' : 'primary'} icon={<ArrowRightLeft className="size-3.5" />} onClick={() => void cutover()}>
                  Chuyển hẳn sang hệ thống mới
                </Button>
              )}
            </div>
          }
        >
          {needsReauth ? 'Bước 1: gửi link cho chủ shop cấp quyền cho hệ thống mới — phiên đang chạy ở hệ thống cũ không bị ảnh hưởng. ' : 'Đã có quyền Shopee cho hệ thống mới. '}
          Hệ thống mới chỉ đọc phiên, sản phẩm, bình luận và tự làm mới token; không tạo / kết thúc phiên, không ghim, không chạy lịch, không trả lời bình luận cho tới khi bạn chuyển hẳn shop này.
        </Callout>
      )}
      {needsReauth && !shop.legacyHold && shop.status !== 'suspended' && (
        <Callout tone="warning" className="mb-4" title="Cần cấp quyền Shopee cho ứng dụng" action={can('shop.connect') && <Button size="sm" onClick={() => setReauth(true)}>Cấp quyền lại</Button>}>
          {shop.connectionError ?? 'Token Shopee không còn hiệu lực.'} Chủ shop cần đăng nhập Shopee bằng tài khoản shop và đồng ý cấp quyền.
        </Callout>
      )}

      <nav className="scrollbar-none -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 pb-2 pt-1 text-sm font-medium transition-colors',
                isActive ? 'text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-500' : 'text-muted hover:text-fg',
              )
            }
          >
            <t.icon className="size-3.5" />
            {t.label}
            {t.badge && <span className="text-2xs text-brand-500">{t.badge}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Đổi tab trong shop: đầu trang shop giữ nguyên, chỉ phần tab chờ tải */}
      <Suspense fallback={<PageLoading />}>
        <Outlet context={{ shop, refetch: () => void q.refetch() } satisfies ShopCtx} />
      </Suspense>
      <ConnectShopDialog open={reauth} onClose={() => setReauth(false)} reauthShopId={shop.id} reauthName={shop.name} />
      <GoLiveDialog open={goLive} onClose={() => setGoLive(false)} shopId={shop.id} shopName={shop.name} />
      <ConnectInvitesDialog open={invite} onClose={() => setInvite(false)} shopIds={[shop.id]} />
    </div>
  );
}
