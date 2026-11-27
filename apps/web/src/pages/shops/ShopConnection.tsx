import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, History, PauseCircle, PlayCircle, Plug, ShieldCheck, Stethoscope, UserRoundCog, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { CONNECTION_LABELS } from '@mexo/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtDate, fmtDateTime, fmtRelative, todayVn } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ConnectShopDialog } from '@/components/domain/ConnectShopDialog';
import { ConnectionBadge, ServiceBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, KV } from '@/components/ui/misc';
import { useShop } from './ShopLayout';

export default function ShopConnection() {
  const { shop, refetch } = useShop();
  const { isStaff, isSysadmin, can, role } = useAuth();
  const confirm = useConfirm();
  const [reauth, setReauth] = useState(false);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [cartLimit, setCartLimit] = useState(String(shop.cartLimit));
  const names = useQuery({ queryKey: ['shop', shop.id, 'names'], queryFn: () => api.get(`/api/shops/${shop.id}/names`) });
  const owners = useQuery({ queryKey: ['accounts', 'owners'], queryFn: async () => (await api.get('/api/accounts')).items.filter((a: any) => a.role === 'owner'), enabled: isStaff });

  const check = useAction(() => api.post(`/api/shops/${shop.id}/check`), {
    onSuccess: (r) => {
      setCheckResult(r);
      refetch();
    },
  });

  async function setExpiry(unlimited = false) {
    let date: string | null = null;
    if (!unlimited) {
      const r = await confirm({ title: 'Đặt hạn dùng', description: 'Hạn dùng theo hợp đồng, tính theo giờ Việt Nam.', input: { label: 'Hạn dùng mới', type: 'date', required: true, defaultValue: shop.service.expiresOn ?? addDaysStr(todayVn(), 365) }, confirmText: 'Lưu' });
      if (!r.ok) return;
      date = r.value;
    } else {
      const r = await confirm({ title: 'Đặt hạn "không thời hạn"?', description: 'Shop sẽ không bao giờ hết hạn dùng dịch vụ.', confirmText: 'Đồng ý' });
      if (!r.ok) return;
    }
    try {
      await api.post(`/api/shops/${shop.id}/service-expiry`, { date });
      toast.success('Đã cập nhật hạn dùng');
      refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function suspend() {
    const r = await confirm({ title: 'Ngưng dịch vụ shop này?', description: 'Dùng khi chấm dứt hợp đồng. Chủ shop không vào được nữa, video đang phát sẽ dừng.', danger: true, input: { label: 'Lý do', required: true, multiline: true }, confirmText: 'Ngưng dịch vụ', requireText: 'NGUNG' });
    if (!r.ok) return;
    try {
      await api.post(`/api/shops/${shop.id}/suspend`, { reason: r.value });
      toast.success('Đã ngưng dịch vụ');
      refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function reopen() {
    const r = await confirm({ title: 'Mở lại dịch vụ', description: 'Bắt buộc nhập hạn dùng mới. Dùng lại token cũ, không cần cấp quyền lại nếu token còn hiệu lực.', input: { label: 'Hạn dùng mới', type: 'date', required: true, defaultValue: addDaysStr(todayVn(), 365) }, confirmText: 'Mở lại' });
    if (!r.ok) return;
    try {
      await api.post(`/api/shops/${shop.id}/reopen`, { serviceExpiresOn: r.value });
      toast.success('Đã mở lại dịch vụ');
      refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function changeOwner(ownerId: string) {
    const id = ownerId ? Number(ownerId) : null;
    let verification: string | undefined;
    if (id) {
      const r = await confirm({ title: 'Gắn shop cho chủ shop', description: 'Bắt buộc ghi cách xác minh đúng chủ shop (ví dụ: đã gọi đúng số điện thoại đăng ký trên Shopee).', input: { label: 'Cách xác minh', required: true, multiline: true } });
      if (!r.ok) return;
      verification = r.value;
    }
    try {
      await api.post(`/api/shops/${shop.id}/owner`, { ownerId: id, verification });
      toast.success(id ? 'Đã gắn chủ shop' : 'Đã gỡ chủ shop');
      refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const saveCart = useAction(() => api.patch(`/api/shops/${shop.id}`, { cartLimit: Number(cartLimit) }), { success: 'Đã lưu giới hạn giỏ live', onSuccess: refetch });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Kết nối Shopee"
          icon={<Plug className="size-4" />}
          description="Quyền do Shopee cấp, tối đa 365 ngày. Hết hạn thì chủ shop phải cấp quyền lại."
          actions={
            <>
              <Button size="sm" icon={<Stethoscope className="size-3.5" />} loading={check.isPending} onClick={() => check.mutate()}>
                Kiểm tra kết nối
              </Button>
              {can('shop.connect') && shop.status !== 'suspended' && (
                <Button size="sm" variant="primary" icon={<Plug className="size-3.5" />} onClick={() => setReauth(true)}>
                  Cấp quyền lại
                </Button>
              )}
            </>
          }
        />
        <div className="space-y-4 p-5">
          <KV
            items={[
              { label: 'Trạng thái', value: <ConnectionBadge state={shop.connection} /> },
              { label: 'Hạn uỷ quyền Shopee', value: shop.authExpiresAt ? `${fmtDate(shop.authExpiresAt)} (${fmtRelative(shop.authExpiresAt)})` : '—' },
              { label: 'Access token', value: shop.accessExpiresAt ? `Làm mới ${fmtRelative(shop.tokenRefreshedAt)} · hết hạn ${fmtRelative(shop.accessExpiresAt)}` : 'Chưa có' },
              { label: 'Quyền Livestream', value: shop.livestreamCheck === 'ok' ? <Badge tone="success">Dùng được</Badge> : shop.livestreamCheck === 'denied' ? <Badge tone="danger">Bị từ chối</Badge> : <Badge tone="muted">Chưa kiểm tra</Badge> },
              { label: 'Kiểm tra gần nhất', value: shop.lastCheckedAt ? fmtDateTime(shop.lastCheckedAt) : '—' },
              { label: 'Khu vực', value: shop.region },
            ]}
          />
          {shop.connectionError && shop.connection !== 'ok' && <Callout tone="warning">{shop.connectionError}</Callout>}
          {checkResult && (
            <div className="space-y-2 rounded-lg border border-line p-3 text-sm">
              <p className="font-medium">Kết quả kiểm tra</p>
              {[
                ['Thông tin shop (shop/get_shop_info)', checkResult.shop],
                ['Danh mục sản phẩm (product/get_item_list)', checkResult.product],
              ].map(([label, r]: any) => (
                <p key={label} className="flex items-start gap-2">
                  {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                  <span>
                    {label}
                    {r.message && <span className="block text-xs text-muted">{r.message}</span>}
                  </span>
                </p>
              ))}
            </div>
          )}
          <Callout tone="neutral" icon={<ShieldCheck className="size-4" />}>
            Token được mã hóa AES-256 trong cơ sở dữ liệu, tự làm mới trước khi hết hạn và không bao giờ hiển thị trong nhật ký.
          </Callout>
        </div>
      </Card>

      <Card>
        <CardHeader title="Hạn dùng dịch vụ" icon={<CalendarPlus className="size-4" />} description="Do MEXO đặt theo hợp đồng, tính theo giờ Việt Nam" />
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <ServiceBadge state={shop.service.state} daysLeft={shop.service.daysLeft} expiresOn={shop.service.expiresOn} />
            <span className="text-sm text-muted">{shop.service.expiresOn ? `Hết hạn ngày ${fmtDate(shop.service.expiresOn)}` : shop.service.state !== 'suspended' ? 'Không thời hạn' : ''}</span>
          </div>
          <p className="text-xs text-muted">Hết hạn dùng: vẫn xem được dữ liệu và kết thúc phiên đang live; phiên đang live sẽ tự ngắt sau thời gian ân hạn.</p>
          {isStaff ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<CalendarPlus className="size-3.5" />} onClick={() => setExpiry(false)}>
                Đặt hạn dùng
              </Button>
              {isSysadmin && (
                <Button size="sm" variant="secondary" onClick={() => setExpiry(true)}>
                  Không thời hạn
                </Button>
              )}
              {shop.status === 'suspended' ? (
                <Button size="sm" variant="success" icon={<PlayCircle className="size-3.5" />} onClick={reopen}>
                  Mở lại dịch vụ
                </Button>
              ) : (
                <Button size="sm" variant="danger-outline" icon={<PauseCircle className="size-3.5" />} onClick={suspend}>
                  Ngưng dịch vụ
                </Button>
              )}
            </div>
          ) : (
            <Callout tone="neutral">Liên hệ quản trị viên MEXO để gia hạn.</Callout>
          )}
        </div>
      </Card>

      {isStaff && (
        <Card>
          <CardHeader title="Chủ shop & giới hạn" icon={<UserRoundCog className="size-4" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Chủ shop" hint="Gắn thủ công bắt buộc ghi cách xác minh">
              <Select value={shop.owner?.id ?? ''} onChange={(e) => void changeOwner(e.target.value)}>
                <option value="">— MEXO vận hành —</option>
                {(owners.data ?? []).map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.name} (@{o.username})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Giới hạn giỏ live" hint="100 hoặc 500 sản phẩm tùy shop (theo Shopee)">
              <div className="flex gap-2">
                <Input type="number" min={1} max={500} value={cartLimit} onChange={(e) => setCartLimit(e.target.value)} />
                <Button onClick={() => saveCart.mutate()} loading={saveCart.isPending} disabled={Number(cartLimit) === shop.cartLimit}>
                  Lưu
                </Button>
              </div>
            </Field>
          </div>
        </Card>
      )}

      {role !== 'member' && (
        <Card>
          <CardHeader title="Lịch sử tên shop" icon={<History className="size-4" />} description="Tìm theo tên cũ vẫn ra đúng shop" />
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {(names.data?.items ?? []).map((n: any) => (
              <li key={n.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <Badge tone={n.kind === 'alias' ? 'info' : 'neutral'} size="sm">
                  {n.kind === 'alias' ? 'Tên gợi nhớ' : 'Tên Shopee'}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{n.name}</span>
                <span className="text-xs text-muted">{fmtDate(n.at)}</span>
              </li>
            ))}
            {!names.data?.items?.length && <li className="px-5 py-4 text-center text-xs text-muted">Chưa có lịch sử</li>}
          </ul>
        </Card>
      )}
      <ConnectShopDialog open={reauth} onClose={() => setReauth(false)} reauthShopId={shop.id} reauthName={shop.name} />
    </div>
  );
}
