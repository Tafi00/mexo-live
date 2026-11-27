import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleAlert, Clapperboard, Copy, Package, Store } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { ShopPicker, useShopOptions } from '@/components/domain/ShopPicker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Callout, Spinner } from '@/components/ui/misc';

interface CopyResult {
  shopId: number;
  ok: boolean;
  templateId?: number;
  unmatchedVideos?: number;
  unmatchedProducts?: number;
  message?: string;
}

/**
 * Sao chép mẫu phát sang shop khác.
 * Máy chủ khớp video theo TÊN video (không phân biệt hoa thường, dấu), sản phẩm theo ID sản phẩm hoặc SKU.
 */
export function CopyTemplateDialog({ shopId, template, onClose }: { shopId: number; template: { id: number; name: string } | null; onClose: () => void }) {
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CopyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shops = useShopOptions(Boolean(template));

  useEffect(() => {
    if (template) {
      setResults(null);
      setError(null);
      setRunning(false);
    }
  }, [template]);

  async function run(ids: number[]) {
    if (!template) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.post<{ results: CopyResult[] }>(`/api/shops/${shopId}/templates/${template.id}/copy`, { shopIds: ids });
      setResults(r.results);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  const shopName = (id: number) => shops.data?.find((s) => s.id === id)?.name ?? `Shop #${id}`;
  const okCount = results?.filter((r) => r.ok).length ?? 0;

  return (
    <>
      <Dialog
        open={Boolean(template) && !picking}
        onClose={() => !running && onClose()}
        title={`Sao chép mẫu “${template?.name ?? ''}” sang shop khác`}
        size="lg"
        footer={
          results ? (
            <Button variant="primary" onClick={onClose}>
              Xong
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={running}>
                Hủy
              </Button>
              <Button variant="primary" icon={<Store className="size-4" />} loading={running} onClick={() => setPicking(true)}>
                Chọn shop đích
              </Button>
            </>
          )
        }
      >
        {running ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
            <Spinner /> Đang sao chép và khớp video, sản phẩm…
          </div>
        ) : results ? (
          <div className="space-y-3">
            <p className="text-[13px]">
              Đã tạo mẫu ở <b>{okCount}</b> / {results.length} shop.
            </p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {results.map((r) => {
                const partial = r.ok && ((r.unmatchedVideos ?? 0) > 0 || (r.unmatchedProducts ?? 0) > 0);
                return (
                  <li key={r.shopId} className="flex items-start gap-3 px-3 py-2.5">
                    {r.ok ? <CheckCircle2 className={partial ? 'mt-0.5 size-4 shrink-0 text-amber-500' : 'mt-0.5 size-4 shrink-0 text-emerald-500'} /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{shopName(r.shopId)}</p>
                      {r.ok ? (
                        <div className="mt-0.5 space-y-0.5 text-xs text-muted">
                          {!partial && <p>Khớp đầy đủ video và sản phẩm ghim.</p>}
                          {(r.unmatchedVideos ?? 0) > 0 && (
                            <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                              <Clapperboard className="size-3.5" /> {r.unmatchedVideos} video không tìm thấy (theo tên) nên bị bỏ khỏi danh sách phát
                            </p>
                          )}
                          {(r.unmatchedProducts ?? 0) > 0 && (
                            <p className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                              <Package className="size-3.5" /> {r.unmatchedProducts} sản phẩm ghim không khớp (ID/SKU) nên bị bỏ
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{r.message ?? 'Không sao chép được'}</p>
                      )}
                    </div>
                    {r.ok && r.templateId && (
                      <Link to={`/shops/${r.shopId}/templates/${r.templateId}`} onClick={onClose} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        Mở mẫu <ArrowRight className="size-3" />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {results.some((r) => r.ok && ((r.unmatchedVideos ?? 0) > 0 || (r.unmatchedProducts ?? 0) > 0)) && (
              <p className="text-xs text-muted">Mở mẫu ở shop đích để bổ sung video hoặc sản phẩm còn thiếu. Nếu tải thêm video cùng tên vào shop đích, lần sao chép sau sẽ khớp được.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-[13px]">
            <p>Hệ thống tạo một mẫu phát mới ở từng shop đích, giữ nguyên tiêu đề, mô tả, ảnh bìa, chế độ lặp và trả lời. Video và sản phẩm được khớp với dữ liệu sẵn có của shop đích:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-2/50 p-3">
                <p className="flex items-center gap-1.5 font-medium">
                  <Clapperboard className="size-4 text-muted" /> Video — khớp theo tên
                </p>
                <p className="mt-1 text-xs text-muted">Shop đích cần có video cùng tên (không phân biệt hoa thường, có dấu hay không). Video không khớp sẽ bị bỏ khỏi danh sách phát.</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2/50 p-3">
                <p className="flex items-center gap-1.5 font-medium">
                  <Package className="size-4 text-muted" /> Sản phẩm — khớp theo ID hoặc SKU
                </p>
                <p className="mt-1 text-xs text-muted">Ưu tiên cùng ID sản phẩm Shopee, nếu không có thì cùng SKU. Shop đích cần đã tải danh mục sản phẩm.</p>
              </div>
            </div>
            <Callout tone="neutral" icon={<Copy className="size-4" />}>
              Nếu shop đích đã có mẫu cùng tên, mẫu mới được đặt tên kèm số thứ tự, ví dụ “{template?.name} (2)”. Cần quyền quản lý mẫu phát ở shop đích.
            </Callout>
            {error && <Callout tone="danger">{error}</Callout>}
          </div>
        )}
      </Dialog>
      <ShopPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(ids) => {
          setPicking(false);
          void run(ids);
        }}
        excludeIds={[shopId]}
        title="Chọn shop nhận bản sao"
        confirmText="Sao chép"
      />
    </>
  );
}
