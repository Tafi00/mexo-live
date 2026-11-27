import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Copy,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plug,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  Snowflake,
  SlidersHorizontal,
  XCircle,
  Zap,
  ZapOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtBytes, fmtDateTime, fmtRelative, fmtTime } from '@/lib/format';
import { useAction, useCopy, useNow } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, ErrorState, KV, PageLoading, Progress, Tooltip } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { fmtEvery } from './common';

type LimitKey =
  | 'maxActiveSchedulesPerShop'
  | 'scheduleDaysAhead'
  | 'scheduleStartGraceMin'
  | 'defaultShopLimit'
  | 'defaultConcurrentLimit'
  | 'defaultStorageQuotaGb'
  | 'liveCutGraceMin'
  | 'stuckAfterMin'
  | 'apiLogRetentionDays'
  | 'commentRetentionDays'
  | 'feedStartDelaySec'
  | 'serviceExpiringDays'
  | 'authExpiringDays';

export interface SystemSettings {
  limits: Record<LimitKey, number>;
  freeze: { frozen: boolean; reason: string | null; at: string | null; by: string | null };
  canEdit: boolean;
  shopee: { mode: 'mock' | 'sandbox' | 'live' | string; partnerId: string | number | null; redirectUrl: string; hasKey: boolean; expectedEgressIp: string | null };
  streamer: { minVersion: string; lostAfterSec: number; apiUrl: string };
  storage: { usedBytes: number; freeBytes: number | null; totalBytes: number | null };
  jobs: { name: string; everyMs: number; failures: number; running: boolean; lastRunAt: number; lastOkAt: number; lastError: string | null }[];
  breakers: { api: string; open: boolean; openUntil: number | null }[];
  version: string;
}

export function useSystemSettings(enabled = true) {
  return useQuery({ queryKey: ['settings', 'system'], queryFn: () => api.get<SystemSettings>('/api/settings/system'), refetchInterval: 15_000, enabled });
}

// ───────────── (b) Giới hạn hệ thống ─────────────
interface LimitField {
  key: LimitKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  int?: boolean;
  help?: string;
}

