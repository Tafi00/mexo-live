import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardPaste, ListOrdered, MousePointerClick, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/lib/hooks';
import { ProductPicker, ProductThumb, StockBadge, type ProductLite } from '@/components/domain/ProductPicker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Segmented, Textarea } from '@/components/ui/form';
import { Badge, Callout, Spinner } from '@/components/ui/misc';
import { toPinProduct, type PinProduct } from './templateDraft';

export interface QuickAssignTarget {
  key: string;
  /** Vị trí trong danh sách phát (1-based) */
  position: number;
  videoName: string;
  /** Sản phẩm chính hiện tại (null = chưa có) */
  current: { id: number; name: string } | null;
}

type Mode = 'empty' | 'overwrite';
type Source = 'paste' | 'pick';
type RowStatus = 'assign' | 'overwrite' | 'same' | 'unmatched' | 'skip' | 'none';
type MatchedBy = 'id' | 'sku' | null;

/** POST /products/resolve-lines: mỗi dòng 1 kết quả, đúng thứ tự (khớp ID/link trước, sau đó SKU) */
interface ResolveLinesRes {
  items: { line: string; matchedBy: MatchedBy; itemId: number | null; product: ProductLite | null }[];
}

interface PreviewRow {
  target: QuickAssignTarget;
  line: string | null;
  product: PinProduct | null;
  matchedBy: MatchedBy;
  status: RowStatus;
}

const STATUS: Record<RowStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' | 'info' }> = {
  assign: { label: 'Sẽ gán', tone: 'success' },
  overwrite: { label: 'Ghi đè', tone: 'info' },
  same: { label: 'Không đổi', tone: 'muted' },
  unmatched: { label: 'Không khớp ID hoặc SKU', tone: 'danger' },
  skip: { label: 'Bỏ qua', tone: 'muted' },
  none: { label: 'Chưa có dòng', tone: 'muted' },
};

/**
 * Gán sản phẩm chính cho nhiều video cùng lúc, theo thứ tự trong danh sách phát.
 * (a) Dán mã sản phẩm / link Shopee, mỗi dòng 1 video;  (b) chọn nhiều sản phẩm theo thứ tự bấm.
 */
