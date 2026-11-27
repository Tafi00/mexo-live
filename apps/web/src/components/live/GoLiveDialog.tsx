import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ImageOff, ListVideo, Loader2, Play, XCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { SERVER_STATE_LABELS } from '@mexo/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDuration } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { CoverUpload } from '@/components/domain/CoverUpload';
import { Button, ButtonLink } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Callout, EmptyState } from '@/components/ui/misc';
import type { ServerOption } from './types';

interface Tpl {
  id: number;
  number: number;
  name: string;
  liveTitle: string | null;
  coverKey: string | null;
  loop: boolean;
  videoCount: number;
  productCount: number;
  durationSec: number;
  issueCount: number;
  issues: { position: number | null; code: string; message: string }[];
}
interface Check {
  key: string;
  ok: boolean;
  label: string;
  detail?: string;
}
interface GoLiveResult {
  ok: boolean;
  started: boolean;
  checks: Check[];
  summary: { title: string; coverKey: string | null; videos: number; products: number; server: { id: number; name: string } | null };
  sessionId: number | null;
  error?: string;
}

const coverUrl = (key: string) => `/api/files/cover?key=${encodeURIComponent(key)}`;

/**
 * PHÁT NGAY — luồng lên live 1 bước:
 * chọn mẫu phát (tiêu đề + ảnh bìa lấy từ mẫu, có thể đổi) → hệ thống kiểm tra mọi điều kiện → tạo phiên + giao máy phát.
 * Phiên chỉ bắt đầu trên Shopee khi máy chủ đã đẩy hình.
 */
