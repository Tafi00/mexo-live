import { useMemo, useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { foldVi } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMoney } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { LiveSession } from '@/lib/types';
import { ProductThumb, StockBadge } from '@/components/domain/ProductPicker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, EmptyState, Spinner } from '@/components/ui/misc';
import type { CartView, PinnedProduct } from './types';

const pinMeta = {
  ok: { label: 'Đang ghim', tone: 'success' as const },
  attn: { label: 'Ghim lỗi', tone: 'danger' as const },
  off: { label: 'Không ghim', tone: 'muted' as const },
};

function ManualPinDialog({ open, onClose, cart, loading, pinnedItemId, onPick, busyId }: { open: boolean; onClose: () => void; cart: CartView | undefined; loading: boolean; pinnedItemId: number | null; onPick: (itemId: number) => void; busyId: number | null }) {
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const f = foldVi(q);
    return (cart?.items ?? []).filter((it) => !f || foldVi(it.product?.name).includes(f) || String(it.itemId).includes(f) || foldVi(it.product?.sku).includes(f));
  }, [cart, q]);
  return (
    <Dialog open={open} onClose={onClose} title="Ghim sản phẩm thủ công" description="Chọn sản phẩm trong giỏ live. Ghim tay được giữ tới khi chuyển sang video tiếp theo, sau đó hệ thống ghim lại theo mẫu phát." size="lg">
      <div className="space-y-3">
        <SearchInput value={q} onChange={setQ} placeholder="Tên, SKU hoặc ID sản phẩm…" autoFocus />
        <div className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {loading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : !items.length ? (
            <EmptyState compact icon={PinOff} title={cart?.items.length ? 'Không có sản phẩm khớp' : 'Giỏ live đang trống'} description={cart?.items.length ? undefined : 'Thêm sản phẩm vào giỏ live trước khi ghim.'} />
          ) : (
            items.map((it) => {
              const p = it.product;
              const isPinned = it.itemId === pinnedItemId;
              const out = p !== null && (p.stock ?? 0) <= 0;
              return (
                <div key={it.itemId} className={cn('flex items-center gap-3 px-3 py-2', isPinned && 'bg-brand-50/60 dark:bg-brand-950/20')}>
                  <span className="w-6 text-right text-xs tabular text-subtle">{it.position}</span>
                  <ProductThumb url={p?.imageUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[13px] font-medium">{p?.name ?? `Sản phẩm ${it.itemId}`}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                      <span className="font-mono">{p?.sku || it.itemId}</span>
                      {p && <span>{fmtMoney(p.price)}</span>}
                      {p && <StockBadge stock={p.stock} />}
                    </p>
                  </div>
                  {isPinned ? (
                    <Badge tone="brand" size="sm">
                      Đang ghim
                    </Badge>
                  ) : (
                    <Button size="xs" variant="outline" icon={<Pin className="size-3.5" />} disabled={out || busyId !== null} loading={busyId === it.itemId} onClick={() => onPick(it.itemId)}>
                      {out ? 'Hết hàng' : 'Ghim'}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function PinnedPanel({ session, pinned, cart, cartLoading, canPin }: { session: LiveSession; pinned: PinnedProduct | null; cart: CartView | undefined; cartLoading: boolean; canPin: boolean }) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const meta = pinMeta[session.pinState] ?? pinMeta.off;
  const live = session.state === 'live';
  const pin = useAction((itemId: number) => api.post(`/api/sessions/${session.id}/pin`, { itemId }), {
    success: 'Đã ghim sản phẩm',
    invalidate: [['session', session.id], ['session-cart', session.id], ['live']],
    onSuccess: () => {
      setBusyId(null);
      setOpen(false);
    },
    onError: () => setBusyId(null),
  });

  return (
    <Card>
      <CardHeader
        title="Sản phẩm đang ghim"
        icon={<Pin className="size-4" />}
        actions={
          <Badge tone={meta.tone} size="sm" dot>
            {meta.label}
          </Badge>
        }
      />
      <div className="space-y-3 p-5">
        {pinned ? (
          <div className="flex items-center gap-3">
            <ProductThumb url={pinned.imageUrl} className="size-14" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] font-medium">{pinned.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                <span className="font-mono">{pinned.sku || pinned.itemId}</span>
                {pinned.price !== undefined && pinned.price !== null && <span>{fmtMoney(pinned.price)}</span>}
                {pinned.stock !== undefined && <StockBadge stock={pinned.stock} />}
              </p>
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-3 text-center text-xs text-muted">Chưa ghim sản phẩm nào.</p>
        )}
        {session.pinError && (
          <Callout tone="danger" title="Ghim lỗi">
            {session.pinError}
          </Callout>
        )}
        {canPin && session.origin !== 'external' && (
          <Button className="w-full" icon={<Pin className="size-4" />} disabled={!live} onClick={() => setOpen(true)}>
            Ghim sản phẩm khác
          </Button>
        )}
        {canPin && !live && session.state !== 'ended' && <p className="text-center text-xs text-muted">Chỉ ghim được khi phiên đang live trên Shopee.</p>}
        {live && session.playlist?.length ? <p className="text-xs text-muted">Khi phát tự động, hệ thống tự đổi ghim theo sản phẩm của từng video.</p> : null}
      </div>
      <ManualPinDialog
        open={open}
        onClose={() => setOpen(false)}
        cart={cart}
        loading={cartLoading}
        pinnedItemId={session.pinnedItemId}
        busyId={busyId}
        onPick={(itemId) => {
          setBusyId(itemId);
          pin.mutate(itemId);
        }}
      />
    </Card>
  );
}