export function QuickAssignDialog({
  shopId,
  open,
  onClose,
  targets,
  preferInStock,
  onApply,
}: {
  shopId: number;
  open: boolean;
  onClose: () => void;
  targets: QuickAssignTarget[];
  preferInStock: boolean;
  onApply: (assignments: { key: string; product: PinProduct }[]) => void;
}) {
  const missing = targets.filter((t) => !t.current).length;
  const [source, setSource] = useState<Source>('paste');
  const [mode, setMode] = useState<Mode>('empty');
  const [start, setStart] = useState('1');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<ProductLite[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (open) {
      setSource('paste');
      setMode(missing > 0 ? 'empty' : 'overwrite');
      setStart('1');
      setText('');
      setPicked([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mỗi dòng không trống = 1 video; dòng "-" = bỏ qua video đó
  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [text],
  );
  const startIdx = Math.max(1, Math.min(targets.length || 1, Math.floor(Number(start) || 1)));
  const slots = useMemo(() => targets.filter((t) => t.position >= startIdx && (mode === 'overwrite' || !t.current)), [targets, startIdx, mode]);

  // Chỉ gửi các dòng sẽ dùng, bỏ dòng "-" (bỏ qua video); máy chủ trả kết quả đúng thứ tự dòng gửi lên
  const used = useMemo(() => lines.slice(0, slots.length), [lines, slots.length]);
  const sendKey = JSON.stringify(used.filter((l) => l !== '-'));
  const debouncedKey = useDebounced(sendKey, 350);
  const resolved = useQuery({
    queryKey: ['shop', shopId, 'products', 'resolve-lines', debouncedKey],
    queryFn: () => api.post<ResolveLinesRes>(`/api/shops/${shopId}/products/resolve-lines`, { lines: JSON.parse(debouncedKey) as string[] }),
    enabled: open && source === 'paste' && debouncedKey !== '[]',
    staleTime: 30_000,
  });
  const results = resolved.data && debouncedKey === sendKey ? resolved.data.items : null;

  const preview: PreviewRow[] = useMemo(() => {
    let k = 0;
    const entries: { line: string | null; product: PinProduct | null; matchedBy: MatchedBy; status: RowStatus }[] =
      source === 'paste'
        ? used.map((l) => {
            if (l === '-') return { line: l, product: null, matchedBy: null, status: 'skip' };
            const r = results?.[k++];
            if (!r) return { line: l, product: null, matchedBy: null, status: 'none' };
            return r.product ? { line: l, product: toPinProduct(r.product), matchedBy: r.matchedBy, status: 'assign' } : { line: l, product: null, matchedBy: null, status: 'unmatched' };
          })
        : picked.map((p) => ({ line: null, product: toPinProduct(p), matchedBy: null, status: 'assign' as RowStatus }));
    return slots.map((t, i) => {
      const e = entries[i];
      if (!e) return { target: t, line: null, product: null, matchedBy: null, status: 'none' as RowStatus };
      let status = e.status;
      if (status === 'assign' && t.current) status = t.current.id === e.product?.id ? 'same' : 'overwrite';
      return { target: t, line: e.line, product: e.product, matchedBy: e.matchedBy, status };
    });
  }, [source, used, results, picked, slots]);

  const entryCount = source === 'paste' ? lines.length : picked.length;
  const extra = Math.max(0, entryCount - slots.length);
  const applicable = preview.filter((r) => r.product && (r.status === 'assign' || r.status === 'overwrite'));
  const problems = preview.filter((r) => r.status === 'unmatched').length;
  const stockWarn = applicable.filter((r) => r.product!.removed || (r.product!.stock ?? 0) <= 0).length;
  const loadingResolve = source === 'paste' && sendKey !== '[]' && (resolved.isFetching || debouncedKey !== sendKey);

  return (
    <>
      <Dialog
        open={open && !picking}
        onClose={onClose}
        size="xl"
        title={
          <span className="inline-flex items-center gap-2">
            <Wand2 className="size-4 text-brand-500" /> Gán sản phẩm nhanh
          </span>
        }
        description="Gán sản phẩm chính cho nhiều video cùng lúc theo thứ tự trong danh sách phát. Xem trước rồi mới áp dụng."
        footer={
          <>
            <span className="mr-auto text-xs text-muted">
              {applicable.length} video sẽ được gán
              {problems > 0 && ` · ${problems} dòng lỗi`}
              {stockWarn > 0 && ` · ${stockWarn} sản phẩm hết hàng/đã gỡ`}
            </span>
            <Button variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button
              variant="primary"
              disabled={!applicable.length || loadingResolve}
              onClick={() => {
                onApply(applicable.map((r) => ({ key: r.target.key, product: r.product! })));
                onClose();
              }}
            >
              Áp dụng cho {applicable.length} video
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Nguồn sản phẩm">
              <Segmented<Source>
                value={source}
                onChange={setSource}
                className="w-full"
                options={[
                  { value: 'paste', label: <span className="inline-flex items-center gap-1.5"><ClipboardPaste className="size-3.5" />Dán mã / link</span> },
                  { value: 'pick', label: <span className="inline-flex items-center gap-1.5"><MousePointerClick className="size-3.5" />Chọn theo thứ tự</span> },
                ]}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_88px]">
              <Field label="Áp dụng cho">
                <Segmented<Mode>
                  value={mode}
                  onChange={setMode}
                  className="w-full"
                  options={[
                    { value: 'empty', label: 'Chưa có sản phẩm', count: missing },
                    { value: 'overwrite', label: 'Ghi đè tất cả', count: targets.length },
                  ]}
                />
              </Field>
              <Field label="Từ video số">
                <Input type="number" min={1} max={targets.length} value={start} onChange={(e) => setStart(e.target.value)} className="w-24 sm:w-full" />
              </Field>
            </div>
          </div>

          {source === 'paste' ? (
            <Field
              label={`ID sản phẩm, link Shopee hoặc SKU — mỗi dòng ứng với 1 video (${slots.length} video cần gán)`}
              hint='Mỗi dòng là ID sản phẩm, link Shopee hoặc SKU (khớp theo ID/link trước, nếu không có thì theo SKU, không phân biệt hoa thường). Dòng 1 gán cho video đầu tiên cần gán, dòng 2 cho video kế tiếp… Gõ "-" để bỏ qua một video. Có thể dán cả cột từ Excel.'
            >
              <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'24512345678\nhttps://shopee.vn/San-pham-i.123456.24512345679\nSON-LI-01\n-\n24512345680'} className="font-mono text-xs" autoFocus />
            </Field>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2.5">
              <ListOrdered className="size-4 text-muted" />
              <p className="min-w-0 flex-1 text-sm">{picked.length ? `Đã chọn ${picked.length} sản phẩm theo thứ tự bấm.` : 'Bấm chọn sản phẩm theo đúng thứ tự video trong danh sách phát.'}</p>
              {picked.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                  Chọn lại
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => setPicking(true)}>
                {picked.length ? 'Chọn thêm' : 'Chọn sản phẩm'}
              </Button>
            </div>
          )}

          {extra > 0 && (
            <Callout tone="warning">
              Có {extra} {source === 'paste' ? 'dòng' : 'sản phẩm'} thừa so với số video cần gán — phần thừa sẽ bị bỏ qua.
            </Callout>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium">Xem trước</p>
              {loadingResolve && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <Spinner className="size-3.5" /> Đang khớp với danh mục…
                </span>
              )}
            </div>
            {!slots.length ? (
              <p className="rounded-lg border border-line px-3 py-6 text-center text-sm text-muted">{mode === 'empty' ? 'Mọi video đều đã có sản phẩm. Chọn “Ghi đè tất cả” để thay sản phẩm chính.' : 'Không có video nào từ vị trí này.'}</p>
            ) : (
              <div className="max-h-[42vh] overflow-auto rounded-lg border border-line">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-left text-2xs font-semibold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="w-10 border-b border-line px-3 py-1.5">#</th>
                      <th className="border-b border-line px-3 py-1.5">Video</th>
                      <th className="border-b border-line px-3 py-1.5">Sản phẩm</th>
                      <th className="w-40 border-b border-line px-3 py-1.5">Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.target.key} className={cn(r.status === 'none' && 'text-muted')}>
                        <td className="border-b border-line px-3 py-1.5 text-xs tabular text-muted">{r.target.position}</td>
                        <td className="max-w-[220px] border-b border-line px-3 py-1.5">
                          <p className="truncate">{r.target.videoName}</p>
                          {r.target.current && <p className="truncate text-xs text-muted">Hiện tại: {r.target.current.name}</p>}
                        </td>
                        <td className="max-w-[280px] border-b border-line px-3 py-1.5">
                          {r.product ? (
                            <div className="flex items-center gap-2">
                              <ProductThumb url={r.product.imageUrl} className="size-7" />
                              <div className="min-w-0">
                                <p className="truncate">{r.product.name}</p>
                                <p className="flex items-center gap-2 text-xs text-muted">
                                  {r.matchedBy && (
                                    <Badge tone={r.matchedBy === 'sku' ? 'violet' : 'muted'} size="sm">
                                      Khớp {r.matchedBy === 'sku' ? 'SKU' : 'ID'}
                                    </Badge>
                                  )}
                                  <span className="font-mono">{r.product.sku || r.product.itemId}</span>
                                  {r.product.removed ? <Badge tone="danger" size="sm">Đã gỡ</Badge> : <StockBadge stock={r.product.stock} />}
                                </p>
                              </div>
                            </div>
                          ) : r.line ? (
                            <span className="break-all font-mono text-xs text-muted">{r.line}</span>
                          ) : (
                            <span className="text-xs text-subtle">—</span>
                          )}
                        </td>
                        <td className="border-b border-line px-3 py-1.5">
                          <Badge tone={STATUS[r.status].tone} size="sm">
                            {STATUS[r.status].label}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">Chỉ thay sản phẩm chính (ghim từ đầu video); các mốc đổi sản phẩm theo thời gian đã có được giữ nguyên. Nhớ bấm “Lưu mẫu phát” sau khi áp dụng.</p>
        </div>
      </Dialog>
      <ProductPicker
        shopId={shopId}
        open={picking}
        onClose={() => setPicking(false)}
        multiple
        inStockOnly={preferInStock}
        title="Chọn sản phẩm theo thứ tự video"
        onPick={(ps) => setPicked((cur) => [...cur, ...ps])}
      />
    </>
  );
}
