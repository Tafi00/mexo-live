import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Lock, ShieldCheck, ShieldHalf, Minus, KeyRound, Clock } from 'lucide-react';
import { foldVi, PERMISSION_LABELS, PERMISSION_PRESETS, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Permission, type Role } from '@mexo/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { daysUntil, fmtBytes, fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';
import type { ActivityRow } from '@/lib/types';
import { ActivityList } from '@/components/domain/ActivityList';
import { RoleBadge } from '@/components/domain/status';
import { Sheet } from '@/components/ui/dialog';
import { Checkbox, SearchInput } from '@/components/ui/form';
import { Avatar, Badge, Callout, Card, CardHeader, KV, PageLoading, Spinner } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import type { AdminShop } from './common';

export interface Account {
  id: number;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: string;
  parentId: number | null;
  parentName: string | null;
  permissions: Permission[];
  shopLimit: number | null;
  concurrentLimit: number | null;
  storageQuotaBytes: number | null;
  serviceExpiresOn: string | null;
  shopCount: number;
  shopIds?: number[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  note: string | null;
  createdAt: string;
  isSelf: boolean;
  canEdit: boolean;
}

export interface AccountsResponse {
  items: Account[];
  counts: Record<string, number>;
  canCreate: Role[];
}

export const USERNAME_RE = /^[a-zA-Z0-9._@-]+$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Bắt buộc nhập tên đăng nhập';
  if (s.length < 3 || s.length > 64) return 'Tên đăng nhập 3–64 ký tự';
  if (!USERNAME_RE.test(s)) return 'Chỉ gồm chữ không dấu, số và . _ @ -';
  return null;
}

// ───────────── Trạng thái tài khoản ─────────────
export function AccountStatus({ a }: { a: Account }) {
  const tempLocked = a.lockedUntil && new Date(a.lockedUntil).getTime() > Date.now();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {a.status !== 'active' ? (
        <Badge tone="danger" size="sm" icon={<Lock className="size-3" />}>
          Đã khóa
        </Badge>
      ) : tempLocked ? (
        <Badge tone="warning" size="sm" icon={<Clock className="size-3" />}>
          Tạm khóa đến {fmtDateTime(a.lockedUntil).slice(-5)}
        </Badge>
      ) : (
        <Badge tone="success" size="sm" dot>
          Hoạt động
        </Badge>
      )}
      {a.mustChangePassword && (
        <Badge tone="info" size="sm" icon={<KeyRound className="size-3" />}>
          Chờ đổi mật khẩu
        </Badge>
      )}
    </span>
  );
}