export function GoLiveDialog({ open, onClose, shopId, shopName, defaultTemplateId }: { open: boolean; onClose: () => void; shopId: number; shopName?: string; defaultTemplateId?: number | null }) {
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [serverId, setServerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GoLiveResult | null>(null);

  const tpl = useQuery({ queryKey: ['shop', shopId, 'templates'], queryFn: () => api.get<{ items: Tpl[] }>(`/api/shops/${shopId}/templates`), enabled: open });
  const servers = useQuery({ queryKey: ['servers'], queryFn: () => api.get<{ items: ServerOption[] }>('/api/servers'), enabled: open && isStaff, staleTime: 10_000 });
  const templates = tpl.data?.items ?? [];
  const selected = templates.find((t) => t.id === templateId) ?? null;

  useEffect(() => {
    if (!open) return;
    setTemplateId(null);
    setTitle('');
    setCover(null);
    setServerId(null);
    setFailure(null);
  }, [open]);

  useEffect(() => {
    if (!open || !templates.length || templateId !== null) return;
    const pre = templates.find((t) => t.id === defaultTemplateId) ?? templates.find((t) => !t.issueCount) ?? templates[0]!;
    setTemplateId(pre.id);
  }, [open, templates, templateId, defaultTemplateId]);

  const dTitle = useDebounced(title, 400);
  const check = useQuery({
    queryKey: ['go-live-check', shopId, templateId, cover, serverId],
    queryFn: () => api.post<GoLiveResult>(`/api/shops/${shopId}/go-live`, { templateId, coverKey: cover, serverId, title: dTitle || null, dryRun: true }),
    enabled: open && templateId !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  async function start() {
    if (!templateId) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.post<GoLiveResult>(`/api/shops/${shopId}/go-live`, { templateId, coverKey: cover, serverId, title: title.trim() || null });
      void qc.invalidateQueries({ queryKey: ['shop', shopId] });
      void qc.invalidateQueries({ queryKey: ['shops'] });
      void qc.invalidateQueries({ queryKey: ['live'] });
      if (r.started && r.sessionId) {
        toast.success('Đã tạo phiên và giao máy chủ phát — phiên sẽ lên sóng khi Shopee nhận hình');
        onClose();
        nav(`/sessions/${r.sessionId}`);
      } else setFailure(r);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const checks = failure?.checks ?? check.data?.checks ?? [];
  const ready = Boolean(check.data?.ok) && !failure;
  const failedCount = checks.filter((c) => !c.ok).length;
  const effectiveCover = cover ?? selected?.coverKey ?? null;

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      dismissable={!busy}
      size="xl"
      title={
        <span className="inline-flex items-center gap-2">
          <Zap className="size-4 text-brand-500" />
          Phát ngay{shopName ? ` — ${shopName}` : ''}
        </span>
      }
      description="Chọn mẫu phát. Hệ thống tạo phiên trên Shopee, thêm sản phẩm ghim vào giỏ, giao máy chủ phát và tự bắt đầu phiên khi Shopee đã nhận hình."
      footer={
        <>
          {failure?.sessionId && (
            <ButtonLink to={`/sessions/${failure.sessionId}`} variant="outline" className="mr-auto">
              Mở phiên vừa tạo
            </ButtonLink>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button variant="primary" icon={<Play className="size-4" />} loading={busy} disabled={!ready || check.isFetching} onClick={start}>
            Phát ngay
          </Button>
        </>
      }
    >
      {!tpl.isLoading && !templates.length ? (
        <EmptyState
          icon={ListVideo}
          title="Shop chưa có mẫu phát"
          description="Mẫu phát là danh sách video theo thứ tự, mỗi video gắn sản phẩm ghim. Tạo mẫu trước khi phát."
          action={
            <ButtonLink to={`/shops/${shopId}/templates/new`} variant="primary" onClick={onClose}>
              Tạo mẫu phát
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium">Mẫu phát</p>
              <div className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors',
                      t.id === templateId ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-400 dark:bg-brand-950/20' : 'border-line hover:border-line-strong hover:bg-surface-2',
                    )}
                  >
                    {t.coverKey ? (
                      <img src={coverUrl(t.coverKey)} alt="" className="h-12 w-9 shrink-0 rounded object-cover ring-1 ring-line" />
                    ) : (
                      <span className="grid h-12 w-9 shrink-0 place-items-center rounded bg-surface-2 text-subtle ring-1 ring-line">
                        <ImageOff className="size-3.5" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.name}</span>
                      <span className="block text-xs text-muted">
                        {t.videoCount} video · {t.productCount} sản phẩm · {fmtDuration(t.durationSec)} · {t.loop ? 'lặp vòng' : '1 lượt'}
                      </span>
                    </span>
                    {t.issueCount > 0 ? (
                      <Badge tone="warning" size="sm" icon={<AlertTriangle className="size-3" />}>
                        {t.issueCount} cảnh báo
                      </Badge>
                    ) : (
                      <Badge tone="success" size="sm">
                        Sẵn sàng
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="Tiêu đề phiên" hint="Để trống: dùng tiêu đề live của mẫu phát">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={selected?.liveTitle || selected?.name || 'Tiêu đề phiên livestream'} />
              </Field>
              {isStaff && (
                <Field label="Máy chủ phát">
                  <Select value={serverId ?? ''} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)} className="sm:w-56">
                    <option value="">Tự động (máy tải thấp nhất)</option>
                    {(servers.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id} disabled={s.state !== 'online' || s.suspended}>
                        {s.name} · {SERVER_STATE_LABELS[s.state] ?? s.state} · {s.runningStreams}/{s.maxStreams}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <Field label="Ảnh bìa" hint={cover ? 'Ảnh riêng cho lần phát này' : selected?.coverKey ? 'Đang dùng ảnh bìa của mẫu phát — tải ảnh khác nếu muốn đổi' : 'Mẫu chưa có ảnh bìa — cần tải ảnh bìa để phát'}>
              <CoverUpload value={effectiveCover} onChange={(k) => setCover(k)} required={!effectiveCover} removable={Boolean(cover)} />
            </Field>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Kiểm tra trước khi phát</p>
              {check.isFetching && <Loader2 className="size-3.5 animate-spin text-muted" />}
            </div>
            {check.isError ? (
              <Callout tone="danger">{errorMessage(check.error)}</Callout>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 px-2.5 py-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />}
                    <div className="min-w-0">
                      <p className={cn('text-xs', !c.ok && 'font-medium text-rose-700 dark:text-rose-400')}>{c.label}</p>
                      {c.detail && <p className="text-2xs text-muted">{c.detail}</p>}
                    </div>
                  </li>
                ))}
                {!checks.length && <li className="px-2.5 py-3 text-center text-xs text-muted">Đang kiểm tra…</li>}
              </ul>
            )}
            {failure?.error ? (
              <Callout tone="danger" title="Chưa bắt đầu phát được">
                {failure.error}
                {failure.sessionId && ' Phiên đã được tạo — mở phiên để xử lý rồi bấm “Bắt đầu phát”.'}
              </Callout>
            ) : checks.length > 0 && !check.isFetching ? (
              ready ? (
                <Callout tone="success" title="Sẵn sàng phát">
                  {check.data?.summary.videos} video · {check.data?.summary.products} sản phẩm ghim
                  {check.data?.summary.server ? ` · máy ${check.data.summary.server.name}` : ''}
                </Callout>
              ) : (
                <Callout tone="warning" title={`Chưa đạt ${failedCount} điều kiện`}>
                  {selected?.issueCount ? 'Mở mẫu phát để gán sản phẩm / tải video còn thiếu.' : 'Xử lý các mục màu đỏ để phát.'}
                </Callout>
              )
            ) : null}
            {selected && selected.issueCount > 0 && (
              <ButtonLink to={`/shops/${shopId}/templates/${selected.id}`} size="sm" className="w-full" onClick={onClose}>
                Mở mẫu phát để sửa
              </ButtonLink>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
