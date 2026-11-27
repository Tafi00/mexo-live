import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, KeyRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { PublicShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Callout, Card } from '@/components/ui/misc';

export default function ChangePassword() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forced = me?.user.mustChangePassword;
  const rules = useMemo(
    () => [
      { ok: next.length >= 8, label: 'Ít nhất 8 ký tự' },
      { ok: !!next && !next.toLowerCase().includes((me?.user.username ?? '#').toLowerCase()), label: 'Không chứa tên đăng nhập' },
      { ok: !!next && next !== current, label: 'Khác mật khẩu hiện tại' },
      { ok: !!next && next === confirm, label: 'Nhập lại khớp' },
    ],
    [next, confirm, current, me],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
      await refresh();
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <Card className="p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50">
          <KeyRound className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Đổi mật khẩu</h1>
          <p className="text-sm text-muted">{forced ? 'Bạn cần đặt mật khẩu mới trước khi tiếp tục.' : 'Sau khi đổi, các thiết bị khác sẽ bị đăng xuất.'}</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label={forced ? 'Mật khẩu tạm được cấp' : 'Mật khẩu hiện tại'}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="Mật khẩu mới">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Nhập lại mật khẩu mới">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <ul className="grid grid-cols-2 gap-1.5 text-xs">
          {rules.map((r) => (
            <li key={r.label} className={cn('flex items-center gap-1.5', r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>
              {r.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
              {r.label}
            </li>
          ))}
        </ul>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!current || !rules.every((r) => r.ok)}>
          Lưu mật khẩu mới
        </Button>
        {!forced && (
          <Button variant="ghost" className="w-full" onClick={() => nav(-1)}>
            Quay lại
          </Button>
        )}
      </form>
    </Card>
  );
  return <PublicShell>{form}</PublicShell>;
}