export function ExpiryText({ date }: { date: string | null }) {
  if (!date) return <Badge tone="violet" size="sm">Không thời hạn</Badge>;
  const d = daysUntil(date) ?? 0;
  return (
    <span className="inline-flex flex-col">
      <span className="tabular">{fmtDate(date)}</span>
      <span className={cn('text-2xs', d < 0 ? 'font-medium text-rose-600 dark:text-rose-400' : d <= 7 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted')}>
        {d < 0 ? `Đã hết hạn ${-d} ngày` : d === 0 ? 'Hết hạn hôm nay' : `Còn ${d} ngày`}
      </span>
    </span>
  );
}

// ───────────── Chọn quyền chi tiết ─────────────
const PERM_GROUPS: { title: string; items: Permission[] }[] = [
  { title: 'Gian hàng', items: ['shop.view', 'shop.connect'] },
  { title: 'Livestream', items: ['session.create', 'session.control', 'product.pin', 'comment.reply'] },
  { title: 'Nội dung', items: ['video.manage', 'template.manage', 'product.manage', 'schedule.manage'] },
  { title: 'Báo cáo', items: ['report.view'] },
];

const sameSet = (a: Set<string>, b: readonly string[]) => a.size === b.length && b.every((x) => a.has(x));

export function PermissionChecklist({ value, onChange, disabled }: { value: Set<Permission>; onChange: (v: Set<Permission>) => void; disabled?: boolean }) {
  const toggle = (p: Permission, on: boolean) => {
    const n = new Set(value);
    if (on) n.add(p);
    else n.delete(p);
    onChange(n);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">Mẫu nhanh:</span>
        {PERMISSION_PRESETS.map((p) => {
          const active = sameSet(value, p.permissions);
          return (
            <button
              key={p.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(new Set(p.permissions))}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50',
                active ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
              )}
            >
              {active && <Check className="size-3" />}
              {p.label}
            </button>
          );
        })}
        <button type="button" disabled={disabled} onClick={() => onChange(new Set())} className="ml-1 text-xs text-muted hover:text-fg hover:underline disabled:opacity-50">
          Bỏ chọn hết
        </button>
        <span className="ml-auto text-xs tabular text-muted">
          {value.size}/{PERMISSIONS.length} quyền
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PERM_GROUPS.map((g) => (
          <div key={g.title} className="rounded-lg border border-line p-3">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-subtle">{g.title}</p>
            <div className="space-y-2">
              {g.items.map((p) => (
                <Checkbox key={p} className="flex" checked={value.has(p)} disabled={disabled} onChange={(v) => toggle(p, v)} label={PERMISSION_LABELS[p]} description={<span className="font-mono text-2xs">{p}</span>} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {!value.has('shop.view') && (
        <Callout tone="warning">Thiếu quyền “{PERMISSION_LABELS['shop.view']}”: nhân viên sẽ không mở được shop được giao. Nên luôn giữ quyền này.</Callout>
      )}
    </div>
  );
}

// ───────────── Chọn shop ─────────────
export function ShopChecklist({ shops, selected, onChange, disabledReason, loading, maxHeight = 'max-h-[42vh]' }: { shops: AdminShop[]; selected: Set<number>; onChange: (v: Set<number>) => void; disabledReason?: (s: AdminShop) => string | null; loading?: boolean; maxHeight?: string }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const f = foldVi(q);
    return shops.filter((s) => !f || foldVi(s.name).includes(f) || String(s.shopeeShopId).includes(f) || String(s.number) === f.replace('#', ''));
  }, [shops, q]);
  const selectable = list.filter((s) => !disabledReason?.(s));
  const allSel = selectable.length > 0 && selectable.every((s) => selected.has(s.id));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Tên shop, Shop ID…" className="min-w-0 flex-1" />
        <Checkbox
          checked={allSel}
          indeterminate={!allSel && selectable.some((s) => selected.has(s.id))}
          onChange={(v) => {
            const n = new Set(selected);
            selectable.forEach((s) => (v ? n.add(s.id) : n.delete(s.id)));
            onChange(n);
          }}
          label={<span className="text-sm">Chọn tất cả ({selectable.length})</span>}
        />
      </div>
      <div className={cn('divide-y divide-line overflow-y-auto rounded-lg border border-line', maxHeight)}>
        {loading ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : list.length ? (
          list.map((s) => {
            const reason = disabledReason?.(s) ?? null;
            const on = selected.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                disabled={Boolean(reason)}
                onClick={() => {
                  const n = new Set(selected);
                  if (on) n.delete(s.id);
                  else n.add(s.id);
                  onChange(n);
                }}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm disabled:cursor-not-allowed', on ? 'bg-brand-50/70 dark:bg-brand-950/30' : 'hover:bg-surface-2', reason && 'opacity-60')}
              >
                <span className={cn('grid size-4 shrink-0 place-items-center rounded border', on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong')}>{on && <Check className="size-3" />}</span>
                <span className="w-9 shrink-0 text-xs tabular text-subtle">#{s.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  {reason && <span className="block truncate text-2xs text-muted">{reason}</span>}
                </span>
                {s.status === 'suspended' && (
                  <Badge tone="muted" size="sm">
                    Đã ngưng
                  </Badge>
                )}
                <span className="hidden font-mono text-xs text-muted sm:inline">{s.shopeeShopId}</span>
              </button>
            );
          })
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted">{shops.length ? 'Không có shop phù hợp' : 'Chưa có shop nào'}</p>
        )}
      </div>
    </div>
  );
}

// ───────────── Giải thích vai trò & ma trận quyền ─────────────
export function RoleGuide({ ownerView }: { ownerView: boolean }) {
  const roles: Role[] = ownerView ? ['owner', 'member'] : [...ROLES];
  return (
    <Card className="mb-4">
      <CardHeader title="Vai trò & phân quyền" icon={<ShieldHalf className="size-4" />} description="Mỗi tài khoản chỉ thấy đúng dữ liệu và chức năng được phép" />
      <div className="grid gap-4 p-4 lg:grid-cols-5">
        <div className="space-y-2 lg:col-span-2">
          {roles.map((r) => (
            <div key={r} className="rounded-lg border border-line p-3">
              <RoleBadge role={r} />
              <p className="mt-1.5 text-sm text-muted">{ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
          <Callout tone="info" icon={<ShieldCheck className="size-4" />} title="Cách ly dữ liệu">
            Chủ shop và nhân viên chỉ bao giờ thấy shop của chính mình — nhân viên chỉ thấy shop được giao, với đúng các quyền được cấp. Quản trị viên thấy mọi shop nhưng không quản lý được tài khoản quản trị.
          </Callout>
        </div>
        <div className="min-w-0 lg:col-span-3">
          <p className="mb-2 text-sm font-medium">Quyền chi tiết của nhân viên — theo mẫu nhanh</p>
          <div className="overflow-hidden rounded-lg border border-line">
            <Table minWidth={520}>
              <THead>
                <tr>
                  <Th>Quyền</Th>
                  {PERMISSION_PRESETS.map((p) => (
                    <Th key={p.key} align="center">
                      {p.label}
                    </Th>
                  ))}
                </tr>
              </THead>
              <tbody>
                {PERMISSIONS.map((perm) => (
                  <Tr key={perm}>
                    <Td className="py-2">
                      <span className="block">{PERMISSION_LABELS[perm]}</span>
                      <span className="font-mono text-2xs text-subtle">{perm}</span>
                    </Td>
                    {PERMISSION_PRESETS.map((p) => (
                      <Td key={p.key} align="center" className="py-2">
                        {p.permissions.includes(perm) ? <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" aria-label="Có" /> : <Minus className="mx-auto size-3.5 text-subtle" aria-label="Không" />}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted">Mẫu chỉ là điểm bắt đầu — có thể bật/tắt từng quyền cho mỗi nhân viên. Thay đổi quyền có hiệu lực ngay ở lần tải trang tiếp theo của nhân viên.</p>
        </div>
      </div>
    </Card>
  );
}

// ───────────── Ngăn kéo chi tiết + nhật ký ─────────────
export function AccountDrawer({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['accounts', account?.id, 'activity'],
    queryFn: () => api.get<{ items: ActivityRow[] }>(`/api/accounts/${account!.id}/activity`),
    enabled: Boolean(account),
  });
  const a = account;
  return (
    <Sheet open={Boolean(a)} onClose={onClose} title={a ? a.name : ''} description={a ? `@${a.username} · ${ROLE_LABELS[a.role]}` : ''} width="max-w-2xl">
      {a && (
        <div className="-mx-4 -my-4">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Avatar name={a.name} className="size-10 text-sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <RoleBadge role={a.role} />
                <AccountStatus a={a} />
              </div>
              {a.parentName && <p className="mt-1 text-xs text-muted">Nhân viên của {a.parentName}</p>}
            </div>
          </div>
          <div className="border-b border-line px-4 py-3">
            <KV
              items={[
                { label: 'Email', value: a.email || '—' },
                { label: 'Điện thoại', value: a.phone || '—' },
                { label: 'Đăng nhập gần nhất', value: a.lastLoginAt ? `${fmtDateTime(a.lastLoginAt)} (${fmtRelative(a.lastLoginAt)})` : 'Chưa đăng nhập' },
                { label: 'Tạo lúc', value: fmtDateTime(a.createdAt) },
                { label: 'Hạn dùng dịch vụ', value: <ExpiryText date={a.serviceExpiresOn} />, hidden: a.role !== 'owner' },
                { label: 'Shop', value: a.shopLimit !== null ? `${a.shopCount}/${a.shopLimit} shop` : `${a.shopCount} shop (không giới hạn)`, hidden: a.role !== 'owner' },
                { label: 'Phiên đồng thời tối đa', value: a.concurrentLimit ?? 'Không giới hạn', hidden: a.role !== 'owner' },
                { label: 'Dung lượng lưu trữ', value: a.storageQuotaBytes !== null ? fmtBytes(a.storageQuotaBytes) : 'Không giới hạn', hidden: a.role !== 'owner' },
                { label: 'Shop được giao', value: `${a.shopCount} shop`, hidden: a.role !== 'member' },
                { label: 'Ghi chú', value: a.note || '—' },
              ]}
            />
            {a.role === 'member' && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs text-muted">Quyền được cấp ({a.permissions.length}/{PERMISSIONS.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.permissions.length ? (
                    a.permissions.map((p) => (
                      <Badge key={p} tone="neutral" size="sm">
                        {PERMISSION_LABELS[p] ?? p}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted">Chưa có quyền nào</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="px-4 pb-1 pt-3">
            <p className="text-sm font-semibold">Nhật ký hoạt động</p>
            <p className="text-xs text-muted">Do tài khoản này thực hiện hoặc tác động lên tài khoản này (300 mục gần nhất)</p>
          </div>
          {q.isLoading ? <PageLoading /> : q.isError ? <p className="px-4 py-6 text-center text-sm text-rose-600">Không tải được nhật ký</p> : <ActivityList items={q.data?.items ?? []} showShop />}
        </div>
      )}
    </Sheet>
  );
}
