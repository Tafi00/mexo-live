import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { foldVi } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, SearchInput } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';

export interface ShopLite {
  id: number;
  name: string;
  shopeeShopId: number;
  number: number;
  tags: string[];
  status: string;
}

/** Danh sách shop gọn (dùng cho chọn nhiều shop) */
export function useShopOptions(enabled = true) {
  return useQuery({
    queryKey: ['shops', 'options'],
    queryFn: async () => {
      const r = await api.get<{ items: ShopLite[] }>('/api/shops', { pageSize: 500, sort: 'number', tab: 'all' });
      return r.items;
    },
    enabled,
    staleTime: 60_000,
  });
}

export function ShopPicker({ open, onClose, onPick, title = 'Chọn shop', excludeIds = [], confirmText = 'Xác nhận' }: { open: boolean; onClose: () => void; onPick: (ids: number[]) => void; title?: string; excludeIds?: number[]; confirmText?: string }) {
  const shops = useShopOptions(open);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (open) {
      setSel(new Set());
      setQ('');
    }
  }, [open]);
  const list = useMemo(() => {
    const f = foldVi(q);
    return (shops.data ?? []).filter((s) => !excludeIds.includes(s.id) && (!f || foldVi(s.name).includes(f) || String(s.shopeeShopId).includes(f) || s.tags.some((t) => foldVi(t).includes(f))));
  }, [shops.data, q, excludeIds]);
  const allSel = list.length > 0 && list.every((s) => sel.has(s.id));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <span className="mr-auto text-xs text-muted">Đã chọn {sel.size} shop</span>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button
            variant="primary"
            disabled={!sel.size}
            onClick={() => {
              onPick([...sel]);
              onClose();
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SearchInput value={q} onChange={setQ} placeholder="Tên shop, Shop ID hoặc nhóm…" autoFocus />
        <Checkbox
          checked={allSel}
          indeterminate={!allSel && list.some((s) => sel.has(s.id))}
          onChange={(v) => {
            const n = new Set(sel);
            list.forEach((s) => (v ? n.add(s.id) : n.delete(s.id)));
            setSel(n);
          }}
          label={`Chọn tất cả (${list.length})`}
        />
        <div className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {shops.isLoading ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : (
            list.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  const n = new Set(sel);
                  if (n.has(s.id)) n.delete(s.id);
                  else n.add(s.id);
                  setSel(n);
                }}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-[13px]', sel.has(s.id) ? 'bg-brand-50/70 dark:bg-brand-950/30' : 'hover:bg-surface-2')}
              >
                <span className={cn('grid size-4 place-items-center rounded border', sel.has(s.id) ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{sel.has(s.id) && <Check className="size-3" />}</span>
                <span className="w-8 text-xs tabular text-subtle">#{s.number}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="font-mono text-xs text-muted">{s.shopeeShopId}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
