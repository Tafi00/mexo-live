import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardPaste, Copy, ExternalLink, Link2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtTime, todayVn } from '@/lib/format';
import { useCopy, useNow } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';

/**
 * Kết nối shop qua cấp quyền chính thức Shopee Open Platform.
 * - Quản trị: nhập hạn dùng theo hợp đồng (+ chủ shop), lấy liên kết dùng một lần gửi cho chủ shop.
 * - Chủ shop: tự mở liên kết, shop mới gắn vào tài khoản.
 * - reauthShopId: cấp quyền lại đúng shop đang chọn.
 * - Dự phòng: dán địa chỉ có code + shop_id (+ state).
 */
export function ConnectShopDialog({ open, onClose, reauthShopId, reauthName }: { open: boolean; onClose: () => void; reauthShopId?: number; reauthName?: string }) {
  const { isStaff, isSysadmin } = useAuth();
  const qc = useQueryClient();
  const copy = useCopy();
  const now = useNow(1000);
  const [mode, setMode] = useState<'link' | 'paste'>('link');
  const [expiry, setExpiry] = useState(addDaysStr(todayVn(), 365));
  const [unlimited, setUnlimited] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string; state: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [done, setDone] = useState<{ shopName: string; created: boolean } | null>(null);

  useEffect(() => {
    if (open) {
      setLink(null);
      setDone(null);
      setPasteUrl('');
      setMode('link');
    }
  }, [open]);

  const owners = useQuery({
    queryKey: ['accounts', 'owners'],
    queryFn: async () => (await api.get('/api/accounts')).items.filter((a: any) => a.role === 'owner'),
    enabled: open && isStaff && !reauthShopId,
  });

  // Theo dõi liên kết đã được dùng chưa
  const status = useQuery({
    queryKey: ['connect-status', link?.state],
    queryFn: () => api.get('/api/connect/status', { state: link!.state }),
    enabled: Boolean(link) && !done,
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (status.data?.used && status.data.result && !done) {
      setDone({ shopName: 'Shop', created: status.data.result.created });
      void qc.invalidateQueries({ queryKey: ['shops'] });
      void qc.invalidateQueries({ queryKey: ['shop'] });
      toast.success('Shop đã cấp quyền thành công');
    }
  }, [status.data, done, qc]);

  async function createLink() {
    setBusy(true);
    try {
      const r = reauthShopId
        ? await api.post('/api/connect/reauth', { shopId: reauthShopId })
        : await api.post('/api/connect/link', isStaff ? { serviceExpiresOn: unlimited ? null : expiry, ownerId: ownerId ? Number(ownerId) : null } : {});
      setLink(r);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitPaste() {
    setBusy(true);
    try {
      const r = await api.post('/api/connect/paste', {
        url: pasteUrl,
        ...(reauthShopId ? { shopId: reauthShopId } : isStaff ? { serviceExpiresOn: unlimited ? null : expiry, ownerId: ownerId ? Number(ownerId) : null } : {}),
      });
      setDone({ shopName: r.shopName, created: r.created });
      void qc.invalidateQueries({ queryKey: ['shops'] });
      void qc.invalidateQueries({ queryKey: ['shop'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const remaining = link ? Math.max(0, Math.round((new Date(link.expiresAt).getTime() - now) / 1000)) : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={reauthShopId ? `Cấp quyền lại — ${reauthName ?? ''}` : 'Kết nối shop Shopee'}
      description="Qua cơ chế cấp quyền chính thức của Shopee Open Platform. Không cần mật khẩu hay cookie Shopee."
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Xong
          </Button>
        ) : mode === 'paste' ? (
          <Button variant="primary" loading={busy} disabled={pasteUrl.length < 20} onClick={submitPaste}>
            Hoàn tất kết nối
          </Button>
        ) : !link ? (
          <Button variant="primary" loading={busy} onClick={createLink} icon={<Link2 className="size-4" />}>
            Tạo liên kết cấp quyền
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        )
      }
    >
      {done ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
          <p className="mt-3 font-semibold">{done.created ? 'Đã kết nối shop mới' : 'Đã cấp quyền lại'}</p>
          <p className="mt-1 text-sm text-muted">Hệ thống đang tải danh mục sản phẩm từ Shopee.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'link', label: 'Liên kết cấp quyền' },
              { value: 'paste', label: 'Dán địa chỉ' },
            ]}
          />
          {isStaff && !reauthShopId && !link && (
            <div className="space-y-4">
              {
                  <>
                    <Field label="Hạn dùng theo hợp đồng" required hint="Tính theo giờ Việt Nam. Hết hạn: chỉ xem dữ liệu và kết thúc phiên đang live.">
                      <div className="flex flex-wrap items-center gap-3">
                        <Input type="date" value={expiry} min={todayVn()} disabled={unlimited} onChange={(e) => setExpiry(e.target.value)} className="w-44" />
                        <div className="flex gap-1">
                          {[1, 3, 6, 12].map((m) => (
                            <Button key={m} size="xs" variant="secondary" disabled={unlimited} onClick={() => setExpiry(addDaysStr(todayVn(), Math.round(m * 30.4)))}>
                              {m === 12 ? '1 năm' : `${m} tháng`}
                            </Button>
                          ))}
                        </div>
                        {isSysadmin && <Checkbox checked={unlimited} onChange={setUnlimited} label="Không thời hạn" />}
                      </div>
                    </Field>
                    <Field label="Gắn cho chủ shop (tùy chọn)" hint="Bỏ trống nếu MEXO tự vận hành shop này.">
                      <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                        <option value="">— Không gắn —</option>
                        {(owners.data ?? []).map((o: any) => (
                          <option key={o.id} value={o.id}>
                            {o.name} (@{o.username}) — {o.shopCount}/{o.shopLimit ?? '∞'} shop
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </>
              }
            </div>
          )}
          {mode === 'link' ? (
            !link ? (
              <div className="space-y-4">
                <Callout tone="info" icon={<ShieldCheck className="size-4" />}>
                  Hệ thống tạo <b>liên kết dùng một lần</b>, hết hạn sau 15 phút. Gửi cho chủ shop — họ đăng nhập Shopee bằng <b>tài khoản shop</b> (không dùng tài khoản chính) rồi bấm đồng ý. Shop tự xuất hiện trong danh sách.
                </Callout>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Liên kết cấp quyền" hint={remaining ? `Hết hạn lúc ${fmtTime(link.expiresAt)} (còn ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')})` : 'Liên kết đã hết hạn — tạo liên kết mới'}>
                  <div className="flex gap-2">
                    <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                    <Button iconOnly icon={<Copy className="size-4" />} onClick={() => copy(link.url, 'Đã sao chép liên kết')} aria-label="Sao chép" />
                  </div>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<ExternalLink className="size-4" />} onClick={() => window.open(link.url, '_blank', 'noopener')}>
                    Mở trang cấp quyền
                  </Button>
                  <Button variant="secondary" onClick={createLink} loading={busy}>
                    Tạo liên kết mới
                  </Button>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-muted">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
                  </span>
                  Đang chờ chủ shop đồng ý trên Shopee…
                </div>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <Callout tone="neutral" icon={<ClipboardPaste className="size-4" />}>
                Dùng khi cấp quyền từ Console (API Test Tool) hoặc trang chuyển về không mở được. Dán toàn bộ địa chỉ có <code className="font-mono">code</code> và <code className="font-mono">shop_id</code> (và <code className="font-mono">state</code>). Mã chỉ dùng được trong khoảng 10 phút.
              </Callout>
              <Textarea rows={4} value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="https://…/connect/callback?state=…&code=…&shop_id=…" className="font-mono text-xs" />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
