import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, CloudDownload, Copy, Heart, Info, Layers, Package, PackageSearch, RefreshCw, Star } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtCompact, fmtDateTime, fmtMoney, fmtNumber, fmtRelative } from '@/lib/format';
import { useAction, useCopy, useDebounced, useLocalState } from '@/lib/hooks';
import type { Product } from '@/lib/types';
import { ProductThumb, StockBadge } from '@/components/domain/ProductPicker';
import { Button } from '@/components/ui/button';
import { SearchInput, Select } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, ErrorState, Pagination, Progress, Skeleton, Spinner, Tabs, Tooltip } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { SYNC_ERRORS } from '@/components/catalog/labels';
import { useShop } from './ShopLayout';

type Filter = 'all' | 'low' | 'out' | 'removed';
type Sort = 'number' | 'name' | 'price_asc' | 'price_desc' | 'sold' | 'stock';

interface SyncState {
  status: string;
  loaded: number;
  total: number;
  syncedAt: string | null;
  errorCode: string | null;
  running: boolean;
}
interface ProductListRes {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; low: number; out: number; removed: number };
  sync: SyncState;
}
type Model = { modelId: number; name: string; sku: string | null; price: number | null; stock: number | null };

const SORTS: { value: Sort; label: string }[] = [
  { value: 'number', label: 'Thứ tự trên Shopee' },
  { value: 'sold', label: 'Bán chạy nhất' },
  { value: 'name', label: 'Tên A–Z' },
  { value: 'price_asc', label: 'Giá thấp → cao' },
  { value: 'price_desc', label: 'Giá cao → thấp' },
  { value: 'stock', label: 'Tồn kho ít nhất' },
];

