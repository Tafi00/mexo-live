import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, MoreHorizontal, Pencil, Plus, ScrollText, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { foldVi, LIMITS } from '@mexo/shared';
import { api, download } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { SearchInput, Segmented, Switch } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, ErrorState, Menu, Skeleton } from '@/components/ui/misc';
import { downloadRuleTemplate, ImportRulesDialog } from './ImportRulesDialog';
import { RuleDialog } from './RuleDialog';
import type { ReplyRule, RulesResp } from './types';

export function useReplyRules(shopId: number) {
  return useQuery({ queryKey: ['shop', shopId, 'reply-rules'], queryFn: () => api.get<RulesResp>(`/api/shops/${shopId}/reply-rules`) });
}

export function RulesCard({ shopId, canWrite }: { shopId: number; canWrite: boolean }) {
  const q = useReplyRules(shopId);
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [editing, setEditing] = useState<ReplyRule | null | 'new'>(null);
  const [importing, setImporting] = useState(false);

  const inv = [['shop', shopId, 'reply-rules'], ['shop', shopId, 'replies']];
  const toggle = useAction(
    (r: ReplyRule) => api.put(`/api/shops/${shopId}/reply-rules/${r.id}`, { topic: r.topic, keywords: r.keywords, sample: r.sample ?? '', answer: r.answer, enabled: !r.enabled }),
    { invalidate: inv, onSuccess: (_r, v) => toast.success(v.enabled ? `Đã tắt kịch bản “${v.topic}”` : `Đã bật kịch bản “${v.topic}”`) },
  );
  const remove = useAction((id: number) => api.del(`/api/shops/${shopId}/reply-rules/${id}`), { success: 'Đã xóa kịch bản', invalidate: inv });

  const items = q.data?.items ?? [];
  const counts = q.data?.counts ?? { all: 0, on: 0, off: 0 };
  const list = useMemo(() => {
    const f = foldVi(search);
    return items.filter(
      (r) =>
        (filter === 'all' || (filter === 'on' ? r.enabled : !r.enabled)) &&
        (!f || foldVi(r.topic).includes(f) || r.keywords.some((k) => foldVi(k).includes(f)) || foldVi(r.answer).includes(f) || foldVi(r.sample).includes(f)),
    );
  }, [items, search, filter]);

  async function askDelete(r: ReplyRule) {
    const ok = await confirm({ title: `Xóa kịch bản “${r.topic}”?`, description: 'Bình luận khớp kịch bản này sẽ không được trả lời nữa (hoặc chuyển sang AI nếu đang bật). Không hoàn tác được.', confirmText: 'Xóa', danger: true });
    if (ok.ok) remove.mutate(r.id);
  }

  return (
    <Card>
      <CardHeader
        title="Kịch bản trả lời"
        icon={<ScrollText className="size-4" />}
        description={`${counts.on} đang bật / ${counts.all} kịch bản · tối đa ${LIMITS.rulesPerShopMax}`}
        actions={
          <>
            <Menu
              width="w-60"
              trigger={({ toggle: t }) => (
                <Button size="sm" icon={<FileSpreadsheet className="size-3.5" />} onClick={t}>
                  Nhập / xuất
                </Button>
              )}
              items={[
                { label: 'Nhập từ file (.xlsx, .csv)', icon: <Upload />, onClick: () => setImporting(true), disabled: !canWrite },
                { label: 'Tải file mẫu', icon: <FileSpreadsheet />, onClick: downloadRuleTemplate },
                { label: 'Xuất kịch bản (CSV)', icon: <Download />, onClick: () => download(`/api/shops/${shopId}/reply-rules/export`), disabled: !counts.all },
              ]}
            />
            {canWrite && (
              <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')} disabled={counts.all >= LIMITS.rulesPerShopMax}>
                Thêm kịch bản
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <SearchInput inputSize="sm" value={search} onChange={setSearch} placeholder="Tìm chủ đề, từ khóa, câu trả lời…" className="w-full sm:w-72" />
        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tất cả', count: counts.all },
            { value: 'on', label: 'Đang bật', count: counts.on },
            { value: 'off', label: 'Đang tắt', count: counts.off },
          ]}
        />
        <p className="ml-auto hidden text-xs text-muted lg:block">Khớp cả có dấu và không dấu</p>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !list.length ? (
        <EmptyState
          icon={ScrollText}
          title={items.length ? 'Không có kịch bản phù hợp' : 'Chưa có kịch bản nào'}
          description={items.length ? 'Thử từ khóa tìm kiếm khác.' : 'Soạn sẵn câu trả lời cho các câu hỏi hay gặp (bảo hành, size, giao hàng…) hoặc nhập nhanh từ file Excel.'}
          action={
            !items.length &&
            canWrite && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>
                  Nhập từ file
                </Button>
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                  Thêm kịch bản
                </Button>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="hidden grid-cols-[44px_minmax(0,2fr)_minmax(0,3fr)_80px_28px] gap-x-3 border-b border-line bg-surface-2/80 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted lg:grid">
            <span>Bật</span>
            <span>Chủ đề & từ khóa</span>
            <span>Câu trả lời</span>
            <span className="whitespace-nowrap text-right">Lượt dùng</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {list.map((r) => (
              <li key={r.id} className={cn('grid grid-cols-[44px_minmax(0,1fr)_auto] gap-x-3 px-4 py-2.5 transition-colors hover:bg-surface-2/40 lg:grid-cols-[44px_minmax(0,2fr)_minmax(0,3fr)_80px_28px]', !r.enabled && 'bg-surface-2/30')}>
                <div className="pt-0.5">
                  <Switch size="sm" checked={r.enabled} disabled={!canWrite || (toggle.isPending && toggle.variables?.id === r.id)} onChange={() => toggle.mutate(r)} />
                </div>
                <div className="min-w-0">
                  <button type="button" disabled={!canWrite} onClick={() => setEditing(r)} className={cn('block max-w-full truncate text-left font-medium enabled:hover:text-brand-600', !r.enabled && 'text-muted')} title={r.sample ? `Câu hỏi mẫu: ${r.sample}` : r.topic}>
                    {r.topic}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.keywords.slice(0, 6).map((k, i) => (
                      <span key={i} className="rounded bg-surface-2 px-1.5 text-2xs leading-5 text-fg ring-1 ring-inset ring-line">
                        {k}
                      </span>
                    ))}
                    {r.keywords.length > 6 && (
                      <span className="px-1 text-2xs leading-5 text-muted" title={r.keywords.slice(6).join(', ')}>
                        +{r.keywords.length - 6}
                      </span>
                    )}
                  </div>
                  {r.disabledReason && <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">Tự tắt: {r.disabledReason}</p>}
                  {/* Màn hình hẹp: câu trả lời nằm dưới chủ đề */}
                  <p className="mt-1 line-clamp-2 text-sm text-muted lg:hidden" title={r.answer}>
                    {r.answer}
                  </p>
                </div>
                <p className="hidden line-clamp-2 text-sm text-fg/90 lg:block" title={r.answer}>
                  {r.answer}
                </p>
                <p className="hidden pt-0.5 text-right text-sm tabular lg:block">{fmtNumber(r.hits)}</p>
                <div className="flex flex-col items-end gap-1 lg:block">
                  {canWrite && (
                    <Menu
                      trigger={({ toggle: t }) => <Button size="xs" variant="ghost" iconOnly icon={<MoreHorizontal className="size-4" />} onClick={t} aria-label="Thao tác" />}
                      items={[
                        { label: 'Sửa', icon: <Pencil />, onClick: () => setEditing(r) },
                        { label: 'Xóa', icon: <Trash2 />, danger: true, onClick: () => void askDelete(r) },
                      ]}
                    />
                  )}
                  <span className="whitespace-nowrap text-2xs tabular text-muted lg:hidden">{fmtNumber(r.hits)} lượt</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <RuleDialog open={editing !== null} onClose={() => setEditing(null)} shopId={shopId} rule={editing === 'new' ? null : editing} />
      <ImportRulesDialog open={importing} onClose={() => setImporting(false)} shopId={shopId} />
    </Card>
  );
}
