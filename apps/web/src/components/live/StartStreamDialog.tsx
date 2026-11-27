import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, XCircle } from 'lucide-react';
import { SERVER_STATE_LABELS } from '@mexo/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDuration } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { LiveSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { AutoFlowSteps } from './AutoFlow';
import { useShopTemplates } from './helpers';
import type { PreflightCheck, PreflightResult, ServerOption } from './types';

export function StartStreamDialog({ session, open, onClose }: { session: LiveSession; open: boolean; onClose: () => void }) {
  const { isStaff } = useAuth();
  const tpl = useShopTemplates(session.shopId, open);
  const servers = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.get<{ items: ServerOption[] }>('/api/servers'),
    enabled: open && isStaff,
    staleTime: 10_000,
  });
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [serverId, setServerId] = useState<number | null>(null);
  const [failedChecks, setFailedChecks] = useState<PreflightCheck[] | null>(null);
  const templates = tpl.data?.items ?? [];

  useEffect(() => {
    if (!open) return;
    setServerId(null);
    setFailedChecks(null);
    setTemplateId(null);
  }, [open]);

  // Chọn sẵn mẫu: mẫu đã gắn với phiên → mẫu không có cảnh báo → mẫu đầu tiên (giữ lựa chọn khi danh sách làm mới)
  useEffect(() => {
    if (!open || !templates.length) return;
    if (templateId !== null && templates.some((t) => t.id === templateId)) return;
    const pre = templates.find((t) => t.id === session.templateId) ?? templates.find((t) => !t.issueCount) ?? templates[0];
    setTemplateId(pre.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tpl.data, templateId]);

  const pf = useQuery({
    queryKey: ['preflight', session.id, templateId, serverId],
    queryFn: () => api.post<PreflightResult>(`/api/sessions/${session.id}/preflight`, { templateId, serverId }),
    enabled: open && templateId !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  useEffect(() => setFailedChecks(null), [templateId, serverId]);

  const start = useAction(() => api.post<{ ok: boolean; jobId: number }>(`/api/sessions/${session.id}/stream`, { templateId, serverId }), {
    success: 'Đã giao việc phát cho máy chủ — theo dõi tiến trình ngay trên trang này',
    invalidate: [['session', session.id], ['live'], ['shop', session.shopId], ['shops']],
    onSuccess: () => onClose(),
    onError: (e) => {
      const checks = e instanceof ApiError ? (e.details as { checks?: PreflightCheck[] } | undefined)?.checks : undefined;
      if (checks) setFailedChecks(checks);
      else void pf.refetch();
    },
  });

  const selected = templates.find((t) => t.id === templateId) ?? null;
  const checks = failedChecks ?? pf.data?.checks ?? [];
  const ok = !failedChecks && Boolean(pf.data?.ok);
  const failed = checks.filter((c) => !c.ok).length;
  const playlist = pf.data?.playlist ?? [];
  const totalSec = playlist.reduce((s, p) => s + (p.durationSec || 0), 0);
  const serverItems = servers.data?.items ?? [];

  return (
    <Dialog
      open={open}
      onClose={() => !start.isPending && onClose()}
      dismissable={!start.isPending}
      size="xl"
      title="Bắt đầu phát tự động"
      description="Chọn mẫu phát, hệ thống kiểm tra mọi điều kiện rồi giao việc cho máy chủ phát."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" icon={<RefreshCw className={pf.isFetching ? 'size-4 animate-spin' : 'size-4'} />} disabled={templateId === null || pf.isFetching} onClick={() => { setFailedChecks(null); void pf.refetch(); }}>
            Kiểm tra lại
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={start.isPending}>
            Hủy
          </Button>
          <Button variant="primary" icon={<Play className="size-4" />} loading={start.isPending} disabled={!ok || pf.isFetching} onClick={() => start.mutate()}>
            Bắt đầu phát
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-4">
          <Field label="Mẫu phát" required hint={selected ? `${selected.videoCount} video · ${fmtDuration(selected.durationSec)} · ${selected.productCount} sản phẩm ghim · ${selected.loop ? 'lặp vòng' : 'phát 1 lượt'}` : undefined}>
            <Select value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)} disabled={tpl.isLoading || !templates.length}>
              {!templates.length && <option value="">{tpl.isLoading ? 'Đang tải mẫu phát…' : 'Shop chưa có mẫu phát'}</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.number} · {t.name}
                  {t.issueCount ? ` (${t.issueCount} cảnh báo)` : ''}
                </option>
              ))}
            </Select>
          </Field>
          {!tpl.isLoading && !templates.length && (
            <Callout tone="warning" title="Shop chưa có mẫu phát">
              Cần tạo mẫu phát (danh sách video + sản phẩm ghim theo từng video) trước khi phát tự động. Vào tab “Mẫu phát” của shop để tạo.
            </Callout>
          )}
          {selected && selected.issues.length > 0 && (
            <Callout tone="warning" title="Mẫu phát có vấn đề">
              <ul className="list-disc space-y-0.5 pl-4">
                {selected.issues.map((i, idx) => (
                  <li key={idx}>
                    {i.position !== null ? `Video ${i.position}: ` : ''}
                    {i.message}
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <Field label="Máy chủ phát" hint={isStaff ? 'Để “Tự động” để hệ thống chọn máy đang kết nối và còn luồng trống.' : undefined}>
            {isStaff ? (
              <Select value={serverId ?? ''} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Tự động — chọn máy còn luồng trống</option>
                {serverItems.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.state !== 'online' || s.suspended}>
                    {s.name} · {SERVER_STATE_LABELS[s.state] ?? s.state} · {s.runningStreams}/{s.maxStreams} luồng
                  </option>
                ))}
              </Select>
            ) : (
              <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-muted">Hệ thống tự chọn máy chủ phát đang kết nối và còn luồng trống.</p>
            )}
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium">Kiểm tra trước khi phát</p>
              {pf.isFetching && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <Loader2 className="size-3.5 animate-spin" />
                  Đang kiểm tra với Shopee và máy chủ…
                </span>
              )}
            </div>
            {pf.isError && !pf.isFetching ? (
              <Callout tone="danger" title="Không kiểm tra được">
                {pf.error instanceof Error ? pf.error.message : 'Đã có lỗi xảy ra'}
              </Callout>
            ) : checks.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2.5 px-3 py-2">
                    {c.ok ? <CheckCircle2 className="mt-px size-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-px size-4 shrink-0 text-rose-500" />}
                    <div className="min-w-0">
                      <p className={c.ok ? 'text-[13px]' : 'text-[13px] font-medium text-rose-700 dark:text-rose-400'}>{c.label}</p>
                      {c.detail && <p className="text-xs text-muted">{c.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-muted">{templateId === null ? 'Chọn mẫu phát để kiểm tra.' : 'Đang chuẩn bị kiểm tra…'}</p>
            )}
          </div>

          {checks.length > 0 && !pf.isFetching && (
            ok ? (
              <Callout tone="success" title="Đã sẵn sàng phát">
                {playlist.length} video · tổng {fmtDuration(totalSec)}
                {pf.data?.server ? ` · máy chủ ${pf.data.server.name}` : ''}.
                {pf.data && pf.data.missingInCart.length > 0 && ` Hệ thống sẽ tự thêm ${pf.data.missingInCart.length} sản phẩm ghim còn thiếu vào giỏ live.`}
              </Callout>
            ) : (
              <Callout tone="danger" icon={<AlertTriangle className="size-4" />} title={`Chưa đạt ${failed} mục kiểm tra`}>
                Xử lý các mục màu đỏ rồi bấm “Kiểm tra lại”.
              </Callout>
            )
          )}
          {session.state === 'live' && (
            <Callout tone="info">Phiên đang live trên Shopee — máy chủ sẽ phát lại từ video đầu tiên của mẫu, người xem thấy hình ngay khi máy chủ đẩy hình.</Callout>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface-2/50 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Quy trình phát tự động</p>
          <AutoFlowSteps />
        </div>
      </div>
    </Dialog>
  );
}
