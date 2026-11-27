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
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
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
        <p className="ml-auto hidden text-xs text-muted lg:block">Khớp nhiều từ khóa nhất sẽ được dùng · có dấu hay không dấu đều khớp</p>
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
        <Table minWidth={860}>
          <THead>
            <tr>
              <Th className="w-[22%]">Chủ đề</Th>
              <Th className="w-[26%]">Từ khóa</Th>
              <Th>Câu trả lời</Th>
              <Th align="right">Lượt dùng</Th>
              <Th align="center">Bật</Th>
              <Th className="w-10" />
            </tr>
          </THead>
          <tbody>
            {list.map((r) => (
              <Tr key={r.id} className={cn(!r.enabled && 'bg-surface-2/30')}>
                <Td className="max-w-0 align-top">
                  <button type="button" disabled={!canWrite} onClick={() => setEditing(r)} className="block max-w-full truncate text-left font-medium enabled:hover:text-brand-600">
                    {r.topic}
                  </button>
                  {r.sample && <p className="truncate text-xs text-muted">“{r.sample}”</p>}
                  {r.disabledReason && <p className="mt-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">Tự tắt: {r.disabledReason}</p>}
                </Td>
                <Td className="align-top">
                  <div className="flex flex-wrap gap-1">
                    {r.keywords.slice(0, 5).map((k, i) => (
                      <span key={i} className="rounded bg-surface-2 px-1.5 py-px text-[11px] text-fg ring-1 ring-inset ring-line">
                        {k}
                      </span>
                    ))}
                    {r.keywords.length > 5 && <span className="px-1 text-[11px] text-muted" title={r.keywords.slice(5).join(', ')}>+{r.keywords.length - 5}</span>}
                  </div>
                </Td>
                <Td className="max-w-0 align-top">
                  <p className="line-clamp-2 text-[13px] text-fg/90" title={r.answer}>
                    {r.answer}
                  </p>
                </Td>
                <Td align="right" className="align-top tabular">
                  {fmtNumber(r.hits)}
                </Td>
                <Td align="center" className="align-top">
                  <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
                    <Switch size="sm" checked={r.enabled} disabled={!canWrite || (toggle.isPending && toggle.variables?.id === r.id)} onChange={() => toggle.mutate(r)} />
                  </span>
                </Td>
                <Td align="right" className="align-top">
                  {canWrite && (
                    <Menu
                      trigger={({ toggle: t }) => <Button size="xs" variant="ghost" iconOnly icon={<MoreHorizontal className="size-4" />} onClick={t} aria-label="Thao tác" />}
                      items={[
                        { label: 'Sửa', icon: <Pencil />, onClick: () => setEditing(r) },
                        { label: 'Xóa', icon: <Trash2 />, danger: true, onClick: () => void askDelete(r) },
                      ]}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <RuleDialog open={editing !== null} onClose={() => setEditing(null)} shopId={shopId} rule={editing === 'new' ? null : editing} />
      <ImportRulesDialog open={importing} onClose={() => setImporting(false)} shopId={shopId} />
    </Card>
  );
}