function ModelsPanel({ shopId, product, connected }: { shopId: number; product: Product; connected: boolean }) {
  const [enabled, setEnabled] = useState(!product.models && connected);
  const q = useQuery({
    queryKey: ['shop', shopId, 'products', product.id, 'models'],
    queryFn: () => api.get<{ models: Model[] }>(`/api/shops/${shopId}/products/${product.id}/models`),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const models: Model[] = q.data?.models ?? product.models ?? [];
  const fromCache = !q.data && Boolean(product.models);

  return (
    <div className="border-b border-line bg-surface-2/50 px-4 py-2.5 sm:pl-12">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Layers className="size-4 text-muted" />
        <p className="text-sm font-semibold">Phân loại hàng{models.length ? ` (${models.length})` : ''}</p>
        <span className="text-xs text-muted">{fromCache ? 'Bản lưu gần nhất' : q.isFetching ? 'Đang lấy từ Shopee…' : q.data ? 'Vừa lấy từ Shopee' : ''}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          icon={<RefreshCw className={cn('size-3.5', q.isFetching && 'animate-spin')} />}
          disabled={q.isFetching || !connected}
          title={connected ? undefined : 'Shop chưa kết nối Shopee'}
          onClick={() => (enabled ? void q.refetch() : setEnabled(true))}
        >
          Cập nhật từ Shopee
        </Button>
      </div>
      {q.isError ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">Không lấy được phân loại: {errorMessage(q.error)}</p>
      ) : q.isLoading && !models.length ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted">
          <Spinner className="size-3.5" /> Đang lấy phân loại từ Shopee…
        </div>
      ) : !models.length && !connected && !q.data ? (
        <p className="py-1 text-xs text-muted">Shop chưa kết nối Shopee nên chưa lấy được phân loại của sản phẩm này.</p>
      ) : !models.length ? (
        <p className="py-1 text-xs text-muted">Sản phẩm không có phân loại (chỉ một loại duy nhất).</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-muted">
                <th className="border-b border-line px-3 py-1.5 font-semibold">Phân loại</th>
                <th className="border-b border-line px-3 py-1.5 font-semibold">SKU</th>
                <th className="border-b border-line px-3 py-1.5 text-right font-semibold">Giá</th>
                <th className="border-b border-line px-3 py-1.5 text-right font-semibold">Kho</th>
                <th className="border-b border-line px-3 py-1.5 font-semibold">Model ID</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.modelId} className="last:[&>td]:border-0">
                  <td className="border-b border-line px-3 py-1.5 font-medium">{m.name || '—'}</td>
                  <td className="border-b border-line px-3 py-1.5 font-mono text-xs text-muted">{m.sku || '—'}</td>
                  <td className="border-b border-line px-3 py-1.5 text-right tabular">{fmtMoney(m.price, product.currency || 'VND')}</td>
                  <td className="border-b border-line px-3 py-1.5 text-right">
                    <StockBadge stock={m.stock} />
                  </td>
                  <td className="border-b border-line px-3 py-1.5 font-mono text-xs text-subtle">{m.modelId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-2xs text-subtle">Phân loại được lấy trực tiếp từ Shopee khi bạn mở (mỗi lần 1 lượt gọi), các thông tin khác dùng bản sao trong hệ thống.</p>
    </div>
  );
}

export default function ShopProducts() {
  const { shop, refetch: refetchShop } = useShop();
  const { can } = useAuth();
  const copy = useCopy();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [sort, setSort] = useLocalState<Sort>('mexo-product-sort', 'number');
  const [pageSize, setPageSize] = useLocalState<number>('mexo-product-page-size', 50);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => setPage(1), [filter, dq, sort, pageSize]);

  const list = useQuery({
    queryKey: ['shop', shop.id, 'products', 'list', { filter, dq, sort, page, pageSize }],
    queryFn: () => api.get<ProductListRes>(`/api/shops/${shop.id}/products`, { q: dq, filter, sort, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const s = query.state.data?.sync;
      if (!s) return false;
      if (s.running) return 2000;
      if (s.status === 'running') return 10_000; // trạng thái "đang chạy" nhưng tiến trình không còn (máy chủ khởi động lại)
      return false;
    },
  });

  const sync = list.data?.sync;
  const syncing = Boolean(sync?.running);
  const interrupted = Boolean(sync && sync.status === 'running' && !sync.running);
  const connected = shop.connection === 'ok' || shop.connection === 'expiring';
  const canManage = can('product.manage');

  // Báo kết quả khi lần tải kết thúc
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (!sync) return;
    if (wasSyncing.current && !sync.running) {
      if (sync.status === 'done') toast.success(`Đã tải xong ${fmtNumber(sync.total)} sản phẩm từ Shopee`);
      else if (sync.status === 'failed') toast.error('Tải danh mục từ Shopee thất bại', { description: SYNC_ERRORS[sync.errorCode ?? ''] ?? sync.errorCode ?? undefined });
      refetchShop();
    }
    wasSyncing.current = sync.running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.running, sync?.status]);

  const startSync = useAction(() => api.post(`/api/shops/${shop.id}/products/sync`), {
    success: 'Đã bắt đầu tải danh mục từ Shopee',
    invalidate: [['shop', shop.id, 'products']],
    onSuccess: () => {
      wasSyncing.current = true;
    },
  });

  const items = list.data?.items ?? [];
  const counts = list.data?.counts;
  const neverSynced = sync?.status === 'never' && !syncing;

  const toggleExpand = (id: number) => {
    const n = new Set(expanded);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setExpanded(n);
  };

  const sortTh = (key: 'name' | 'price' | 'sold' | 'stock' | 'number') => {
    const cur = key === 'price' ? (sort === 'price_asc' ? 'asc' : sort === 'price_desc' ? 'desc' : null) : sort === key ? (key === 'sold' ? 'desc' : 'asc') : null;
    const next: Sort = key === 'price' ? (sort === 'price_asc' ? 'price_desc' : 'price_asc') : key;
    return { sort: cur as 'asc' | 'desc' | null, onSort: () => setSort(next) };
  };

  const syncDisabledReason = !canManage ? 'Bạn không có quyền quản lý sản phẩm' : !connected ? 'Shop chưa kết nối Shopee hoặc quyền đã hết hạn' : null;
  const syncButton = (
    <Button variant="primary" icon={<CloudDownload className="size-4" />} loading={syncing || startSync.isPending} disabled={Boolean(syncDisabledReason)} onClick={() => startSync.mutate()}>
      {syncing ? 'Đang tải…' : 'Tải từ Shopee'}
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* Trạng thái bản sao danh mục */}
      <Card>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400">
            <Package className="size-5" />
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold">Danh mục sản phẩm sao chép từ Shopee</p>
              {sync?.status === 'done' && !syncing && (
                <Badge tone="success" size="sm" dot>
                  Đã đồng bộ
                </Badge>
              )}
              {sync?.status === 'failed' && !syncing && (
                <Badge tone="danger" size="sm" dot>
                  Lần tải gần nhất lỗi
                </Badge>
              )}
              {syncing && (
                <Badge tone="info" size="sm" dot pulse>
                  Đang tải
                </Badge>
              )}
            </div>
            {!sync ? (
              <Skeleton className="mt-1.5 h-3.5 w-64" />
            ) : syncing ? (
              <div className="mt-1.5 max-w-lg">
                <div className="mb-1 flex items-center justify-between text-xs text-muted">
                  <span>{sync.total ? `Đã tải ${fmtNumber(sync.loaded)} / ${fmtNumber(sync.total)} sản phẩm` : 'Đang lấy danh sách sản phẩm từ Shopee…'}</span>
                  {sync.total > 0 && <span className="tabular">{Math.floor((sync.loaded / sync.total) * 100)}%</span>}
                </div>
                <Progress value={sync.loaded} max={sync.total || 1} />
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-muted">
                {sync.syncedAt ? (
                  <>
                    {fmtNumber(sync.total)} sản phẩm · cập nhật{' '}
                    <Tooltip content={fmtDateTime(sync.syncedAt)}>
                      <span className="underline decoration-dotted underline-offset-2">{fmtRelative(sync.syncedAt)}</span>
                    </Tooltip>
                  </>
                ) : (
                  'Chưa tải danh mục lần nào'
                )}
              </p>
            )}
          </div>
          {syncDisabledReason ? <Tooltip content={syncDisabledReason}>{syncButton}</Tooltip> : syncButton}
        </div>
        <div className="flex items-start gap-2 border-t border-line bg-surface-2/40 px-4 py-2.5 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>
            Tìm kiếm, lọc và sắp xếp chạy trên bản sao trong hệ thống — <b className="font-medium text-fg">không tốn lượt gọi Shopee</b>. Bấm “Tải từ Shopee” khi shop thay đổi giá, tồn kho hoặc thêm sản phẩm mới. Sản phẩm không còn trên Shopee sẽ chuyển sang mục “Đã gỡ”.
          </span>
        </div>
      </Card>

      {!connected && (
        <Callout
          tone="warning"
          title="Shop chưa kết nối Shopee"
          action={
            <Link to="../connection" className="text-sm font-medium underline-offset-2 hover:underline">
              Kiểm tra kết nối
            </Link>
          }
        >
          Không thể tải danh mục mới. Bản sao hiện có vẫn dùng được để tìm kiếm và gán vào mẫu phát.
        </Callout>
      )}
      {sync?.status === 'failed' && !syncing && (
        <Callout tone="danger" title="Lần tải danh mục gần nhất thất bại" action={canManage && connected && <Button size="sm" onClick={() => startSync.mutate()} loading={startSync.isPending}>Thử lại</Button>}>
          {SYNC_ERRORS[sync.errorCode ?? ''] ?? `Mã lỗi: ${sync.errorCode ?? 'không rõ'}`}
          {sync.loaded > 0 && ` Đã lưu ${fmtNumber(sync.loaded)} / ${fmtNumber(sync.total)} sản phẩm trước khi lỗi.`}
        </Callout>
      )}
      {interrupted && (
        <Callout tone="warning" title="Lần tải trước bị gián đoạn" action={canManage && connected && <Button size="sm" onClick={() => startSync.mutate()} loading={startSync.isPending}>Tải lại</Button>}>
          Tiến trình tải danh mục đã dừng giữa chừng (có thể do máy chủ khởi động lại). Đã lưu {fmtNumber(sync?.loaded)} / {fmtNumber(sync?.total)} sản phẩm.
        </Callout>
      )}

      <Card>
        <div className="px-4 pt-1">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'Đang bán', count: counts?.all ?? null },
              { value: 'low', label: 'Sắp hết hàng', count: counts?.low ?? null, tone: 'warning' },
              { value: 'out', label: 'Hết hàng', count: counts?.out ?? null, tone: 'danger' },
              { value: 'removed', label: 'Đã gỡ khỏi Shopee', count: counts?.removed ?? null, tone: 'muted' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <SearchInput value={q} onChange={setQ} placeholder="Tên, SKU hoặc ID sản phẩm…" className="w-full sm:w-80" />
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-w-0 flex-1 sm:ml-auto sm:w-48 sm:flex-none" aria-label="Sắp xếp">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-28" aria-label="Số dòng mỗi trang">
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} / trang
              </option>
            ))}
          </Select>
          <Button iconOnly variant="ghost" icon={<RefreshCw className={cn('size-4', list.isFetching && 'animate-spin')} />} onClick={() => list.refetch()} aria-label="Làm mới" />
        </div>
        {dq && <p className="border-b border-line bg-surface-2/40 px-4 py-1.5 text-xs text-muted">Kết quả tìm “{dq}” trong bản sao danh mục — không gọi Shopee.</p>}

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : neverSynced && filter === 'all' && !dq ? (
          <EmptyState
            icon={PackageSearch}
            title="Chưa có danh mục sản phẩm"
            description="Tải danh mục từ Shopee một lần để tìm kiếm sản phẩm và gán vào mẫu phát. Hệ thống sao chép tên, SKU, giá, tồn kho, lượt bán và đánh giá."
            action={!syncDisabledReason && syncButton}
          />
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={PackageSearch}
            title={dq ? 'Không tìm thấy sản phẩm phù hợp' : 'Không có sản phẩm trong mục này'}
            description={dq ? 'Thử tìm theo tên khác, SKU hoặc dán đúng ID sản phẩm.' : filter === 'removed' ? 'Mọi sản phẩm trong bản sao đều còn trên Shopee.' : undefined}
          />
        ) : (
          <Table minWidth={960}>
            <THead>
              <tr>
                <Th className="w-8" />
                <Th className="w-12" {...sortTh('number')}>
                  #
                </Th>
                <Th {...sortTh('name')}>Sản phẩm</Th>
                <Th>ID sản phẩm</Th>
                <Th align="right" {...sortTh('price')}>
                  Giá
                </Th>
                <Th {...sortTh('stock')}>Kho</Th>
                <Th align="right" {...sortTh('sold')}>
                  Đã bán
                </Th>
                <Th align="right">Đánh giá</Th>
                <Th align="right">Thích</Th>
              </tr>
            </THead>
            <tbody>
              {items.map((p) => {
                const open = expanded.has(p.id);
                const discount = p.originalPrice && p.price && p.originalPrice > p.price ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
                return (
                  <Fragment key={p.id}>
                    <Tr onClick={() => toggleExpand(p.id)} selected={open} className={cn(p.removed && 'opacity-70')}>
                      <Td className="!pr-0">
                        <span className="grid size-6 place-items-center rounded text-subtle group-hover:text-fg" aria-label={open ? 'Thu gọn' : 'Xem phân loại'}>
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </span>
                      </Td>
                      <Td className="text-xs tabular text-subtle">{p.number}</Td>
                      <Td className="max-w-[380px]">
                        <div className="flex items-center gap-3">
                          <ProductThumb url={p.imageUrl} />
                          <div className="min-w-0">
                            <p className="line-clamp-2 font-medium leading-snug" title={p.name}>
                              {p.name}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              {p.sku ? <span className="font-mono" title="SKU">{p.sku}</span> : <span className="text-subtle">Không có SKU</span>}
                              {p.removed && (
                                <Badge tone="muted" size="sm">
                                  Đã gỡ khỏi Shopee
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => copy(String(p.itemId), 'Đã chép ID sản phẩm')} className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-xs text-muted hover:bg-surface-2 hover:text-fg" title="Sao chép ID">
                          {p.itemId}
                          <Copy className="size-3" />
                        </button>
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        <p className="font-medium tabular">{fmtMoney(p.price, p.currency || 'VND')}</p>
                        {discount > 0 && (
                          <p className="text-2xs text-subtle">
                            <span className="line-through">{fmtMoney(p.originalPrice, p.currency || 'VND')}</span>
                            <span className="ml-1 text-brand-600 dark:text-brand-400">-{discount}%</span>
                          </p>
                        )}
                      </Td>
                      <Td>
                        <StockBadge stock={p.stock} />
                      </Td>
                      <Td align="right" className="tabular">
                        {p.sold === null ? <span className="text-subtle">—</span> : fmtNumber(p.sold)}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        {p.rating ? (
                          <span className="inline-flex items-center gap-1 tabular">
                            <Star className="size-3.5 fill-amber-400 text-amber-400" />
                            {p.rating.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        {p.likes === null ? (
                          <span className="text-subtle">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 tabular text-muted">
                            <Heart className="size-3.5" />
                            {fmtCompact(p.likes)}
                          </span>
                        )}
                      </Td>
                    </Tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className="p-0">
                          <ModelsPanel shopId={shop.id} product={p} connected={connected} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4 py-2.5">
            <Pagination page={page} pageSize={pageSize} total={list.data.total} onChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}
