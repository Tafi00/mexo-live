import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, History, KeyRound, Lock, LockOpen, MoreHorizontal, PencilLine, Plus, ShieldHalf, Store, Trash2, UserCog, Users } from 'lucide-react';
import { toast } from 'sonner';
import { foldVi, PERMISSIONS, ROLE_LABELS, type Role } from '@mexo/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCopy, useLocalState } from '@/lib/hooks';
import { SecretBox, SecretDialog } from '@/components/admin/common';
import { PortalMenu } from '@/components/admin/PortalMenu';
import { AccountDrawer, AccountStatus, ExpiryText, RoleGuide, type Account, type AccountsResponse } from '@/components/admin/accountParts';
import { AssignShopsDialog, CreateAccountDialog, EditAccountDialog, ExpiryDialog, RoleDialog } from '@/components/admin/AccountDialogs';
import { RoleBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { SearchInput } from '@/components/ui/form';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, Tooltip, type MenuItem } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';

type Tab = 'all' | Role | 'locked';

export default function Accounts() {
  const { role: myRole, isStaff, isSysadmin } = useAuth();
  const ownerView = myRole === 'owner';
  const confirm = useConfirm();
  const copy = useCopy();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [showGuide, setShowGuide] = useLocalState('mexo-accounts-guide', false);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ username: string; password: string; kind: 'new' | 'reset' } | null>(null);
  const [edit, setEdit] = useState<Account | null>(null);
  const [roleOf, setRoleOf] = useState<Account | null>(null);
  const [expiryOf, setExpiryOf] = useState<Account | null>(null);
  const [assignOf, setAssignOf] = useState<Account | null>(null);
  const [detail, setDetail] = useState<Account | null>(null);

  const list = useQuery({ queryKey: ['accounts'], queryFn: () => api.get<AccountsResponse>('/api/accounts'), refetchInterval: 60_000 });
  const counts = list.data?.counts ?? {};
  const canCreate = list.data?.canCreate ?? [];

  const items = useMemo(() => {
    let all = list.data?.items ?? [];
    if (tab === 'locked') all = all.filter((a) => a.status !== 'active');
    else if (tab !== 'all') all = all.filter((a) => a.role === tab);
    const f = foldVi(q);
    if (f) all = all.filter((a) => foldVi(`${a.name} ${a.username} ${a.email ?? ''} ${a.phone ?? ''} ${a.parentName ?? ''} ${a.note ?? ''}`).includes(f));
    // Bản thân lên đầu, rồi theo vai trò
    const order: Record<string, number> = { sysadmin: 0, admin: 1, owner: 2, member: 3 };
    return [...all].sort((x, y) => Number(y.isSelf) - Number(x.isSelf) || (order[x.role] ?? 9) - (order[y.role] ?? 9) || x.id - y.id);
  }, [list.data, tab, q]);

  const tabs: { value: Tab; label: string; count: number | null; tone?: 'danger' }[] = ownerView
    ? [
        { value: 'all', label: 'Tất cả', count: counts.all ?? null },
        { value: 'member', label: 'Nhân viên', count: counts.member ?? null },
        { value: 'locked', label: 'Đã khóa', count: counts.locked ?? null, tone: 'danger' },
      ]
    : [
        { value: 'all', label: 'Tất cả', count: counts.all ?? null },
        { value: 'sysadmin', label: ROLE_LABELS.sysadmin, count: counts.sysadmin ?? null },
        { value: 'admin', label: ROLE_LABELS.admin, count: counts.admin ?? null },
        { value: 'owner', label: ROLE_LABELS.owner, count: counts.owner ?? null },
        { value: 'member', label: ROLE_LABELS.member, count: counts.member ?? null },
        { value: 'locked', label: 'Đã khóa', count: counts.locked ?? null, tone: 'danger' },
      ];

  async function run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      void list.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function lock(a: Account) {
    const r = await confirm({
      title: `Khóa tài khoản @${a.username}?`,
      description: 'Tài khoản bị đăng xuất khỏi mọi thiết bị ngay lập tức và không đăng nhập được cho đến khi mở khóa. Dữ liệu và shop vẫn giữ nguyên.',
      danger: true,
      confirmText: 'Khóa tài khoản',
    });
    if (r.ok) void run(() => api.post(`/api/accounts/${a.id}/lock`), 'Đã khóa tài khoản');
  }

  async function unlock(a: Account) {
    const r = await confirm({ title: `Mở khóa @${a.username}?`, description: 'Tài khoản đăng nhập lại được bằng mật khẩu hiện tại. Bộ đếm đăng nhập sai được xóa.', confirmText: 'Mở khóa' });
    if (r.ok) void run(() => api.post(`/api/accounts/${a.id}/unlock`), 'Đã mở khóa tài khoản');
  }

  async function resetPassword(a: Account) {
    const r = await confirm({
      title: `Đặt lại mật khẩu cho @${a.username}?`,
      description: 'Mật khẩu cũ hết hiệu lực ngay, tài khoản bị đăng xuất khỏi mọi thiết bị. Hệ thống tạo mật khẩu tạm (chỉ hiện một lần) và người dùng phải đổi mật khẩu ở lần đăng nhập tới.',
      confirmText: 'Đặt lại mật khẩu',
    });
    if (!r.ok) return;
    try {
      const res = await api.post<{ tempPassword: string }>(`/api/accounts/${a.id}/reset-password`);
      setSecret({ username: a.username, password: res.tempPassword, kind: 'reset' });
      void list.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function remove(a: Account) {
    const extra = a.role === 'owner' ? ' Chủ shop còn gắn shop hoặc còn nhân viên thì không xóa được — hãy khóa thay vì xóa.' : '';
    const r = await confirm({
      title: `Xóa vĩnh viễn tài khoản @${a.username}?`,
      description: `Không thể hoàn tác. Tài khoản bị đăng xuất và xóa khỏi hệ thống; nhật ký hoạt động cũ vẫn được giữ.${extra}`,
      danger: true,
      requireText: a.username,
      confirmText: 'Xóa tài khoản',
    });
    if (r.ok) void run(() => api.del(`/api/accounts/${a.id}`), 'Đã xóa tài khoản');
  }

  function menuFor(a: Account): MenuItem[] {
    const assignable = (a.role === 'owner' && isStaff) || a.role === 'member';
    return [
      { label: 'Sửa thông tin', icon: <PencilLine />, onClick: () => setEdit(a) },
      { label: a.role === 'owner' ? 'Gắn shop' : 'Giao shop', icon: <Store />, onClick: () => setAssignOf(a), hidden: !assignable },
      { label: 'Gia hạn dịch vụ', icon: <CalendarClock />, onClick: () => setExpiryOf(a), hidden: !(a.role === 'owner' && isStaff) },
      { label: 'Đổi vai trò', icon: <UserCog />, onClick: () => setRoleOf(a), hidden: !(isSysadmin && a.role !== 'member') },
      { label: 'Xem nhật ký hoạt động', icon: <History />, onClick: () => setDetail(a) },
      { divider: true, label: '' },
      { label: 'Đặt lại mật khẩu', icon: <KeyRound />, onClick: () => void resetPassword(a) },
      a.status === 'active' ? { label: 'Khóa tài khoản', icon: <Lock />, onClick: () => void lock(a) } : { label: 'Mở khóa', icon: <LockOpen />, onClick: () => void unlock(a) },
      { divider: true, label: '' },
      { label: 'Xóa tài khoản', icon: <Trash2 />, danger: true, onClick: () => void remove(a) },
    ];
  }

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <div>
      <PageHeader
        title={ownerView ? 'Nhân viên & phân quyền' : 'Tài khoản & phân quyền'}
        description={ownerView ? 'Tạo tài khoản cho nhân viên, giao shop và cấp từng quyền. Nhân viên chỉ thấy shop được giao.' : 'Quản lý tài khoản nội bộ, chủ shop và nhân viên. Mỗi tài khoản chỉ thấy đúng dữ liệu được phép.'}
        actions={
          <>
            <Button icon={<ShieldHalf className="size-4" />} variant={showGuide ? 'secondary' : 'outline'} onClick={() => setShowGuide(!showGuide)}>
              Vai trò & quyền
            </Button>
            {canCreate.length > 0 && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                {ownerView ? 'Thêm nhân viên' : 'Tạo tài khoản'}
              </Button>
            )}
          </>
        }
      />

      {showGuide && <RoleGuide ownerView={ownerView} />}

      <Card>
        <div className="px-3 pt-1">
          <Tabs<Tab> value={tab} onChange={setTab} items={tabs} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tên, tên đăng nhập, email, số điện thoại…" className="w-full sm:w-80" inputSize="sm" />
          <span className="ml-auto text-xs text-muted">{list.data ? `${items.length} tài khoản` : ''}</span>
        </div>
        {!list.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length ? (
          <Table minWidth={980}>
            <THead>
              <tr>
                <Th>Tài khoản</Th>
                <Th>Vai trò</Th>
                <Th>Trạng thái</Th>
                <Th>Shop & quyền</Th>
                {!ownerView && <Th>Hạn dùng</Th>}
                <Th>Đăng nhập gần nhất</Th>
                <Th className="w-12" />
              </tr>
            </THead>
            <tbody>
              {items.map((a) => (
                <Tr key={a.id} onClick={() => setDetail(a)}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={a.name} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          {a.name}
                          {a.isSelf && (
                            <Badge tone="brand" size="sm">
                              Bạn
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted">
                          <span className="font-mono">@{a.username}</span>
                          {(a.email || a.phone) && <span> · {a.email || a.phone}</span>}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <RoleBadge role={a.role} size="sm" />
                    {a.role === 'member' && a.parentName && !ownerView && <p className="mt-0.5 truncate text-[11px] text-muted">thuộc {a.parentName}</p>}
                  </Td>
                  <Td>
                    <AccountStatus a={a} />
                  </Td>
                  <Td>
                    {a.role === 'owner' ? (
                      <span className="text-[13px] tabular">
                        {a.shopCount}
                        <span className="text-muted">{a.shopLimit !== null ? ` / ${a.shopLimit}` : ''} shop</span>
                        {a.shopLimit !== null && a.shopCount >= a.shopLimit && (
                          <Badge tone="warning" size="sm" className="ml-1.5">
                            Đủ giới hạn
                          </Badge>
                        )}
                      </span>
                    ) : a.role === 'member' ? (
                      <span className="text-[13px]">
                        <span className="tabular">{a.shopCount}</span> <span className="text-muted">shop ·</span>{' '}
                        <Tooltip content={a.permissions.length ? `${a.permissions.length} quyền được cấp` : 'Chưa có quyền nào'}>
                          <span className={cn('tabular', !a.permissions.includes('shop.view') && 'text-amber-700 dark:text-amber-400')}>
                            {a.permissions.length}/{PERMISSIONS.length} quyền
                          </span>
                        </Tooltip>
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted">Mọi shop</span>
                    )}
                  </Td>
                  {!ownerView && <Td className="text-[13px]">{a.role === 'owner' ? <ExpiryText date={a.serviceExpiresOn} /> : <span className="text-subtle">—</span>}</Td>}
                  <Td className="text-[13px]">
                    {a.lastLoginAt ? (
                      <span title={fmtDateTime(a.lastLoginAt)}>{fmtRelative(a.lastLoginAt)}</span>
                    ) : (
                      <span className="text-subtle">Chưa đăng nhập</span>
                    )}
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    {a.canEdit && !a.isSelf ? (
                      <PortalMenu
                        items={menuFor(a)}
                        trigger={({ toggle }) => <Button iconOnly size="sm" variant="ghost" icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="Thao tác" />}
                      />
                    ) : (
                      <Button iconOnly size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setDetail(a)} aria-label="Xem nhật ký" />
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            icon={Users}
            title={q ? 'Không có tài khoản phù hợp' : ownerView ? 'Chưa có nhân viên nào' : 'Chưa có tài khoản'}
            description={ownerView && !q ? 'Thêm nhân viên để cùng vận hành livestream, mỗi người chỉ thấy shop và chức năng được cấp.' : undefined}
            action={
              ownerView && !q && canCreate.length > 0 ? (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                  Thêm nhân viên
                </Button>
              ) : undefined
            }
          />
        )}
      </Card>

      <p className="mt-3 text-xs text-muted">
        {ownerView
          ? 'Bạn chỉ thấy và quản lý nhân viên của chính mình. Tài khoản của bạn do MEXO quản lý — liên hệ quản trị viên để đổi gói hoặc gia hạn.'
          : 'Không thao tác được trên chính tài khoản của mình tại đây (dùng trang Hồ sơ). Quản trị viên không quản lý được tài khoản quản trị.'}
      </p>

      <CreateAccountDialog open={createOpen} onClose={() => setCreateOpen(false)} canCreate={canCreate} onCreated={(username, password) => setSecret({ username, password, kind: 'new' })} />
      <EditAccountDialog account={edit} onClose={() => setEdit(null)} />
      <RoleDialog account={roleOf} onClose={() => setRoleOf(null)} />
      <ExpiryDialog account={expiryOf} onClose={() => setExpiryOf(null)} />
      <AssignShopsDialog account={assignOf} onClose={() => setAssignOf(null)} />
      <AccountDrawer account={detail} onClose={() => setDetail(null)} />

      <SecretDialog
        open={Boolean(secret)}
        onClose={() => setSecret(null)}
        title={secret?.kind === 'new' ? 'Đã tạo tài khoản' : 'Đã đặt lại mật khẩu'}
        description="Gửi thông tin đăng nhập cho người dùng qua kênh riêng tư (gặp trực tiếp, tin nhắn cá nhân)."
        warning={
          <>
            Mật khẩu tạm <b>chỉ hiện một lần</b> — sau khi đóng hộp thoại sẽ không xem lại được (chỉ có thể đặt lại mật khẩu mới). Người dùng <b>bắt buộc đổi mật khẩu</b> ở lần đăng nhập đầu tiên.
          </>
        }
      >
        {secret && (
          <div className="space-y-3">
            <SecretBox label="Tên đăng nhập" value={secret.username} />
            <SecretBox label="Mật khẩu tạm" value={secret.password} />
            <Button variant="secondary" size="sm" onClick={() => void copy(`Tên đăng nhập: ${secret.username}\nMật khẩu tạm: ${secret.password}\nĐăng nhập tại: ${window.location.origin}/login (đổi mật khẩu ở lần đăng nhập đầu tiên)`, 'Đã sao chép thông tin đăng nhập')}>
              Sao chép cả hai kèm đường dẫn đăng nhập
            </Button>
          </div>
        )}
      </SecretDialog>
    </div>
  );
}
