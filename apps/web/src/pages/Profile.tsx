import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { PERMISSION_LABELS, ROLE_DESCRIPTIONS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { RoleBadge } from '@/components/domain/status';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Avatar, Badge, Card, CardHeader, KV, PageHeader } from '@/components/ui/misc';

export default function Profile() {
  const { me, refresh } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (me) {
      setName(me.user.name);
      setEmail(me.user.email ?? '');
    }
  }, [me]);
  const save = useAction(() => api.patch('/api/auth/profile', { name, email: email || null }), { success: 'Đã lưu thông tin', onSuccess: () => void refresh() });
  if (!me) return null;
  const u = me.user;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Thông tin cá nhân" actions={<ButtonLink to="/change-password" icon={<KeyRound className="size-4" />}>Đổi mật khẩu</ButtonLink>} />
      <div className="space-y-5">
        <Card>
          <div className="flex items-center gap-4 p-5">
            <Avatar name={u.name} className="size-14 text-base" />
            <div className="min-w-0">
              <p className="text-lg font-semibold">{u.name}</p>
              <p className="text-[13px] text-muted">@{u.username}</p>
              <div className="mt-1.5">
                <RoleBadge role={u.role} />
              </div>
            </div>
          </div>
          <div className="border-t border-line p-5">
            <p className="text-[13px] text-muted">{ROLE_DESCRIPTIONS[u.role]}</p>
            {u.owner && (
              <KV
                className="mt-4"
                items={[
                  { label: 'Hạn dùng tài khoản', value: u.owner.serviceExpiresOn ? u.owner.serviceExpiresOn.split('-').reverse().join('/') : 'Không thời hạn' },
                  { label: 'Số shop tối đa', value: u.owner.shopLimit ?? 'Không giới hạn' },
                ]}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Chỉnh sửa" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Tên hiển thị">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tùy chọn" />
            </Field>
            <div className="sm:col-span-2">
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={!name.trim()}>
                Lưu thay đổi
              </Button>
            </div>
          </div>
        </Card>
        {u.role === 'member' && (
          <Card>
            <CardHeader title="Quyền được cấp" description="Do chủ shop của bạn phân quyền" />
            <div className="flex flex-wrap gap-2 p-5">
              {u.permissions.map((p) => (
                <Badge key={p} tone="success">
                  {PERMISSION_LABELS[p]}
                </Badge>
              ))}
            </div>
          </Card>
        )}
        <p className="text-center text-xs text-muted">
          Cần hỗ trợ? <Link to="/alerts" className="text-brand-600 hover:underline">Xem cảnh báo</Link> hoặc liên hệ quản trị viên.
        </p>
      </div>
    </div>
  );
}
