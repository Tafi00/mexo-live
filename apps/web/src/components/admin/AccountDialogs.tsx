import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Infinity as InfinityIcon, Store, UserCog, UserPlus } from 'lucide-react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Permission, type Role } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtDate, todayVn } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { RoleBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, RadioCards, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { addMonthsStr, GB, useAllShops, type AdminShop } from './common';
import { EMAIL_RE, PermissionChecklist, ShopChecklist, validateUsername, type Account } from './accountParts';

const INV = [['accounts'], ['shops']];

function numOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function ContactFields({ name, setName, email, setEmail, phone, setPhone, note, setNote }: { name: string; setName: (v: string) => void; email: string; setEmail: (v: string) => void; phone: string; setPhone: (v: string) => void; note: string; setNote: (v: string) => void }) {
  const emailErr = email.trim() && !EMAIL_RE.test(email.trim()) ? 'Email không hợp lệ' : null;
  return (
    <>
      <Field label="Họ tên" required error={name.length > 80 ? 'Tối đa 80 ký tự' : null} className="sm:col-span-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nguyễn Văn A" />
      </Field>
      <Field label="Email" error={emailErr}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@congty.vn" invalid={Boolean(emailErr)} />
      </Field>
      <Field label="Số điện thoại">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="09xx xxx xxx" />
      </Field>
      <Field label="Ghi chú nội bộ" className="sm:col-span-2" hint="Không hiển thị cho người dùng">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-[56px]" />
      </Field>
    </>
  );
}

