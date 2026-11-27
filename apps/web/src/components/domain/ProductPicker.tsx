import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ClipboardPaste, ImageOff, PackageSearch } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { SearchInput, Segmented, Textarea } from '@/components/ui/form';
import { Badge, EmptyState, Pagination, Spinner } from '@/components/ui/misc';

export interface ProductLite {
  id: number;
  itemId: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  stock: number | null;
  sold?: number | null;
  removed?: boolean;
}

export function ProductThumb({ url, className }: { url: string | null | undefined; className?: string }) {
  const [err, setErr] = useState(false);
  if (!url || err)
    return (
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-subtle ring-1 ring-line', className)}>
        <ImageOff className="size-4" />
      </span>
    );
  return <img src={url} alt="" loading="lazy" onError={() => setErr(true)} className={cn('size-10 shrink-0 rounded-md object-cover ring-1 ring-line', className)} />;
}

export function StockBadge({ stock }: { stock: number | null | undefined }) {
  if (stock === null || stock === undefined) return <span className="text-xs text-subtle">—</span>;
  if (stock <= 0) return <Badge tone="danger" size="sm">Hết hàng</Badge>;
  if (stock <= 10) return <Badge tone="warning" size="sm">Còn {stock}</Badge>;
  return <span className="text-xs tabular text-muted">Kho {fmtNumber(stock)}</span>;
}

/**
 * Hộp chọn sản phẩm từ danh mục shop (đã sao chép từ Shopee).
 * Tìm theo tên, SKU, ID — hoặc dán danh sách mã/link (mỗi dòng 1 sản phẩm, giữ thứ tự).
 */
export function ProductPicker({
  shopId,
  open,
  onClose,
  onPick,
  multiple = false,
  title = 'Chọn sản phẩm',
  excludeIds = [],
  inStockOnly = false,
}: {
  shopId: number;
  open: boolean;
  onClose: () => void;
  onPick: (items: ProductLite[]) => void;
  multiple?: boolean;
  title?: string;
  excludeIds?: number[];
  inStockOnly?: boolean;
}) {
  const [mode, setMode] = useState<'search' | 'paste'>('search');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, ProductLite>>(new Map());
  const [paste, setPaste] = useState('');
  const dq = useDebounced(q, 250);
  useEffect(() => {
    if (open) {
      setSelected(new Map());
      setQ('');
      setPaste('');
      setPage(1);
      setMode('search');
    }
  }, [open]);
  useEffect(() => setPage(1), [dq]);

  const list = useQuery({
    queryKey: ['shop', shopId, 'products', 'picker', dq, page, inStockOnly],
    queryFn: () => api.get(`/api/shops/${shopId}/products`, { q: dq, page, pageSize: 20, filter: inStockOnly ? 'instock' : 'all', sort: 'sold' }),
    enabled: open && mode === 'search',
    placeholderData: (p) => p,
  });
  const resolved = useQuery({
    queryKey: ['shop', shopId, 'products', 'resolve', paste],
    queryFn: () => api.post<{ items: { itemId: number; product: ProductLite | null }[] }>(`/api/shops/${shopId}/products/resolve`, { text: paste }),
    enabled: open && mode === 'paste' && paste.trim().length > 4,
  });

  function toggle(p: ProductLite) {
    if (!multiple) {
      onPick([p]);
      onClose();
      return;
    }
    const m = new Map(selected);
    if (m.has(p.id)) m.delete(p.id);
    else m.set(p.id, p);
    setSelected(m);
  }

  const pasteFound = (resolved.data?.items ?? []).filter((x) => x.product).map((x) => x.product!) as ProductLite[];
  const pasteMissing = (resolved.data?.items ?? []).filter((x) => !x.product);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="Danh mục đã sao chép từ Shopee — tìm theo tên, SKU hoặc ID sản phẩm"
      size="lg"
      footer={
        multiple && (
          <>
            <span className="mr-auto text-xs text-muted">{mode === 'paste' ? `${pasteFound.length} sản phẩm khớp` : `Đã chọn ${selected.size}`}</span>
            <Button variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button
              variant="primary"
              disabled={mode === 'paste' ? !pasteFound.length : !selected.size}
              onClick={() => {
                onPick(mode === 'paste' ? pasteFound : [...selected.values()]);
                onClose();
              }}
            >
              Thêm {mode === 'paste' ? pasteFound.length : selected.size} sản phẩm
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {multiple && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'search', label: 'Tìm trong danh mục' },
              { value: 'paste', label: <span className="inline-flex items-center gap-1"><ClipboardPaste className="size-3.5" />Dán mã / link</span> },
            ]}
          />
        )}
        {mode === 'search' ? (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Tên, SKU hoặc ID sản phẩm…" autoFocus />
            <div className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {list.isLoading ? (
                <div className="flex justify-center p-8">
                  <Spinner />
                </div>
              ) : !list.data?.items.length ? (
                <EmptyState compact icon={PackageSearch} title="Không có sản phẩm" description={list.data?.sync?.status === 'never' ? 'Shop chưa tải danh mục từ Shopee.' : 'Thử từ khóa khác.'} />
              ) : (
                list.data.items.map((p: ProductLite) => {
                  const excluded = excludeIds.includes(p.id);
                  const sel = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={excluded}
                      onClick={() => toggle(p)}
                      className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors disabled:opacity-50', sel ? 'bg-brand-50/70 dark:bg-brand-950/30' : 'hover:bg-surface-2')}
                    >
                      <ProductThumb url={p.imageUrl} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-[13px] font-medium">{p.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                          <span className="font-mono">{p.sku || p.itemId}</span>
                          <span>{fmtMoney(p.price)}</span>
                          <StockBadge stock={p.stock} />
                        </span>
                      </span>
                      {excluded ? <Badge tone="muted" size="sm">Đã có</Badge> : multiple && <span className={cn('grid size-5 place-items-center rounded border', sel ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{sel && <Check className="size-3.5" />}</span>}
                    </button>
                  );
                })
              )}
            </div>
            {list.data && <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
          </>
        ) : (
          <div className="space-y-3">
            <Textarea rows={7} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Mỗi dòng một mã sản phẩm hoặc link Shopee, ví dụ:\n24512345678\nhttps://shopee.vn/San-pham-i.123456.24512345678'} className="font-mono text-xs" />
            {resolved.data && (
              <div className="text-xs text-muted">
                Khớp <b className="text-fg">{pasteFound.length}</b> / {resolved.data.items.length} mã
                {pasteMissing.length > 0 && <span className="text-amber-600"> — {pasteMissing.length} mã không có trong danh mục: {pasteMissing.slice(0, 5).map((x) => x.itemId).join(', ')}{pasteMissing.length > 5 ? '…' : ''}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
