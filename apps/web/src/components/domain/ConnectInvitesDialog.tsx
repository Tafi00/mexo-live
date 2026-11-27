import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Download, Link2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useCopy } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Callout, Spinner } from '@/components/ui/misc';

export interface InviteItem {
  shopId: number;
  shopName: string;
  url: string | null;
  expiresAt: string | null;
  connected: boolean;
  error?: string;
}

/**
 * Tạo link cấp quyền gửi chủ shop (dùng được nhiều ngày). Mỗi lần mở link, hệ thống mới tạo link Shopee
 * nên không lo hết hạn sau vài phút như link Shopee gốc. Shop vẫn chạy ở hệ thống cũ trong lúc cấp quyền.
 */
export function ConnectInvitesDialog({ open, onClose, shopIds }: { open: boolean; onClose: () => void; shopIds: number[] }) {
  const copy = useCopy();
  const [items, setItems] = useState<InviteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError(null);
    api
      .post<{ items: InviteItem[] }>('/api/shops/connect-invites', { shopIds, days: 14 })
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ready = (items ?? []).filter((i) => i.url);
  const text = ready.map((i) => `${i.shopName}: ${i.url}`).join('\n');

  function downloadCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [['Shop', 'Link cấp quyền', 'Hết hạn', 'Đã kết nối'].map(esc).join(','), ...ready.map((i) => [i.shopName, i.url!, i.expiresAt ? fmtDate(i.expiresAt) : '', i.connected ? 'Có' : 'Chưa'].map(esc).join(','))];
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `link-cap-quyen-${ready.length}-shop.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Link cấp quyền gửi chủ shop"
      description="Dùng được 14 ngày. Chủ shop mở link, đăng nhập Shopee bằng tài khoản shop và bấm đồng ý — không cần tài khoản MEXO."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
          <Button icon={<Download className="size-4" />} disabled={!ready.length} onClick={downloadCsv}>
            Tải CSV
          </Button>
          <Button variant="primary" icon={<Copy className="size-4" />} disabled={!ready.length} onClick={() => void copy(text, `Đã sao chép ${ready.length} link`)}>
            Sao chép tất cả
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout tone="info">
          Cấp quyền <b>không ảnh hưởng</b> phiên đang chạy ở hệ thống cũ: shop vẫn ở chế độ "Đang chạy ở hệ thống cũ", hệ thống mới chỉ theo dõi cho tới khi bạn bấm "Chuyển hẳn sang hệ thống mới".
        </Callout>
        {error && <Callout tone="danger">{error}</Callout>}
        {!items && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Spinner /> Đang tạo link…
          </div>
        )}
        {items && (
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {items.map((i) => (
              <li key={i.shopId} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {i.shopName}
                    {i.connected && (
                      <Badge tone="success" size="sm" icon={<CheckCircle2 className="size-3" />}>
                        Đã kết nối
                      </Badge>
                    )}
                  </p>
                  {i.url ? (
                    <p className="truncate font-mono text-2xs text-muted" title={i.url}>
                      {i.url}
                    </p>
                  ) : (
                    <p className="text-xs text-rose-600 dark:text-rose-400">{i.error}</p>
                  )}
                </div>
                {i.url && (
                  <Button size="xs" variant="ghost" iconOnly icon={<Link2 className="size-3.5" />} aria-label={`Sao chép link của ${i.shopName}`} onClick={() => void copy(i.url!, `Đã sao chép link của ${i.shopName}`)} />
                )}
              </li>
            ))}
          </ul>
        )}
        {ready.length > 0 && <p className="text-xs text-muted">Hết hạn ngày {fmtDate(ready[0]!.expiresAt!)}. Tạo lại link cho cùng shop sẽ trả lại đúng link cũ nếu còn hạn.</p>}
      </div>
    </Dialog>
  );
}