// ───────────── Tạo tài khoản ─────────────
export function CreateAccountDialog({ open, onClose, canCreate, onCreated }: { open: boolean; onClose: () => void; canCreate: Role[]; onCreated: (username: string, tempPassword: string) => void }) {
  const { role: myRole, isSysadmin } = useAuth();
  const defaultRole: Role = myRole !== 'owner' && canCreate.includes('owner') ? 'owner' : canCreate.includes('member') ? 'member' : (canCreate[0] ?? 'member');
  const [role, setRole] = useState<Role>(defaultRole);
  const [username, setUsername] = useState('');
  const [touchedUser, setTouchedUser] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState(addDaysStr(todayVn(), 365));
  const [unlimited, setUnlimited] = useState(false);
  const [shopLimit, setShopLimit] = useState('');
  const [concurrentLimit, setConcurrentLimit] = useState('');
  const [quotaGb, setQuotaGb] = useState('');
  const [perms, setPerms] = useState<Set<Permission>>(new Set(['shop.view', 'session.create', 'session.control', 'product.pin', 'comment.reply', 'report.view']));
  const [shopIds, setShopIds] = useState<Set<number>>(new Set());
  // Nhân viên luôn do chủ shop tạo (máy chủ không cho quản trị tạo nhân viên)
  const ownerCreatesMember = role === 'member';
  const shops = useAllShops(open && ownerCreatesMember);

  useEffect(() => {
    if (!open) return;
    setRole(defaultRole);
    setUsername('');
    setTouchedUser(false);
    setName('');
    setEmail('');
    setPhone('');
    setNote('');
    setExpiry(addDaysStr(todayVn(), 365));
    setUnlimited(false);
    setShopLimit('');
    setConcurrentLimit('');
    setQuotaGb('');
    setPerms(new Set(['shop.view', 'session.create', 'session.control', 'product.pin', 'comment.reply', 'report.view']));
    setShopIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const userErr = validateUsername(username);
  const today = todayVn();
  const expiryErr = role === 'owner' && !unlimited ? (!expiry ? 'Bắt buộc nhập hạn dùng' : expiry < today ? 'Hạn dùng đã qua' : null) : null;
  const invalid = Boolean(userErr) || !name.trim() || name.length > 80 || Boolean(email.trim() && !EMAIL_RE.test(email.trim())) || Boolean(expiryErr);

  const create = useAction(
    () => {
      const body: Record<string, unknown> = { username: username.trim(), name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, role, note: note.trim() || undefined };
      if (role === 'owner') {
        body.serviceExpiresOn = unlimited ? null : expiry;
        if (numOrNull(shopLimit) !== null) body.shopLimit = numOrNull(shopLimit);
        if (numOrNull(concurrentLimit) !== null) body.concurrentLimit = numOrNull(concurrentLimit);
        if (numOrNull(quotaGb) !== null) body.storageQuotaGb = numOrNull(quotaGb);
      }
      if (role === 'member') {
        body.permissions = [...perms];
        if (ownerCreatesMember) body.shopIds = [...shopIds];
      }
      return api.post<{ id: number; tempPassword: string }>('/api/accounts', body);
    },
    {
      invalidate: INV,
      onSuccess: (r) => {
        onCreated(username.trim(), r.tempPassword);
        onClose();
      },
    },
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <UserPlus className="size-4" />
          {myRole === 'owner' ? 'Tạo tài khoản nhân viên' : 'Tạo tài khoản'}
        </span>
      }
      description="Hệ thống tạo mật khẩu tạm; người dùng bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={invalid} loading={create.isPending} onClick={() => create.mutate()}>
            Tạo tài khoản
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {canCreate.length > 1 ? (
          <Field label="Vai trò" required>
            <RadioCards<Role> className={canCreate.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} value={role} onChange={setRole} options={canCreate.map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }))} />
          </Field>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/60 p-3">
            <RoleBadge role={role} />
            <p className="text-xs text-muted">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tên đăng nhập" required className="sm:col-span-2" error={touchedUser ? userErr : null} hint="3–64 ký tự: chữ không dấu, số và . _ @ -. Không phân biệt hoa thường và không đổi được sau khi tạo.">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} onBlur={() => setTouchedUser(true)} maxLength={64} autoComplete="off" spellCheck={false} placeholder="vd: nhanvien.lan" className="font-mono" invalid={touchedUser && Boolean(userErr)} />
          </Field>
          <ContactFields name={name} setName={setName} email={email} setEmail={setEmail} phone={phone} setPhone={setPhone} note={note} setNote={setNote} />
        </div>

        {role === 'owner' && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            <p className="text-sm font-semibold">Gói dịch vụ chủ shop</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Hạn dùng dịch vụ" required error={expiryErr} hint="Áp dụng cho mọi shop gắn vào tài khoản này">
                <Input type="date" value={unlimited ? '' : expiry} min={today} disabled={unlimited} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <div className="flex flex-wrap gap-1.5">
                  {[1, 3, 6, 12].map((m) => (
                    <Button key={m} size="xs" variant="secondary" disabled={unlimited} onClick={() => setExpiry(addMonthsStr(today, m))}>
                      {m === 12 ? '1 năm' : `${m} tháng`}
                    </Button>
                  ))}
                </div>
                {isSysadmin && <Checkbox checked={unlimited} onChange={setUnlimited} label="Không thời hạn" description="Chỉ quản trị hệ thống được đặt" />}
              </div>
              <Field label="Số shop tối đa" hint="Để trống = mặc định hệ thống">
                <Input type="number" min={0} max={10000} value={shopLimit} onChange={(e) => setShopLimit(e.target.value)} trailing={<span className="text-xs">shop</span>} />
              </Field>
              <Field label="Phiên live đồng thời tối đa" hint="Để trống = mặc định hệ thống">
                <Input type="number" min={0} max={10000} value={concurrentLimit} onChange={(e) => setConcurrentLimit(e.target.value)} trailing={<span className="text-xs">phiên</span>} />
              </Field>
              <Field label="Dung lượng lưu trữ video" hint="Để trống = mặc định hệ thống">
                <Input type="number" min={0} step="any" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} trailing={<span className="text-xs">GB</span>} />
              </Field>
            </div>
          </div>
        )}

        {role === 'member' && (
          <div className="space-y-3">
            <Field label="Quyền chi tiết">
              <PermissionChecklist value={perms} onChange={setPerms} />
            </Field>
            {ownerCreatesMember && (
              <Field label={`Shop được giao (${shopIds.size})`} hint="Nhân viên chỉ thấy những shop này. Có thể đổi sau.">
                <ShopChecklist shops={shops.data ?? []} loading={shops.isLoading} selected={shopIds} onChange={setShopIds} maxHeight="max-h-56" />
              </Field>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ───────────── Sửa tài khoản ─────────────
export function EditAccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { isStaff } = useAuth();
  const a = account;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [perms, setPerms] = useState<Set<Permission>>(new Set());
  const [shopLimit, setShopLimit] = useState('');
  const [concurrentLimit, setConcurrentLimit] = useState('');
  const [quotaGb, setQuotaGb] = useState('');
  const quotaInit = a?.storageQuotaBytes !== null && a?.storageQuotaBytes !== undefined ? String(Math.round((a.storageQuotaBytes / GB) * 100) / 100) : '';

  useEffect(() => {
    if (!a) return;
    setName(a.name);
    setEmail(a.email ?? '');
    setPhone(a.phone ?? '');
    setNote(a.note ?? '');
    setPerms(new Set(a.permissions));
    setShopLimit(a.shopLimit === null ? '' : String(a.shopLimit));
    setConcurrentLimit(a.concurrentLimit === null ? '' : String(a.concurrentLimit));
    setQuotaGb(quotaInit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);

  const editLimits = a?.role === 'owner' && isStaff;
  const invalid = !name.trim() || name.length > 80 || Boolean(email.trim() && !EMAIL_RE.test(email.trim()));

  const save = useAction(
    () => {
      const body: Record<string, unknown> = { name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, note: note.trim() || null };
      if (a!.role === 'member') body.permissions = [...perms];
      if (editLimits) {
        if (numOrNull(shopLimit) !== a!.shopLimit) body.shopLimit = numOrNull(shopLimit);
        if (numOrNull(concurrentLimit) !== a!.concurrentLimit) body.concurrentLimit = numOrNull(concurrentLimit);
        if (quotaGb.trim() !== quotaInit) body.storageQuotaGb = numOrNull(quotaGb);
      }
      return api.patch(`/api/accounts/${a!.id}`, body);
    },
    { success: 'Đã lưu tài khoản', invalidate: INV, onSuccess: onClose },
  );

  return (
    <Dialog
      open={Boolean(a)}
      onClose={onClose}
      size="lg"
      title={a ? `Sửa tài khoản — ${a.name}` : ''}
      description={a ? `@${a.username} · tên đăng nhập không đổi được` : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu thay đổi
          </Button>
        </>
      }
    >
      {a && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ContactFields name={name} setName={setName} email={email} setEmail={setEmail} phone={phone} setPhone={setPhone} note={note} setNote={setNote} />
          </div>
          {editLimits && (
            <div className="space-y-3 rounded-lg border border-line p-3">
              <p className="text-sm font-semibold">Giới hạn gói dịch vụ</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Số shop tối đa" hint={`Đang gắn ${a.shopCount} shop · trống = không giới hạn`}>
                  <Input type="number" min={0} max={10000} value={shopLimit} onChange={(e) => setShopLimit(e.target.value)} trailing={<span className="text-xs">shop</span>} />
                </Field>
                <Field label="Phiên đồng thời" hint="Trống = không giới hạn">
                  <Input type="number" min={0} max={10000} value={concurrentLimit} onChange={(e) => setConcurrentLimit(e.target.value)} trailing={<span className="text-xs">phiên</span>} />
                </Field>
                <Field label="Lưu trữ video" hint="Trống = không giới hạn">
                  <Input type="number" min={0} step="any" value={quotaGb} onChange={(e) => setQuotaGb(e.target.value)} trailing={<span className="text-xs">GB</span>} />
                </Field>
              </div>
              {numOrNull(shopLimit) !== null && numOrNull(shopLimit)! < a.shopCount && <Callout tone="warning">Giới hạn mới thấp hơn số shop đang gắn ({a.shopCount}). Shop hiện có vẫn giữ, nhưng không gắn thêm được.</Callout>}
            </div>
          )}
          {a.role === 'member' && (
            <Field label="Quyền chi tiết">
              <PermissionChecklist value={perms} onChange={setPerms} />
            </Field>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ───────────── Đổi vai trò (chỉ quản trị hệ thống) ─────────────
export function RoleDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const a = account;
  const options = (['sysadmin', 'admin', 'owner'] as Role[]).filter((r) => r !== a?.role);
  const [role, setRole] = useState<Role>(options[0] ?? 'admin');
  useEffect(() => {
    if (a) setRole(options[0] ?? 'admin');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);
  const leavingOwner = a?.role === 'owner';
  const becomingOwner = role === 'owner';
  const save = useAction(() => api.post(`/api/accounts/${a!.id}/role`, { role }), { success: 'Đã đổi vai trò', invalidate: INV, onSuccess: onClose });
  return (
    <Dialog
      open={Boolean(a)}
      onClose={onClose}
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <UserCog className="size-4" />
          Đổi vai trò — {a?.name}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant={leavingOwner && a!.shopCount > 0 ? 'danger' : 'primary'} loading={save.isPending} onClick={() => save.mutate()}>
            Đổi sang {ROLE_LABELS[role]}
          </Button>
        </>
      }
    >
      {a && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            Vai trò hiện tại: <RoleBadge role={a.role} />
          </p>
          <RadioCards<Role> value={role} onChange={setRole} options={options.map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_DESCRIPTIONS[r] }))} />
          {leavingOwner && (
            <Callout tone="danger" title={`Sẽ gỡ ${a.shopCount} shop khỏi tài khoản này`}>
              Mọi shop đang gắn sẽ trở về “MEXO vận hành” (không còn chủ). Nhân viên của chủ shop này mất quyền truy cập các shop đó. Muốn gắn lại phải xác minh chủ shop từ đầu.
            </Callout>
          )}
          {becomingOwner && <Callout tone="warning">Tài khoản trở thành khách hàng, chưa có shop nào, giới hạn mặc định 10 shop / 10 phiên đồng thời. Hãy đặt hạn dùng dịch vụ sau khi đổi.</Callout>}
          <Callout tone="neutral">Tài khoản bị đăng xuất khỏi mọi thiết bị ngay sau khi đổi vai trò.</Callout>
        </div>
      )}
    </Dialog>
  );
}

// ───────────── Gia hạn tài khoản chủ shop ─────────────
export function ExpiryDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { isSysadmin } = useAuth();
  const a = account;
  const today = todayVn();
  const base = a?.serviceExpiresOn && a.serviceExpiresOn > today ? a.serviceExpiresOn : today;
  const [date, setDate] = useState('');
  const [unlimited, setUnlimited] = useState(false);
  useEffect(() => {
    if (!a) return;
    setDate(addMonthsStr(base, 12));
    setUnlimited(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);
  const err = !unlimited && (!date ? 'Bắt buộc nhập ngày' : date < today ? 'Hạn dùng đã qua' : null);
  const save = useAction(() => api.post<{ shops: number }>(`/api/accounts/${a!.id}/service-expiry`, { date: unlimited ? null : date }), {
    success: (r) => `Đã cập nhật hạn dùng — áp dụng cho ${r.shops} shop`,
    invalidate: INV,
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={Boolean(a)}
      onClose={onClose}
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarClock className="size-4" />
          Gia hạn dịch vụ — {a?.name}
        </span>
      }
      description={a ? `Hạn hiện tại: ${a.serviceExpiresOn ? fmtDate(a.serviceExpiresOn) : 'không thời hạn'} · tính theo giờ Việt Nam` : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={Boolean(err)} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu hạn dùng
          </Button>
        </>
      }
    >
      {a && (
        <div className="space-y-3">
          <Callout tone="warning" title={`Áp dụng cho TẤT CẢ ${a.shopCount} shop đang gắn`}>
            Hạn dùng của từng shop thuộc tài khoản này sẽ bị ghi đè bằng hạn mới. Shop gắn thêm sau này cũng nhận hạn này.
          </Callout>
          <Field label="Hạn dùng mới" error={err || null}>
            <Input type="date" value={unlimited ? '' : date} min={today} disabled={unlimited} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">Cộng thêm từ {fmtDate(base)}:</span>
            {[1, 3, 6, 12, 24].map((m) => (
              <Button key={m} size="xs" variant="secondary" disabled={unlimited} onClick={() => setDate(addMonthsStr(base, m))}>
                {m >= 12 ? `${m / 12} năm` : `${m} tháng`}
              </Button>
            ))}
          </div>
          {isSysadmin && <Checkbox checked={unlimited} onChange={setUnlimited} label={<span className="inline-flex items-center gap-1.5"><InfinityIcon className="size-3.5" />Không thời hạn</span>} description="Mọi shop của tài khoản sẽ không bao giờ hết hạn dùng" />}
        </div>
      )}
    </Dialog>
  );
}

// ───────────── Gắn shop (chủ shop) / giao shop (nhân viên) ─────────────
export function AssignShopsDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { role: myRole } = useAuth();
  const a = account;
  const isOwnerTarget = a?.role === 'owner';
  const shops = useAllShops(Boolean(a));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [initial, setInitial] = useState<Set<number> | null>(null);
  const [verification, setVerification] = useState('');

  const candidates: AdminShop[] = useMemo(() => {
    const all = shops.data ?? [];
    if (!a) return [];
    if (isOwnerTarget) return all;
    if (myRole === 'owner') return all;
    return all.filter((s) => s.owner?.id === a.parentId);
  }, [shops.data, a, isOwnerTarget, myRole]);

  useEffect(() => {
    setInitial(null);
    setVerification('');
  }, [a?.id]);
  useEffect(() => {
    if (!a || !shops.data || initial) return;
    const init = new Set(isOwnerTarget ? shops.data.filter((s) => s.owner?.id === a.id).map((s) => s.id) : (a.shopIds ?? []));
    setInitial(init);
    setSel(new Set(init));
  }, [a, shops.data, initial, isOwnerTarget]);

  const added = [...sel].filter((id) => !initial?.has(id));
  const removed = [...(initial ?? [])].filter((id) => !sel.has(id));
  const needVerify = isOwnerTarget && added.length > 0;
  const overLimit = isOwnerTarget && a?.shopLimit !== null && a?.shopLimit !== undefined && sel.size > a.shopLimit;
  const disabledReason = (s: AdminShop) => (isOwnerTarget && s.owner && s.owner.id !== a?.id ? `Đang thuộc chủ shop ${s.owner.name} (@${s.owner.username}) — gỡ khỏi chủ cũ trước` : null);

  const save = useAction(() => api.put<{ count: number }>(`/api/accounts/${a!.id}/shops`, { shopIds: [...sel], ...(needVerify ? { verification: verification.trim() } : {}) }), {
    success: (r) => (isOwnerTarget ? `Đã cập nhật: ${r.count} shop thuộc ${a!.name}` : `Đã giao ${r.count} shop cho ${a!.name}`),
    invalidate: INV,
    onSuccess: onClose,
  });


  return (
    <Dialog
      open={Boolean(a)}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Store className="size-4" />
          {isOwnerTarget ? `Gắn shop cho chủ shop — ${a?.name}` : `Giao shop cho nhân viên — ${a?.name}`}
        </span>
      }
      description={isOwnerTarget ? 'Mỗi shop chỉ có một chủ. Chủ shop thấy và quản lý toàn bộ shop được gắn.' : 'Nhân viên chỉ thấy các shop được giao, với đúng quyền đã cấp.'}
      footer={
        <>
          <span className="mr-auto text-xs text-muted">
            Đã chọn <b className="text-fg">{sel.size}</b>
            {isOwnerTarget && a?.shopLimit !== null && a?.shopLimit !== undefined ? `/${a.shopLimit}` : ''} shop
            {(added.length > 0 || removed.length > 0) && (
              <>
                {' · '}
                {added.length > 0 && <span className="text-emerald-700 dark:text-emerald-400">+{added.length}</span>} {removed.length > 0 && <span className="text-rose-600 dark:text-rose-400">−{removed.length}</span>}
              </>
            )}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" disabled={!initial || overLimit || (needVerify && verification.trim().length < 5) || (!added.length && !removed.length)} loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      {a && (
        <div className="space-y-3">
          <ShopChecklist shops={candidates} loading={shops.isLoading} selected={sel} onChange={setSel} disabledReason={disabledReason} />
          {overLimit && <Callout tone="danger">Vượt số shop tối đa của tài khoản ({a.shopLimit}). Tăng giới hạn trong “Sửa thông tin” trước.</Callout>}
          {needVerify && (
            <Field label="Cách xác minh chủ shop" required hint="Bắt buộc khi gắn shop thủ công. Ghi lại để đối chiếu khi có tranh chấp." error={verification.trim() && verification.trim().length < 5 ? 'Ghi rõ hơn cách xác minh' : null}>
              <Textarea value={verification} onChange={(e) => setVerification(e.target.value)} maxLength={300} placeholder="VD: Đã gọi đúng số điện thoại đăng ký trên Shopee của shop, chủ shop xác nhận qua Zalo lúc 10:30" />
            </Field>
          )}
          {isOwnerTarget && removed.length > 0 && <Callout tone="warning">{removed.length} shop bỏ chọn sẽ trở về “MEXO vận hành” và bị gỡ người phụ trách.</Callout>}
          {isOwnerTarget && added.length > 0 && a.serviceExpiresOn && <Callout tone="info">Shop gắn thêm sẽ nhận hạn dùng của tài khoản: {fmtDate(a.serviceExpiresOn)}.</Callout>}
        </div>
      )}
    </Dialog>
  );
}