const LIMIT_GROUPS: { title: string; items: LimitField[] }[] = [
  {
    title: 'Lịch phát',
    items: [
      { key: 'maxActiveSchedulesPerShop', label: 'Số lịch đang bật tối đa mỗi shop', unit: 'lịch', min: 1, max: 100, int: true, help: 'Không cho tạo thêm lịch khi shop đã có đủ số lịch đang bật.' },
      { key: 'scheduleDaysAhead', label: 'Hẹn lịch trước tối đa', unit: 'ngày', min: 1, max: 60, int: true, help: 'Ngày bắt đầu của lịch không được xa hơn; các lượt phát được tạo sẵn trong khoảng này.' },
      { key: 'scheduleStartGraceMin', label: 'Cho phép bật lịch muộn tối đa', unit: 'phút', min: 1, max: 120, int: true, help: 'Tới giờ mà hệ thống chưa bật được (vd vừa khởi động lại) thì vẫn bật nếu chưa trễ quá mức này; trễ hơn ghi “Bỏ lỡ”.' },
    ],
  },
  {
    title: 'Mặc định cho chủ shop mới',
    items: [
      { key: 'defaultShopLimit', label: 'Số shop tối đa', unit: 'shop', min: 0, max: 10000, int: true, help: 'Dùng khi tạo tài khoản chủ shop mà không nhập giới hạn riêng.' },
      { key: 'defaultConcurrentLimit', label: 'Phiên live đồng thời tối đa', unit: 'phiên', min: 0, max: 10000, int: true },
      { key: 'defaultStorageQuotaGb', label: 'Dung lượng lưu trữ video', unit: 'GB', min: 1, max: 100000 },
    ],
  },
  {
    title: 'Phiên live',
    items: [
      { key: 'feedStartDelaySec', label: 'Chờ hình ổn định trước khi bắt đầu', unit: 'giây', min: 0, max: 120, int: true, help: 'Sau khi Shopee nhận được hình, chờ thêm rồi mới bắt đầu phiên để người xem không thấy màn hình đen.' },
      { key: 'stuckAfterMin', label: 'Cảnh báo “Có vẻ treo” sau', unit: 'phút', min: 2, max: 120, int: true, help: 'Không xác minh được trạng thái phiên với Shopee quá thời gian này thì cảnh báo.' },
      { key: 'liveCutGraceMin', label: 'Ân hạn trước khi tự ngắt phiên hết hạn', unit: 'phút', min: 0, max: 1440, int: true, help: 'Shop hết hạn dùng hoặc bị ngưng khi đang live: báo trước rồi tự kết thúc phiên sau thời gian này.' },
    ],
  },
  {
    title: 'Nhắc hạn',
    items: [
      { key: 'serviceExpiringDays', label: 'Báo “sắp hết hạn dịch vụ” trước', unit: 'ngày', min: 1, max: 60, int: true },
      { key: 'authExpiringDays', label: 'Báo “quyền Shopee sắp hết hạn” trước', unit: 'ngày', min: 1, max: 60, int: true, help: 'Quyền Shopee có hạn tối đa 365 ngày; chủ shop phải cấp quyền lại trước khi hết.' },
    ],
  },
  {
    title: 'Lưu trữ dữ liệu',
    items: [
      { key: 'apiLogRetentionDays', label: 'Giữ chi tiết lệnh gọi API', unit: 'ngày', min: 1, max: 90, int: true, help: 'Dùng để tra theo request_id và xem biểu đồ theo giờ. Số liệu tổng hợp theo ngày không bị xóa.' },
      { key: 'commentRetentionDays', label: 'Giữ bình luận livestream', unit: 'ngày', min: 1, max: 30, int: true },
    ],
  },
];

function fieldError(f: LimitField, v: string): string | null {
  if (v.trim() === '') return 'Bắt buộc';
  const n = Number(v);
  if (!isFinite(n)) return 'Không hợp lệ';
  if (f.int && !Number.isInteger(n)) return 'Phải là số nguyên';
  if (n < f.min || n > f.max) return `Trong khoảng ${f.min.toLocaleString('vi-VN')}–${f.max.toLocaleString('vi-VN')}`;
  return null;
}

