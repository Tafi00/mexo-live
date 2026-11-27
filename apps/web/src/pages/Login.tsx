import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PublicShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Callout, Card } from '@/components/ui/misc';

export default function Login() {
  const { me, refresh } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = params.get('next') || '/';
  if (me) return <Navigate to={me.user.mustChangePassword ? '/change-password' : next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ mustChangePassword: boolean }>('/api/auth/login', { username, password });
      await refresh();
      nav(r.mustChangePassword ? '/change-password' : next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <Card className="p-6 sm:p-7">
        <h1 className="text-lg font-semibold">Đăng nhập</h1>
        <p className="mt-1 text-sm text-muted">Nền tảng quản lý và tự động hóa Shopee Livestream đa gian hàng</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <Callout tone="danger">{error}</Callout>}
          <Field label="Tên đăng nhập" htmlFor="u">
            <Input id="u" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="vd: nguyenvana" />
          </Field>
          <Field label="Mật khẩu" htmlFor="p">
            <Input
              id="p"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              trailing={
                <button type="button" onClick={() => setShow((s) => !s)} className="rounded p-1 hover:bg-surface-2 hover:text-fg" aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!username || !password} icon={<LogIn className="size-4" />}>
            Đăng nhập
          </Button>
        </form>
        <p className="mt-5 text-center text-xs text-muted">Quên mật khẩu? Liên hệ quản trị viên để được cấp mật khẩu tạm.</p>
      </Card>
    </PublicShell>
  );
}
