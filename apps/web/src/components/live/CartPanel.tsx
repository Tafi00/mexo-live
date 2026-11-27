import { useEffect, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ListPlus, Pin, Plus, RefreshCw, ShoppingCart, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { LiveSession } from '@/lib/types';
import { ProductPicker, ProductThumb, StockBadge } from '@/components/domain/ProductPicker';
import { Button } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, EmptyState, ErrorState, Progress, Skeleton, Spinner } from '@/components/ui/misc';
import { useShopTemplates } from './helpers';
import type { CartAddResult, CartPlan, CartView } from './types';

function AddResult({ r, onClose }: { r: CartAddResult; onClose: () => void }) {
  const tone = r.failed ? 'danger' : r.skipped.length ? 'warning' : 'success';
  return (
    <Callout
      tone={tone}
      className="mx-4 mt-3"
      title={`Đã thêm ${r.added.length} sản phẩm vào giỏ live`}
      action={
        <button type="button" onClick={onClose} className="rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Đóng">
          <X className="size-4" />
        </button>
      }
    >
      {r.skipped.length > 0 && (
        <div className="mt-1">
          <p>Bỏ qua {r.skipped.length} sản phẩm:</p>
          <ul className="mt-0.5 max-h-28 list-disc overflow-y-auto pl-4 text-xs">
            {r.skipped.map((s) => (
              <li key={s.itemId}>
                <span className="font-mono">{s.itemId}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.failed && (
        <p className="mt-1">
          Shopee từ chối {r.failed.itemIds.length} sản phẩm: {r.failed.error}
        </p>
      )}
    </Callout>
  );
}

function PlanDialog({ session, open, onClose, onAdd, adding }: { session: LiveSession; open: boolean; onClose: () => void; onAdd: (ids: number[]) => void; adding: boolean }) {
  const tpl = useShopTemplates(session.shopId, open);
  const [templateId, setTemplateId] = useState<number | null>(null);
  useEffect(() => {
    if (open) setTemplateId(null);
  }, [open]);
  useEffect(() => {
    const list = tpl.data?.items ?? [];
    if (!open || !list.length) return;
    if (templateId !== null && list.some((t) => t.id === templateId)) return;
    setTemplateId(list.find((t) => t.id === session.templateId)?.id ?? list[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tpl.data, templateId]);
  const plan = useQuery({
    queryKey: ['session-cart-plan', session.id, templateId],
    queryFn: () => api.post<CartPlan>(`/api/sessions/${session.id}/cart/plan`, { templateId }),
    enabled: open && templateId !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const p = plan.data;
  const room = p ? Math.max(0, p.limit - p.cartCount) : 0;
  const over = p ? Math.max(0, p.toAdd.length - room) : 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nạp giỏ từ mẫu phát"
      description="Thêm các sản phẩm ghim trong mẫu phát vào giỏ live theo thứ tự video. Chỉ thêm, không gỡ sản phẩm đang có."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" icon={<ListPlus className="size-4" />} disabled={!p || !p.toAdd.length || plan.isFetching} loading={adding} onClick={() => p && onAdd(p.toAdd)}>
            Thêm {p ? p.toAdd.length : ''} sản phẩm
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Mẫu phát">
          <Select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}>
            {!tpl.data?.items.length && <option value="">{tpl.isLoading ? 'Đang tải…' : 'Shop chưa có mẫu phát'}</option>}
            {tpl.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.number} · {t.name} ({t.productCount} sản phẩm)
              </option>
            ))}
          </Select>
        </Field>
        {plan.isFetching ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
            <Spinner /> Đang đối chiếu với giỏ live trên Shopee…
          </div>
        ) : plan.isError ? (
          <Callout tone="danger">{plan.error instanceof Error ? plan.error.message : 'Không lập được kế hoạch'}</Callout>
        ) : p ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Sản phẩm trong mẫu', value: p.ordered.length },
                { label: 'Đã có trong giỏ', value: p.alreadyIn.length },
                { label: 'Sẽ thêm', value: p.toAdd.length },
              ].map((x) => (
                <div key={x.label} className="rounded-lg bg-surface-2 px-2 py-2.5">
                  <p className="text-lg font-semibold tabular">{fmtNumber(x.value)}</p>
                  <p className="text-xs text-muted">{x.label}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">
              Giỏ hiện có {p.cartCount}/{p.limit} sản phẩm · còn {room} chỗ trống.
            </p>
            {over > 0 && (
              <Callout tone="warning" title="Giỏ live không đủ chỗ">
                Chỉ thêm được {room} sản phẩm đầu tiên; {over} sản phẩm sau sẽ bị bỏ qua. Gỡ bớt sản phẩm không cần thiết khỏi giỏ để đủ chỗ.
              </Callout>
            )}
            {!p.toAdd.length && <Callout tone="success">Giỏ live đã có đủ sản phẩm của mẫu phát này.</Callout>}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Giỏ live trên Shopee: xem, thêm (chọn/dán mã), gỡ, nạp từ mẫu */
export function CartPanel({
  session,
  cartQ,
  canManage,
  canPin,
}: {
  session: LiveSession;
  cartQ: UseQueryResult<CartView>;
  canManage: boolean;
  canPin: boolean;
}) {
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [result, setResult] = useState<CartAddResult | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const cart = cartQ.data;
  const ended = session.state === 'ended';
  const live = session.state === 'live';
  const inv = [['session-cart', session.id], ['session', session.id]];
  // Ghim hiện tại: ưu tiên bản ghi phiên (làm mới mỗi vài giây), dự phòng theo Shopee khi đọc giỏ
  const pinnedId = session.pinnedItemId ?? cart?.pinned ?? null;

  const add = useAction((itemIds: number[]) => api.post<CartAddResult>(`/api/sessions/${session.id}/cart/add`, { itemIds }), {
    invalidate: inv,
    success: (r) => (r.failed ? null : r.added.length ? `Đã thêm ${r.added.length} sản phẩm vào giỏ live` : null),
    onSuccess: (r) => {
      setResult(r);
      setPlanOpen(false);
    },
  });
  const remove = useAction((itemIds: number[]) => api.post(`/api/sessions/${session.id}/cart/remove`, { itemIds }), {
    invalidate: inv,
    success: 'Đã gỡ sản phẩm khỏi giỏ live',
    onSuccess: () => setSel(new Set()),
  });
  const pin = useAction((itemId: number) => api.post(`/api/sessions/${session.id}/pin`, { itemId }), {
    invalidate: [['session', session.id], ['session-cart', session.id], ['live']],
    success: 'Đã ghim sản phẩm',
  });

  async function askRemove(ids: number[], name?: string) {
    const pinnedHit = pinnedId !== null && ids.includes(pinnedId);
    const r = await confirm({
      title: ids.length === 1 ? 'Gỡ sản phẩm khỏi giỏ live?' : `Gỡ ${ids.length} sản phẩm khỏi giỏ live?`,
      description: (
        <>
          {name && <p className="mb-1 font-medium text-fg">{name}</p>}
          Người xem sẽ không thấy {ids.length === 1 ? 'sản phẩm này' : 'các sản phẩm này'} trong giỏ live nữa.
          {pinnedHit && ' Sản phẩm đang được ghim cũng sẽ bị bỏ ghim.'}
        </>
      ),
      danger: true,
      confirmText: 'Gỡ khỏi giỏ',
    });
    if (r.ok) remove.mutate(ids);
  }

  const items = cart?.items ?? [];
  const allSel = items.length > 0 && items.every((i) => sel.has(i.itemId));
  const excludeIds = items.map((i) => i.product?.id).filter((x): x is number => typeof x === 'number');

  return (
    <Card>
      <CardHeader
        title="Giỏ live"
        icon={<ShoppingCart className="size-4" />}
        description={cart ? `${cart.count}/${cart.limit} sản phẩm trên Shopee` : 'Sản phẩm người xem thấy trong giỏ của phiên'}
        actions={
          !ended && (
            <>
              <Button iconOnly size="sm" variant="ghost" icon={<RefreshCw className={cn('size-4', cartQ.isFetching && 'animate-spin')} />} onClick={() => cartQ.refetch()} aria-label="Làm mới giỏ live" />
              {canManage && (
                <>
                  <Button size="sm" icon={<ListPlus className="size-3.5" />} onClick={() => setPlanOpen(true)}>
                    Nạp từ mẫu phát
                  </Button>
                  <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setPickerOpen(true)} disabled={Boolean(cart && cart.count >= cart.limit)}>
                    Thêm sản phẩm
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      {ended ? (
        <EmptyState compact icon={ShoppingCart} title="Phiên đã kết thúc" description="Giỏ live chỉ tồn tại khi phiên còn mở trên Shopee." />
      ) : !session.shopeeSessionId ? (
        <EmptyState compact icon={ShoppingCart} title="Phiên chưa có Session ID trên Shopee" />
      ) : cartQ.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : cartQ.isError ? (
        <ErrorState error={cartQ.error} onRetry={() => cartQ.refetch()} />
      ) : (
        <>
          {cart && <Progress value={cart.count} max={cart.limit} tone={cart.count >= cart.limit ? 'danger' : cart.count >= cart.limit * 0.9 ? 'warning' : 'brand'} size="sm" className="rounded-none" />}
          {result && <AddResult r={result} onClose={() => setResult(null)} />}
          {sel.size > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-y border-line bg-brand-50/60 px-4 py-1.5 dark:bg-brand-950/20">
              <span className="text-sm font-medium">Đã chọn {sel.size}</span>
              <button onClick={() => setSel(new Set())} className="rounded p-0.5 text-muted hover:text-fg" aria-label="Bỏ chọn">
                <X className="size-4" />
              </button>
              <Button size="xs" variant="danger-outline" className="ml-auto" icon={<Trash2 className="size-3.5" />} loading={remove.isPending} onClick={() => askRemove([...sel])}>
                Gỡ khỏi giỏ
              </Button>
            </div>
          )}
          {!items.length ? (
            <EmptyState compact icon={ShoppingCart} title="Giỏ live đang trống" description={canManage ? 'Thêm sản phẩm từ danh mục hoặc nạp theo mẫu phát.' : undefined} />
          ) : (
            <div>
              {canManage && (
                <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
                  <Checkbox
                    checked={allSel}
                    indeterminate={!allSel && items.some((i) => sel.has(i.itemId))}
                    onChange={(v) => setSel(v ? new Set(items.map((i) => i.itemId)) : new Set())}
                    label={<span className="text-xs text-muted">Chọn tất cả</span>}
                  />
                </div>
              )}
              <ul className="max-h-[440px] divide-y divide-line overflow-y-auto">
                {items.map((it) => {
                  const p = it.product;
                  const isPinned = pinnedId === it.itemId;
                  return (
                    <li key={it.itemId} className={cn('group flex items-center gap-3 px-4 py-2', isPinned && 'bg-brand-50/60 dark:bg-brand-950/20')}>
                      {canManage && (
                        <Checkbox
                          checked={sel.has(it.itemId)}
                          onChange={(v) => {
                            const n = new Set(sel);
                            if (v) n.add(it.itemId);
                            else n.delete(it.itemId);
                            setSel(n);
                          }}
                        />
                      )}
                      <span className="w-6 shrink-0 text-right text-xs tabular text-subtle">{it.position}</span>
                      <ProductThumb url={p?.imageUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-medium leading-snug" title={p?.name}>{p?.name ?? <span className="text-muted">Sản phẩm {it.itemId} (chưa có trong danh mục MEXO)</span>}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                          <span className="font-mono">{p?.sku || it.itemId}</span>
                          {p && <span>{fmtMoney(p.price)}</span>}
                          {p && <StockBadge stock={p.stock} />}
                        </p>
                      </div>
                      {isPinned && (
                        <Badge tone="brand" size="sm" icon={<Pin className="size-3" />}>
                          Đang ghim
                        </Badge>
                      )}
                      <div className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        {canPin && live && !isPinned && (
                          <Button size="xs" variant="ghost" icon={<Pin className="size-3.5" />} disabled={pin.isPending || (p !== null && (p.stock ?? 0) <= 0)} onClick={() => pin.mutate(it.itemId)}>
                            Ghim
                          </Button>
                        )}
                        {canManage && (
                          <Button size="xs" variant="ghost" iconOnly icon={<Trash2 className="size-3.5" />} onClick={() => askRemove([it.itemId], p?.name)} aria-label="Gỡ khỏi giỏ" />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
      <ProductPicker
        shopId={session.shopId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple
        inStockOnly
        title="Thêm sản phẩm vào giỏ live"
        excludeIds={excludeIds}
        onPick={(ps) => {
          if (ps.length) add.mutate(ps.map((x) => x.itemId));
        }}
      />
      <PlanDialog session={session} open={planOpen} onClose={() => setPlanOpen(false)} adding={add.isPending} onAdd={(ids) => add.mutate(ids)} />
    </Card>
  );
}