export function SystemLimitsTab() {
  const q = useSystemSettings();
  const d = q.data;
  const [form, setForm] = useState<Record<string, string>>({});
  const loadedKey = d ? JSON.stringify(d.limits) : '';
  useEffect(() => {
    if (!d) return;
    setForm(Object.fromEntries(Object.entries(d.limits).map(([k, v]) => [k, String(v)])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);
  const fields = LIMIT_GROUPS.flatMap((g) => g.items);
  const changed = d ? fields.filter((f) => form[f.key] !== undefined && Number(form[f.key]) !== d.limits[f.key]) : [];
  const errors = Object.fromEntries(fields.map((f) => [f.key, form[f.key] !== undefined ? fieldError(f, form[f.key]!) : null]));
  const hasErr = fields.some((f) => errors[f.key]);
  const save = useAction(() => api.put('/api/settings/system', Object.fromEntries(changed.map((f) => [f.key, Number(form[f.key])]))), { success: 'Đã lưu cấu hình hệ thống', invalidate: [['settings', 'system']] });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return <PageLoading />;

  return (
    <Card>
      <CardHeader title="Giới hạn & thông số vận hành" icon={<SlidersHorizontal className="size-4" />} description={`Phiên bản hệ thống ${d.version}. Thay đổi có hiệu lực ngay, không cần khởi động lại.`} />
      {!d.canEdit && (
        <div className="px-4 pt-3">
          <Callout tone="neutral">Bạn đang xem ở chế độ chỉ đọc — chỉ Quản trị hệ thống được thay đổi các thông số này.</Callout>
        </div>
      )}
      <div className="divide-y divide-line">
        {LIMIT_GROUPS.map((g) => (
          <div key={g.title} className="grid gap-3 px-4 py-4 lg:grid-cols-[200px_minmax(0,1fr)]">
            <p className="text-sm font-semibold lg:pt-1.5">{g.title}</p>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((f) => {
                const isChanged = changed.includes(f);
                return (
                  <Field
                    key={f.key}
                    label={f.label}
                    error={errors[f.key]}
                    hint={
                      <>
                        {f.help && <span className="block">{f.help}</span>}
                        <span className="text-subtle">
                          {f.min.toLocaleString('vi-VN')}–{f.max.toLocaleString('vi-VN')} {f.unit}
                          {isChanged && <> · trước đây {d.limits[f.key].toLocaleString('vi-VN')}</>}
                        </span>
                      </>
                    }
                  >
                    <Input
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={f.int ? 1 : 'any'}
                      value={form[f.key] ?? ''}
                      disabled={!d.canEdit}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      invalid={Boolean(errors[f.key])}
                      className={cn(isChanged && '[&_input]:border-brand-400 [&_input]:bg-brand-50/40 dark:[&_input]:bg-brand-950/20')}
                      trailing={<span className="text-xs">{f.unit}</span>}
                    />
                  </Field>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {d.canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-4 py-2.5">
          {changed.length > 0 && <span className="mr-auto text-xs text-amber-700 dark:text-amber-400">{changed.length} thông số đã thay đổi</span>}
          {changed.length > 0 && (
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setForm(Object.fromEntries(Object.entries(d.limits).map(([k, v]) => [k, String(v)])))}>
              Hoàn tác
            </Button>
          )}
          <Button variant="primary" icon={<Save className="size-4" />} disabled={!changed.length || hasErr} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu thay đổi
          </Button>
        </div>
      )}
    </Card>
  );
}

// ───────────── (c) Đóng băng hệ thống ─────────────
const FREEZE_STOPS = [
  'Đọc và trả lời bình luận (kịch bản lẫn AI)',
  'Gọi AI',
  'Bắt đầu phiên live mới',
  'Ghim sản phẩm',
  'Bật / tắt phiên theo lịch phát',
  'Tự ngắt phiên của shop hết hạn',
  'Đồng bộ sản phẩm',
  'Làm mới token Shopee',
];
const FREEZE_KEEPS = ['Video đang phát vẫn tiếp tục đẩy hình', 'Không kết thúc phiên nào trên Shopee', 'Dữ liệu, cấu hình và lịch giữ nguyên'];
const UNFREEZE = ['Mọi hoạt động chạy lại ngay lập tức', 'Phiên đã quá giờ kết thúc theo lịch sẽ được kết thúc', 'KHÔNG chạy bù các lịch đã lỡ trong thời gian đóng băng (ghi “Bỏ lỡ”)'];

export function FreezeTab() {
  const { isSysadmin } = useAuth();
  const confirm = useConfirm();
  const q = useSystemSettings();
  const d = q.data;
  const inv = [['settings', 'system'], ['shell'], ['me'], ['dashboard']];
  const freeze = useAction((reason: string) => api.post('/api/system/freeze', { reason }), { success: 'Đã đóng băng hệ thống', invalidate: inv });
  const unfreeze = useAction(() => api.post('/api/system/unfreeze'), { success: 'Đã mở băng — hệ thống hoạt động lại', invalidate: inv });

  async function onFreeze() {
    const r = await confirm({
      title: 'Đóng băng toàn bộ hệ thống?',
      description: 'Mọi tự động hóa trên tất cả shop dừng ngay: không đọc/trả lời bình luận, không bắt đầu phiên, không chạy lịch, không ghim, không làm mới token. Video đang phát vẫn tiếp tục. Chỉ dùng khi có sự cố nghiêm trọng (Shopee cảnh báo, lỗi hàng loạt…).',
      danger: true,
      input: { label: 'Lý do đóng băng (hiển thị cho mọi người dùng)', required: true, multiline: true, placeholder: 'VD: Shopee cảnh báo tỷ lệ lỗi API, tạm dừng để kiểm tra' },
      requireText: 'DONG BANG',
      confirmText: 'Đóng băng ngay',
    });
    if (r.ok) freeze.mutate(r.value.trim());
  }

  async function onUnfreeze() {
    const r = await confirm({
      title: 'Mở băng hệ thống?',
      description: 'Mọi hoạt động chạy lại ngay. Phiên đã quá giờ kết thúc theo lịch sẽ được kết thúc; các lịch đã lỡ trong thời gian đóng băng KHÔNG được chạy bù.',
      confirmText: 'Mở băng',
    });
    if (r.ok) unfreeze.mutate();
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return <PageLoading />;
  const f = d.freeze;

  return (
    <div className="space-y-4">
      <div className={cn('flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center', f.frozen ? 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20')}>
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', f.frozen ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300')}>
          {f.frozen ? <Snowflake className="size-5" /> : <PlayCircle className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{f.frozen ? 'Hệ thống đang đóng băng' : 'Hệ thống đang hoạt động bình thường'}</p>
          {f.frozen ? (
            <div className="mt-0.5 space-y-0.5 text-sm">
              <p>
                Lý do: <b>{f.reason || '—'}</b>
              </p>
              <p className="text-muted">
                Từ {fmtDateTime(f.at)} ({fmtRelative(f.at)}){f.by ? ` · bởi ${f.by}` : ''}
              </p>
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-muted">Mọi tự động hóa đang chạy. Đóng băng là “phanh khẩn cấp” cho toàn hệ thống.</p>
          )}
        </div>
        {isSysadmin ? (
          f.frozen ? (
            <Button variant="success" icon={<PlayCircle className="size-4" />} loading={unfreeze.isPending} onClick={() => void onUnfreeze()}>
              Mở băng
            </Button>
          ) : (
            <Button variant="danger" icon={<Snowflake className="size-4" />} loading={freeze.isPending} onClick={() => void onFreeze()}>
              Đóng băng hệ thống
            </Button>
          )
        ) : (
          <Badge tone="muted">Chỉ Quản trị hệ thống thao tác</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Dừng khi đóng băng" icon={<PauseCircle className="size-4 text-rose-500" />} />
          <ul className="space-y-2 p-4 text-sm">
            {FREEZE_STOPS.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Vẫn giữ nguyên" icon={<ShieldCheck className="size-4 text-emerald-500" />} />
          <ul className="space-y-2 p-4 text-sm">
            {FREEZE_KEEPS.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Khi mở băng" icon={<PlayCircle className="size-4 text-sky-500" />} />
          <ul className="space-y-2 p-4 text-sm">
            {UNFREEZE.map((t) => (
              <li key={t} className="flex items-start gap-2">
                <CircleDot className="mt-0.5 size-4 shrink-0 text-sky-500" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Callout tone="warning" title="Không nên đóng băng lâu">
        Trong lúc đóng băng, token Shopee không được làm mới và bình luận của khách không được trả lời. Hãy mở băng ngay khi xử lý xong sự cố.
      </Callout>
    </div>
  );
}

// ───────────── (d) Kết nối Shopee & hạ tầng ─────────────
const JOB_LABELS: Record<string, string> = {
  'api-log-flush': 'Ghi nhật ký lệnh gọi API',
  'session-engine': 'Điều phối phiên live',
  comments: 'Đọc & trả lời bình luận',
  reconcile: 'Đối soát trạng thái phiên với Shopee',
  scheduler: 'Chạy lịch phát',
  servers: 'Theo dõi máy chủ phát & chuyển máy',
  tokens: 'Làm mới token Shopee',
  expiry: 'Hạn dùng & tự ngắt phiên',
  'api-health': 'Theo dõi tỷ lệ API thành công',
  'egress-ip': 'Kiểm tra IP ra Internet',
  cleanup: 'Dọn dữ liệu cũ',
};

function JobStatus({ j, frozen }: { j: SystemSettings['jobs'][number]; frozen: boolean }) {
  useNow(5000);
  const late = j.lastRunAt > 0 && Date.now() - j.lastRunAt > j.everyMs * 3 + 60000;
  if (j.failures >= 5)
    return (
      <Badge tone="danger" size="sm" icon={<XCircle className="size-3" />}>
        Lỗi {j.failures} lần liên tiếp
      </Badge>
    );
  if (j.failures > 0)
    return (
      <Badge tone="warning" size="sm" icon={<AlertTriangle className="size-3" />}>
        Lỗi {j.failures} lần
      </Badge>
    );
  if (j.running && late)
    return (
      <Badge tone="warning" size="sm" icon={<Loader2 className="size-3 animate-spin" />}>
        Chạy lâu bất thường
      </Badge>
    );
  if (j.running)
    return (
      <Badge tone="info" size="sm" icon={<Loader2 className="size-3 animate-spin" />}>
        Đang chạy
      </Badge>
    );
  if (!j.lastRunAt)
    return (
      <Badge tone="muted" size="sm" icon={<CircleDot className="size-3" />}>
        Chưa chạy
      </Badge>
    );
  if (late)
    return (
      <Badge tone="warning" size="sm" icon={<AlertTriangle className="size-3" />}>
        Trễ nhịp
      </Badge>
    );
  return (
    <Badge tone="success" size="sm" icon={<CheckCircle2 className="size-3" />}>
      {frozen ? 'Ổn định (đang đóng băng)' : 'Ổn định'}
    </Badge>
  );
}

const MODE: Record<string, { label: string; tone: 'warning' | 'info' | 'success'; hint: string }> = {
  mock: { label: 'Giả lập (mock)', tone: 'warning', hint: 'Không gọi Shopee thật — dữ liệu và phiên live là giả lập, chỉ dùng để thử nghiệm.' },
  sandbox: { label: 'Sandbox', tone: 'info', hint: 'Gọi môi trường thử nghiệm của Shopee (test shop).' },
  live: { label: 'Thật (live)', tone: 'success', hint: 'Đang gọi Shopee Open Platform thật.' },
};

export function InfraTab() {
  const copy = useCopy();
  const q = useSystemSettings();
  const d = q.data;
  const openBreakers = useMemo(() => (d?.breakers ?? []).filter((b) => b.open), [d]);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return <PageLoading />;
  const mode = MODE[d.shopee.mode] ?? { label: d.shopee.mode, tone: 'info' as const, hint: '' };
  const st = d.storage;
  // Thanh dùng số liệu cả ổ đĩa (cảnh báo “kho sắp đầy” khi còn trống < 8%); dữ liệu MEXO hiển thị riêng
  const total = st.totalBytes;
  const diskUsed = total && st.freeBytes !== null ? total - st.freeBytes : null;
  const pct = total && diskUsed !== null ? (diskUsed / total) * 100 : null;
  const freePct = pct !== null ? 100 - pct : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Kết nối Shopee Open Platform" icon={<Plug className="size-4" />} actions={<Badge tone={mode.tone} dot>{mode.label}</Badge>} />
          <div className="space-y-4 p-4">
            {mode.hint && <Callout tone={d.shopee.mode === 'mock' ? 'warning' : 'neutral'}>{mode.hint}</Callout>}
            <KV
              items={[
                { label: 'Partner ID', value: d.shopee.partnerId ? <span className="font-mono">{d.shopee.partnerId}</span> : <span className="text-muted">Chưa cấu hình</span> },
                {
                  label: 'Partner key',
                  value: d.shopee.hasKey ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" />
                      Đã cấu hình (ẩn)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5" />
                      Chưa cấu hình
                    </span>
                  ),
                },
              ]}
            />
            <div className="space-y-1.5">
              <p className="text-xs text-muted">Redirect URL (đăng ký trong Shopee Open Platform Console)</p>
              <div className="flex gap-2">
                <code className="block h-8 min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-xs leading-[30px]">{d.shopee.redirectUrl}</code>
                <Button size="md" icon={<Copy className="size-4" />} onClick={() => void copy(d.shopee.redirectUrl, 'Đã sao chép Redirect URL')}>
                  Sao chép
                </Button>
              </div>
              <p className="text-xs text-muted">Shopee chỉ chuyển chủ shop về đúng địa chỉ đã đăng ký sau khi cấp quyền. Sai địa chỉ → kết nối shop sẽ thất bại.</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted">IP ra Internet dự kiến</p>
              {d.shopee.expectedEgressIp ? (
                <div className="flex gap-2">
                  <code className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-xs">{d.shopee.expectedEgressIp}</code>
                  <Button icon={<Copy className="size-4" />} onClick={() => void copy(d.shopee.expectedEgressIp!, 'Đã sao chép IP')}>
                    Sao chép
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">Chưa khai báo — hệ thống không kiểm tra IP ra.</p>
              )}
              <p className="text-xs text-muted">Khai báo IP này trong danh sách IP được phép của App trên Console (nếu bật). Hệ thống kiểm tra mỗi 10 phút và cảnh báo nếu IP ra thực tế khác.</p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Máy chủ phát (MexoStreamer)" icon={<Server className="size-4" />} actions={<Link to="/servers" className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">Quản lý máy chủ</Link>} />
            <div className="space-y-3 p-4">
              <KV
                cols={2}
                items={[
                  { label: 'Phiên bản tối thiểu', value: <span className="font-mono">{d.streamer.minVersion}</span> },
                  { label: 'Coi là mất kết nối sau', value: `${d.streamer.lostAfterSec} giây không có tín hiệu` },
                ]}
              />
              <div className="space-y-1.5">
                <p className="text-xs text-muted">MEXO_API_URL (địa chỉ máy phát kết nối tới)</p>
                <div className="flex gap-2">
                  <code className="block h-8 min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-xs leading-[30px]">{d.streamer.apiUrl}</code>
                  <Button icon={<Copy className="size-4" />} onClick={() => void copy(d.streamer.apiUrl, 'Đã sao chép địa chỉ')}>
                    Sao chép
                  </Button>
                </div>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Kho lưu trữ" icon={<HardDrive className="size-4" />} description="Video, ảnh bìa và tệp tải lên — trên ổ đĩa của máy chủ API" />
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <p className="text-xs text-muted">Còn trống</p>
                  <p className="text-xl font-semibold tracking-tight tabular">{st.freeBytes !== null ? fmtBytes(st.freeBytes) : '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">Dữ liệu MEXO</p>
                  <p className="text-sm font-semibold tabular">{fmtBytes(st.usedBytes)}</p>
                </div>
              </div>
              {pct !== null ? (
                <>
                  <Progress value={pct} tone={freePct! < 8 ? 'danger' : freePct! < 15 ? 'warning' : 'brand'} />
                  <p className="text-xs text-muted tabular">
                    Ổ đĩa đã dùng {fmtBytes(diskUsed)} / {fmtBytes(total)} ({pct.toFixed(0)}%)
                  </p>
                  {freePct! < 15 && (
                    <p className={cn('inline-flex items-center gap-1 text-xs font-medium', freePct! < 8 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400')}>
                      <AlertTriangle className="size-3.5" />
                      Còn trống {freePct!.toFixed(1)}% — {freePct! < 8 ? 'đã tạo cảnh báo “Kho lưu trữ sắp đầy”.' : 'cảnh báo sẽ bật khi dưới 8%.'} Mở rộng ổ đĩa hoặc dọn video không dùng.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted">Không xác định được dung lượng ổ đĩa.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Tác vụ nền" icon={<Cpu className="size-4" />} description={`Các vòng lặp tự động của hệ thống. Lỗi 5 lần liên tiếp sẽ tạo cảnh báo nghiêm trọng.${d.freeze.frozen ? ' Đang đóng băng: phần lớn tác vụ bỏ qua công việc.' : ''}`} />
        <Table minWidth={860}>
          <THead>
            <tr>
              <Th>Tác vụ</Th>
              <Th>Chu kỳ</Th>
              <Th>Trạng thái</Th>
              <Th>Chạy gần nhất</Th>
              <Th>Thành công gần nhất</Th>
              <Th>Lỗi gần nhất</Th>
            </tr>
          </THead>
          <tbody>
            {d.jobs.map((j) => (
              <Tr key={j.name}>
                <Td>
                  <p className="font-medium">{JOB_LABELS[j.name] ?? j.name}</p>
                  <p className="font-mono text-2xs text-subtle">{j.name}</p>
                </Td>
                <Td className="text-xs">mỗi {fmtEvery(j.everyMs)}</Td>
                <Td>
                  <JobStatus j={j} frozen={d.freeze.frozen} />
                </Td>
                <Td className="text-xs tabular" title={j.lastRunAt ? fmtDateTime(j.lastRunAt, { seconds: true }) : ''}>
                  {j.lastRunAt ? fmtRelative(j.lastRunAt) : '—'}
                </Td>
                <Td className="text-xs tabular" title={j.lastOkAt ? fmtDateTime(j.lastOkAt, { seconds: true }) : ''}>
                  {j.lastOkAt ? fmtRelative(j.lastOkAt) : '—'}
                </Td>
                <Td className="max-w-[320px]">
                  {j.lastError ? (
                    <p className="truncate text-xs text-rose-600 dark:text-rose-400" title={j.lastError}>
                      {j.lastError}
                    </p>
                  ) : (
                    <span className="text-xs text-subtle">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="Cầu chì API Shopee"
          icon={<Zap className="size-4" />}
          description="Khi một API lỗi dồn dập (≥ 50% trong 10 lệnh gần nhất), hệ thống tạm ngắt API đó 30 giây để không kéo tụt tỷ lệ thành công, rồi tự thử lại."
          actions={
            openBreakers.length ? (
              <Badge tone="danger" icon={<ZapOff className="size-3.5" />}>
                {openBreakers.length} API đang ngắt
              </Badge>
            ) : (
              <Badge tone="success" icon={<CheckCircle2 className="size-3.5" />}>
                Tất cả bình thường
              </Badge>
            )
          }
        />
        <div className="flex flex-wrap gap-2 p-4">
          {d.breakers.length ? (
            [...d.breakers]
              .sort((a, b) => Number(b.open) - Number(a.open) || a.api.localeCompare(b.api))
              .map((b) =>
                b.open ? (
                  <Tooltip key={b.api} content={b.openUntil ? `Tự thử lại lúc ${fmtTime(b.openUntil, true)}` : 'Đang ngắt'}>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 font-mono text-xs text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900">
                      <ZapOff className="size-3" />
                      {b.api}
                      <span className="font-sans font-medium">· đang ngắt</span>
                    </span>
                  </Tooltip>
                ) : (
                  <span key={b.api} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-muted ring-1 ring-inset ring-line">
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    {b.api}
                  </span>
                ),
              )
          ) : (
            <p className="inline-flex items-center gap-1.5 text-sm text-muted">
              <Database className="size-4" />
              Chưa có API nào được gọi từ khi máy chủ khởi động.
            </p>
          )}
        </div>
      </Card>
      <p className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Globe className="size-3.5" />
        MEXO Live phiên bản {d.version}
      </p>
    </div>
  );
}
