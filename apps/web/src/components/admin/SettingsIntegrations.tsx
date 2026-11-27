import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Loader2, Lock, Plug, RotateCcw, Save, Server, ShieldCheck, Stethoscope, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { useCopy } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input, RadioCards, Switch } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, ErrorState, PageLoading } from '@/components/ui/misc';

type Mode = 'mock' | 'sandbox' | 'live';
type Source = 'web' | 'env';
interface Integrations {
  shopee: { mode: Mode; partnerId: number | null; hasKey: boolean; keyHint: string | null; redirectUrl: string; effectiveRedirectUrl: string; timeoutMs: number; host: string };
  infra: { apiPublicUrl: string; expectedEgressIp: string; streamerMinVersion: string; streamerLostAfterSec: number; aiAllowPrivateHosts: boolean; publicUrl: string };
  sources: Record<'shopeeMode' | 'partnerId' | 'partnerKey' | 'redirectUrl' | 'timeoutMs' | 'apiPublicUrl' | 'expectedEgressIp' | 'streamerMinVersion' | 'streamerLostAfterSec' | 'aiAllowPrivateHosts', Source>;
  updatedAt: string | null;
  updatedBy: string | null;
  canEdit: boolean;
}
interface Form {
  shopeeMode: Mode;
  partnerId: string;
  partnerKey: string;
  redirectUrl: string;
  timeoutMs: string;
  apiPublicUrl: string;
  expectedEgressIp: string;
  streamerMinVersion: string;
  streamerLostAfterSec: string;
  aiAllowPrivateHosts: boolean;
}
type ResetField = 'shopeeMode' | 'partnerId' | 'partnerKeyEnc' | 'redirectUrl' | 'timeoutMs' | 'apiPublicUrl' | 'expectedEgressIp' | 'streamerMinVersion' | 'streamerLostAfterSec' | 'aiAllowPrivateHosts';

function toForm(d: Integrations): Form {
  return {
    shopeeMode: d.shopee.mode,
    partnerId: d.shopee.partnerId ? String(d.shopee.partnerId) : '',
    partnerKey: '',
    redirectUrl: d.shopee.redirectUrl,
    timeoutMs: String(d.shopee.timeoutMs),
    apiPublicUrl: d.infra.apiPublicUrl,
    expectedEgressIp: d.infra.expectedEgressIp,
    streamerMinVersion: d.infra.streamerMinVersion,
    streamerLostAfterSec: String(d.infra.streamerLostAfterSec),
    aiAllowPrivateHosts: d.infra.aiAllowPrivateHosts,
  };
}

function SourceTag({ source, onReset, disabled }: { source: Source; onReset?: () => void; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={source === 'web' ? 'brand' : 'muted'} size="sm">
        {source === 'web' ? 'Đặt trên web' : 'Từ .env'}
      </Badge>
      {source === 'web' && onReset && !disabled && (
        <button type="button" onClick={onReset} className="inline-flex items-center gap-0.5 text-2xs text-muted hover:text-fg" title="Bỏ giá trị đặt trên web, dùng lại giá trị trong .env">
          <RotateCcw className="size-3" />
          Dùng .env
        </button>
      )}
    </span>
  );
}

