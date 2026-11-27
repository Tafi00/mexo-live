import { useEffect, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlayCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Callout, Spinner } from '@/components/ui/misc';
import { Table, Td, Th, THead } from '@/components/ui/table';
import { CoverUpload } from './CoverUpload';

interface Result {
  shopId: number;
  ok: boolean;
  sessionId?: number;
  message?: string;
  checks?: { label: string; detail?: string }[];
}

/** Bắt đầu phát tự động cho nhiều shop cùng lúc (mỗi shop chọn mẫu phát của shop đó) */
export function BulkStartDialog({ open, onClose, shops }: { open: boolean; onClose: () => void; shops: { id: number; name: string }[] }) {
  const qc = useQueryClient();
  const [tpl, setTpl] = useState<Record<number, string>>({});
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    if (open) {
      setTpl({});
      setResults(null);
      setTitle('');
      setCover(null);
    }
  }, [open]);

  const tplQueries = useQueries({
    queries: shops.map((s) => ({
      queryKey: ['shop', s.id, 'templates'],
      queryFn: () => api.get(`/api/shops/${s.id}/templates`),
      enabled: open,
    })),
  });

  // Tự chọn mẫu đầu tiên không có cảnh báo
  useEffect(() => {
    const next = { ...tpl };
    let changed = false;
    shops.forEach((s, i) => {
      const items = tplQueries[i]?.data?.items as { id: number; issueCount: number }[] | undefined;
      if (!next[s.id] && items?.length) {
        next[s.id] = String((items.find((t) => !t.issueCount) ?? items[0])!.id);
        changed = true;
      }
    });
    if (changed) setTpl(next);
  }, [tplQueries, shops, tpl]);

  const ready = shops.filter((s) => tpl[s.id]);

  async function start() {
    setBusy(true);
    try {
      const r = await api.post('/api/sessions/bulk-start', {
        items: ready.map((s) => ({ shopId: s.id, templateId: Number(tpl[s.id]) })),
        title: title.trim() || undefined,
        coverKey: cover || undefined,
      });
      setResults(r.results);
      if (r.failed) toast.warning(`${r.ok} shop bắt đầu phát, ${r.failed} shop chưa được`);
      else toast.success(`Đã bắt đầu phát tự động cho ${r.ok} shop`);
      void qc.invalidateQueries({ queryKey: ['shops'] });
      void qc.invalidateQueries({ queryKey: ['live'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: number) => shops.find((s) => s.id === id)?.name ?? `#${id}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Bắt đầu phát tự động — ${shops.length} shop`}
      description="Mỗi shop: tạo phiên trên Shopee → kiểm tra trước khi phát → giao máy chủ phát → bắt đầu phiên khi Shopee đã nhận hình."
      footer={
        results ? (
          <Button variant="primary" onClick={onClose}>
            Xong
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button variant="primary" icon={<PlayCircle className="size-4" />} loading={busy} disabled={!ready.length} onClick={start}>
              Bắt đầu {ready.length} shop
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="divide-y divide-line rounded-lg border border-line">
          {results.map((r) => (
            <div key={r.shopId} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{nameOf(r.shopId)}</p>
                {r.message && <p className="text-xs text-muted">{r.message}</p>}
                {r.checks?.map((c) => (
                  <p key={c.label} className="text-xs text-rose-600 dark:text-rose-400">
                    • {c.label}
                    {c.detail ? ` — ${c.detail}` : ''}
                  </p>
                ))}
              </div>
              {r.sessionId && (
                <a href={`/sessions/${r.sessionId}`} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                  Mở phiên
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Tiêu đề phiên (tùy chọn)" hint="Để trống: dùng tiêu đề live của từng mẫu phát">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="VD: LIVE SĂN DEAL CUỐI TUẦN" />
            </Field>
            <Field label="Ảnh bìa dùng chung (tùy chọn)">
              <CoverUpload value={cover} onChange={setCover} />
            </Field>
          </div>
          <Callout tone="neutral">Shop đang có phiên mở, hết hạn hoặc mất kết nối sẽ được báo lý do và bỏ qua — không ảnh hưởng shop khác.</Callout>
          <Table minWidth={520}>
            <THead>
              <tr>
                <Th>Shop</Th>
                <Th>Mẫu phát</Th>
              </tr>
            </THead>
            <tbody>
              {shops.map((s, i) => {
                const q = tplQueries[i];
                const items = (q?.data?.items ?? []) as { id: number; name: string; videoCount: number; issueCount: number; coverKey: string | null }[];
                return (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.name}</Td>
                    <Td>
                      {q?.isLoading ? (
                        <Spinner />
                      ) : items.length ? (
                        <Select inputSize="sm" value={tpl[s.id] ?? ''} onChange={(e) => setTpl({ ...tpl, [s.id]: e.target.value })} className={cn(!tpl[s.id] && 'opacity-60')}>
                          <option value="">— Bỏ qua shop này —</option>
                          {items.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} · {t.videoCount} video{t.issueCount ? ` · ${t.issueCount} cảnh báo` : ''}
                              {!t.coverKey && !cover ? ' · chưa có ảnh bìa' : ''}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-muted">Shop chưa có mẫu phát</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
