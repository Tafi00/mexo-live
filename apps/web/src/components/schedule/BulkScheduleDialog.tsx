import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Layers, Plus, RotateCcw, Store, X, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { ShopPicker, useShopOptions } from '@/components/domain/ShopPicker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Callout, EmptyState } from '@/components/ui/misc';
import { emptyScheduleForm, formToPayload, ScheduleFields, TemplateSelect, validateScheduleForm, type ScheduleErrors, type ScheduleFormValue } from './ScheduleForm';
import { parseScheduleError, type ParsedError } from './utils';

interface BulkResult {
  results: { shopId: number; ok: boolean; message?: string; scheduleId?: number }[];
  ok: number;
  failed: number;
}

function ShopTemplateRow({ shopId, name, number, value, onChange, onRemove, missing }: { shopId: number; name: string; number?: number; value: number | null; onChange: (shopId: number, id: number | null) => void; onRemove: () => void; missing: boolean }) {
  const handle = useCallback((id: number | null) => onChange(shopId, id), [onChange, shopId]);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto]">
      <div className="flex min-w-0 items-center gap-2">
        {number !== undefined && <span className="w-8 shrink-0 text-xs tabular text-subtle">#{number}</span>}
        <span className="truncate text-[13px] font-medium">{name}</span>
      </div>
      <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
        <TemplateSelect shopId={shopId} value={value} onChange={handle} inputSize="sm" autoPickSingle invalid={missing} />
      </div>
      <button type="button" onClick={onRemove} className="grid size-7 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Bỏ shop">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Tạo cùng một lịch cho nhiều shop — mỗi shop chọn mẫu phát của shop đó */
export function BulkScheduleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shops = useShopOptions(open);
  const [shopIds, setShopIds] = useState<number[]>([]);
  const [tpl, setTpl] = useState<Record<number, number | null>>({});
  const [form, setForm] = useState<ScheduleFormValue>(emptyScheduleForm);
  const [errors, setErrors] = useState<ScheduleErrors>({});
  const [missingTpl, setMissingTpl] = useState(false);
  const [apiError, setApiError] = useState<ParsedError | null>(null);
  const [picker, setPicker] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setShopIds([]);
    setTpl({});
    setForm(emptyScheduleForm());
    setErrors({});
    setMissingTpl(false);
    setApiError(null);
    setResult(null);
  }, [open]);

  const shopMap = useMemo(() => new Map((shops.data ?? []).map((s) => [s.id, s])), [shops.data]);
  const setTemplate = useCallback((shopId: number, id: number | null) => setTpl((t) => (t[shopId] === id ? t : { ...t, [shopId]: id })), []);
  const missing = shopIds.filter((id) => !tpl[id]);

  const submit = useAction(
    () =>
      api.post<BulkResult>('/api/schedules/bulk', {
        ...formToPayload(form),
        items: shopIds.map((shopId) => ({ shopId, templateId: tpl[shopId] })),
      }),
    {
      silentError: true,
      invalidate: [['schedule-runs'], ['shop']],
      onError: (e) => setApiError(parseScheduleError(e)),
      onSuccess: (r) => {
        setResult(r);
        topRef.current?.scrollIntoView({ block: 'start' });
      },
    },
  );

  function go() {
    const e = validateScheduleForm(form, { requireTemplate: false });
    setErrors(e);
    setMissingTpl(missing.length > 0);
    setApiError(null);
    if (Object.keys(e).length || missing.length || !shopIds.length) return;
    submit.mutate();
  }

  function retryFailed() {
    if (!result) return;
    const failed = result.results.filter((r) => !r.ok).map((r) => r.shopId);
    setShopIds(failed);
    setResult(null);
  }

  const name = (id: number) => shopMap.get(id)?.name ?? `Shop #${id}`;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        title="Tạo lịch hàng loạt"
        description="Cùng tiêu đề, ảnh bìa và khung giờ cho nhiều shop. Mỗi shop phát mẫu phát riêng của shop đó."
        footer={
          result ? (
            <>
              {result.failed > 0 && (
                <Button icon={<RotateCcw className="size-4" />} onClick={retryFailed}>
                  Sửa và thử lại {result.failed} shop lỗi
                </Button>
              )}
              <Button variant="primary" onClick={onClose}>
                Xong
              </Button>
            </>
          ) : (
            <>
              <span className="mr-auto text-xs text-muted">
                {shopIds.length ? `${shopIds.length} shop · ${shopIds.length - missing.length} đã chọn mẫu` : 'Chưa chọn shop'}
              </span>
              <Button variant="ghost" onClick={onClose}>
                Hủy
              </Button>
              <Button variant="primary" icon={<Layers className="size-4" />} loading={submit.isPending} disabled={!shopIds.length} onClick={go}>
                Tạo lịch cho {shopIds.length || ''} shop
              </Button>
            </>
          )
        }
      >
        <div ref={topRef} />
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Tạo thành công</p>
                <p className="text-2xl font-semibold tabular text-emerald-900 dark:text-emerald-100">{result.ok}</p>
              </div>
              <div className={result.failed ? 'rounded-lg border border-rose-200 bg-rose-50/70 p-3 dark:border-rose-900/60 dark:bg-rose-950/30' : 'rounded-lg border border-line bg-surface-2 p-3'}>
                <p className={result.failed ? 'text-xs font-medium text-rose-800 dark:text-rose-300' : 'text-xs font-medium text-muted'}>Không tạo được</p>
                <p className="text-2xl font-semibold tabular">{result.failed}</p>
              </div>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {[...result.results]
                .sort((a, b) => Number(a.ok) - Number(b.ok))
                .map((r) => (
                  <li key={r.shopId} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                    {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
                    <div className="min-w-0 flex-1">
                      <Link to={`/shops/${r.shopId}/schedules`} className="font-medium hover:text-brand-600">
                        {name(r.shopId)}
                      </Link>
                      <p className={r.ok ? 'text-xs text-muted' : 'text-xs text-rose-600 dark:text-rose-400'}>{r.ok ? 'Đã tạo lịch, các lần phát sắp tới đã được lên lịch' : r.message}</p>
                    </div>
                    <Badge tone={r.ok ? 'success' : 'danger'} size="sm">
                      {r.ok ? 'Thành công' : 'Lỗi'}
                    </Badge>
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-medium">
                    Shop & mẫu phát<span className="ml-0.5 text-rose-500">*</span>
                  </p>
                  <p className="text-xs text-muted">Shop chỉ có một mẫu sẽ được chọn sẵn.</p>
                </div>
                <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setPicker(true)}>
                  Chọn shop
                </Button>
              </div>
              {shopIds.length ? (
                <div className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {shopIds.map((id) => (
                    <ShopTemplateRow
                      key={id}
                      shopId={id}
                      name={name(id)}
                      number={shopMap.get(id)?.number}
                      value={tpl[id] ?? null}
                      missing={missingTpl && !tpl[id]}
                      onChange={setTemplate}
                      onRemove={() => setShopIds((ids) => ids.filter((x) => x !== id))}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-line-strong">
                  <EmptyState compact icon={Store} title="Chưa chọn shop nào" description="Chọn các shop cần tạo lịch, sau đó chọn mẫu phát cho từng shop." action={<Button size="sm" variant="primary" onClick={() => setPicker(true)}>Chọn shop</Button>} />
                </div>
              )}
              {missingTpl && missing.length > 0 && <p className="text-xs text-rose-600 dark:text-rose-400">Còn {missing.length} shop chưa chọn mẫu phát.</p>}
              <Callout tone="neutral">Mỗi shop được kiểm tra riêng (trùng khung giờ, số lịch tối đa, hạn dùng). Shop lỗi không ảnh hưởng các shop khác.</Callout>
            </div>
            <div className="space-y-4">
              <ScheduleFields value={form} onChange={setForm} errors={errors} />
              {apiError && (
                <Callout tone="danger" title="Không tạo được lịch">
                  {apiError.message}
                  {apiError.hint && <span className="mt-1 block opacity-80">{apiError.hint}</span>}
                </Callout>
              )}
            </div>
          </div>
        )}
      </Dialog>
      <ShopPicker
        open={picker}
        onClose={() => setPicker(false)}
        title="Chọn shop tạo lịch"
        confirmText="Thêm shop"
        excludeIds={shopIds}
        onPick={(ids) => setShopIds((cur) => [...cur, ...ids.filter((i) => !cur.includes(i))])}
      />
    </>
  );
}