/** Cấu hình kết nối & khóa API — nhập trực tiếp trên web (chỉ quản trị hệ thống được sửa) */
export function IntegrationsTab() {
  const { isSysadmin } = useAuth();
  const qc = useQueryClient();
  const copy = useCopy();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['settings', 'integrations'], queryFn: () => api.get<Integrations>('/api/settings/integrations') });
  const d = q.data;
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string; latencyMs?: number; shopee?: { error?: string; message?: string; requestId?: string } } | null>(null);
  useEffect(() => {
    if (d) setForm(toForm(d));
  }, [d]);

  const base = useMemo(() => (d ? toForm(d) : null), [d]);
  const canEdit = Boolean(d?.canEdit && isSysadmin);

  const changes = useMemo(() => {
    if (!form || !base) return {} as Record<string, unknown>;
    const c: Record<string, unknown> = {};
    if (form.shopeeMode !== base.shopeeMode) c.shopeeMode = form.shopeeMode;
    if (form.partnerId !== base.partnerId) c.partnerId = Number(form.partnerId || 0);
    if (form.partnerKey.trim()) c.partnerKey = form.partnerKey.trim();
    if (form.redirectUrl !== base.redirectUrl) c.redirectUrl = form.redirectUrl.trim();
    if (form.timeoutMs !== base.timeoutMs) c.timeoutMs = Number(form.timeoutMs);
    if (form.apiPublicUrl !== base.apiPublicUrl) c.apiPublicUrl = form.apiPublicUrl.trim();
    if (form.expectedEgressIp !== base.expectedEgressIp) c.expectedEgressIp = form.expectedEgressIp.trim();
    if (form.streamerMinVersion !== base.streamerMinVersion) c.streamerMinVersion = form.streamerMinVersion.trim();
    if (form.streamerLostAfterSec !== base.streamerLostAfterSec) c.streamerLostAfterSec = Number(form.streamerLostAfterSec);
    if (form.aiAllowPrivateHosts !== base.aiAllowPrivateHosts) c.aiAllowPrivateHosts = form.aiAllowPrivateHosts;
    return c;
  }, [form, base]);
  const dirty = Object.keys(changes).length > 0;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d || !form) return <PageLoading />;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });

  async function save() {
    if (changes.shopeeMode === 'live' || (changes.shopeeMode && form!.shopeeMode !== 'mock' && d!.shopee.mode === 'mock')) {
      const r = await confirm({
        title: `Chuyển sang Shopee ${form!.shopeeMode === 'live' ? 'thật (live)' : 'sandbox'}?`,
        description: 'Mọi lệnh gọi Shopee sẽ đi tới môi trường mới ngay sau khi lưu. Shop đã kết nối ở chế độ giả lập không dùng được token cũ — cần cấp quyền lại.',
        confirmText: 'Lưu và chuyển',
        danger: form!.shopeeMode === 'live',
      });
      if (!r.ok) return;
    }
    setBusy(true);
    try {
      await api.put('/api/settings/integrations', changes);
      toast.success('Đã lưu cấu hình — có hiệu lực ngay');
      setTest(null);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['shell'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset(fields: ResetField[], label: string) {
    const r = await confirm({ title: `Dùng lại giá trị trong .env cho “${label}”?`, description: 'Giá trị đặt trên web sẽ bị xóa.', confirmText: 'Dùng .env' });
    if (!r.ok) return;
    try {
      await api.post('/api/settings/integrations/reset', { fields });
      toast.success('Đã chuyển về giá trị trong .env');
      await qc.invalidateQueries({ queryKey: ['settings'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.post('/api/settings/shopee/test', { shopeeMode: form!.shopeeMode, partnerId: form!.partnerId ? Number(form!.partnerId) : undefined, partnerKey: form!.partnerKey.trim() || undefined });
      setTest(r);
    } catch (e) {
      setTest({ ok: false, message: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  }

  const ro = !canEdit;
  const S = d.sources;
  const label = (text: ReactNode, source: Source, field: ResetField, name: string) => (
    <span className="flex items-center justify-between gap-2">
      <span>{text}</span>
      <SourceTag source={source} onReset={() => void reset([field], name)} disabled={ro} />
    </span>
  );

  return (
    <div className="space-y-4 pb-16">
      <Callout tone="neutral" icon={<Lock className="size-4" />}>
        Khóa bí mật được mã hóa AES-256 trong database và không bao giờ hiển thị lại (chỉ hiện gợi ý vài ký tự). Giá trị nhập ở đây có hiệu lực ngay, không cần khởi động lại; để trống thì dùng giá trị trong file <code className="font-mono">.env</code>.
        <span className="mt-1 block text-muted">Riêng <code className="font-mono">APP_SECRET</code> (khóa gốc để mã hóa các khóa khác) và <code className="font-mono">DATABASE_URL</code> vẫn đặt trong <code className="font-mono">.env</code> vì hệ thống cần chúng trước khi đọc được database. Khóa API AI nhập ở tab Trợ lý AI; khóa máy phát tạo ở trang Máy chủ phát.</span>
      </Callout>
      {!canEdit && <Callout tone="info">Chỉ quản trị hệ thống được sửa cấu hình này.</Callout>}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Shopee Open Platform" icon={<Plug className="size-4" />} description={`Đang gọi: ${d.shopee.host}`} />
          <div className="space-y-4 p-4">
            <Field label={label('Môi trường', S.shopeeMode, 'shopeeMode', 'Môi trường')}>
              <RadioCards<Mode>
                className="grid-cols-1 sm:grid-cols-3"
                value={form.shopeeMode}
                onChange={(v) => !ro && set('shopeeMode', v)}
                options={[
                  { value: 'mock', label: 'Giả lập', description: 'Không gọi Shopee — để chạy thử', disabled: ro },
                  { value: 'sandbox', label: 'Sandbox', description: 'Môi trường test của Shopee', disabled: ro },
                  { value: 'live', label: 'Thật (live)', description: 'Shop thật, phiên live thật', disabled: ro },
                ]}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={label('Partner ID', S.partnerId, 'partnerId', 'Partner ID')} hint="App ID trong Shopee Open Platform Console">
                <Input inputMode="numeric" value={form.partnerId} onChange={(e) => set('partnerId', e.target.value.replace(/\D/g, ''))} disabled={ro} placeholder="vd: 2001234" className="font-mono" />
              </Field>
              <Field
                label={label('Partner Key', S.partnerKey, 'partnerKeyEnc', 'Partner Key')}
                hint={d.shopee.hasKey ? `Đã lưu: ${d.shopee.keyHint ?? '••••'} — nhập để thay khóa mới` : 'Chưa có khóa — nhập Live/Test Partner Key của App'}
              >
                <Input type="password" autoComplete="new-password" value={form.partnerKey} onChange={(e) => set('partnerKey', e.target.value)} disabled={ro} placeholder={d.shopee.hasKey ? '••••••••••••••••' : 'Dán Partner Key'} leading={<KeyRound className="size-4" />} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button icon={testing ? <Loader2 className="size-4 animate-spin" /> : <Stethoscope className="size-4" />} disabled={ro || testing} onClick={runTest}>
                Kiểm tra Partner ID / Key
              </Button>
              <span className="text-xs text-muted">Dùng giá trị đang nhập (chưa cần lưu). Không tính vào tỷ lệ gọi API của shop.</span>
            </div>
            {test && (
              <Callout tone={test.ok ? 'success' : 'danger'} icon={test.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} title={test.ok ? 'Kết nối hợp lệ' : 'Chưa hợp lệ'}>
                {test.message}
                {test.latencyMs !== undefined && <span className="text-muted"> · {test.latencyMs} ms</span>}
                {test.shopee?.requestId && <span className="mt-0.5 block font-mono text-2xs text-muted">Shopee: {test.shopee.error} — {test.shopee.message} · request_id {test.shopee.requestId}</span>}
              </Callout>
            )}
            <Field label={label('Redirect URL', S.redirectUrl, 'redirectUrl', 'Redirect URL')} hint="Phải trùng với Redirect URL đã đăng ký trong Console. Để trống: dùng mặc định bên dưới.">
              <Input value={form.redirectUrl} onChange={(e) => set('redirectUrl', e.target.value)} disabled={ro} placeholder={`${d.infra.publicUrl}/connect/callback`} className="font-mono text-xs" />
            </Field>
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
              <span className="text-xs text-muted">Đang dùng:</span>
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{d.shopee.effectiveRedirectUrl}</code>
              <Button size="xs" variant="ghost" icon={<Copy className="size-3.5" />} onClick={() => void copy(d.shopee.effectiveRedirectUrl, 'Đã sao chép Redirect URL')}>
                Sao chép
              </Button>
            </div>
            <Field label={label('Thời gian chờ Shopee (ms)', S.timeoutMs, 'timeoutMs', 'Thời gian chờ')} hint="Quá thời gian này coi là Shopee không phản hồi (mặc định 15000).">
              <Input inputMode="numeric" value={form.timeoutMs} onChange={(e) => set('timeoutMs', e.target.value.replace(/\D/g, ''))} disabled={ro} className="w-40" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Hạ tầng & bảo mật" icon={<Server className="size-4" />} />
          <div className="space-y-4 p-4">
            <Field label={label('Địa chỉ API cho máy phát', S.apiPublicUrl, 'apiPublicUrl', 'Địa chỉ API')} hint="Giá trị MEXO_API_URL đặt trên từng máy phát; máy phát tải video từ địa chỉ này.">
              <Input value={form.apiPublicUrl} onChange={(e) => set('apiPublicUrl', e.target.value)} disabled={ro} placeholder="https://live.example.vn" className="font-mono text-xs" />
            </Field>
            <Field label={label('IP tĩnh đã khai với Shopee', S.expectedEgressIp, 'expectedEgressIp', 'IP tĩnh')} hint="Hệ thống kiểm tra IP ra Internet mỗi 10 phút và cảnh báo nếu khác. Để trống: không kiểm tra.">
              <Input value={form.expectedEgressIp} onChange={(e) => set('expectedEgressIp', e.target.value)} disabled={ro} placeholder="vd: 203.0.113.10" className="font-mono" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={label('Phiên bản máy phát tối thiểu', S.streamerMinVersion, 'streamerMinVersion', 'Phiên bản tối thiểu')}>
                <Input value={form.streamerMinVersion} onChange={(e) => set('streamerMinVersion', e.target.value)} disabled={ro} placeholder="1.0.0" className="font-mono" />
              </Field>
              <Field label={label('Mất kết nối sau (giây)', S.streamerLostAfterSec, 'streamerLostAfterSec', 'Mất kết nối sau')}>
                <Input inputMode="numeric" value={form.streamerLostAfterSec} onChange={(e) => set('streamerLostAfterSec', e.target.value.replace(/\D/g, ''))} disabled={ro} />
              </Field>
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
              <div>
                <p className="text-sm font-medium">Cho phép AI dùng địa chỉ nội bộ / http</p>
                <p className="text-xs text-muted">Bật khi chạy mô hình AI trong mạng nội bộ. Mặc định chặn để tránh gọi nhầm vào hệ thống nội bộ.</p>
                <div className="mt-1.5">
                  <SourceTag source={S.aiAllowPrivateHosts} onReset={() => void reset(['aiAllowPrivateHosts'], 'AI mạng nội bộ')} disabled={ro} />
                </div>
              </div>
              <Switch checked={form.aiAllowPrivateHosts} onChange={(v) => set('aiAllowPrivateHosts', v)} disabled={ro} />
            </div>
            <Callout tone="neutral" icon={<ShieldCheck className="size-4" />}>
              Mọi thay đổi được ghi vào Nhật ký hệ thống (không ghi giá trị khóa).
              {d.updatedAt && (
                <span className="mt-0.5 block text-muted">
                  Lần sửa gần nhất: {fmtDateTime(d.updatedAt)}
                  {d.updatedBy ? ` bởi ${d.updatedBy}` : ''}
                </span>
              )}
            </Callout>
          </div>
        </Card>
      </div>

      {canEdit && (
        <div className={cn('fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur transition-transform lg:left-[232px]', dirty ? 'translate-y-0' : 'translate-y-full')}>
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5 lg:px-5">
            <span className="text-sm">
              Có <b>{Object.keys(changes).length}</b> thay đổi chưa lưu
              {changes.partnerKey ? ' (gồm Partner Key mới)' : ''}
            </span>
            <Button variant="ghost" className="ml-auto" onClick={() => setForm(toForm(d))} disabled={busy}>
              Hoàn tác
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} loading={busy} onClick={save}>
              Lưu cấu hình
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
