import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  ChevronsUpDown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessagesSquare,
  Moon,
  MonitorPlay,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldAlert,
  Snowflake,
  Store,
  Sun,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ROLE_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useClickOutside, useDebounced, useTheme } from '@/lib/hooks';
import { useLiveEvents } from '@/lib/live';
import { Avatar, Badge, Kbd, Menu } from '@/components/ui/misc';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
  badge?: number;
  end?: boolean;
}

function useShell() {
  return useQuery({ queryKey: ['shell'], queryFn: () => api.get('/api/shell'), refetchInterval: 30_000 });
}

function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 shadow-sm shadow-brand-500/30">
        <svg viewBox="0 0 32 32" className="size-5">
          <path d="M8 22V10l4.5 6L17 10v12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23" cy="12" r="2.6" fill="#fff" />
        </svg>
      </span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-base font-bold tracking-tight">MEXO Live</span>
          <span className="block text-2xs font-medium uppercase tracking-wider text-muted">Shopee Livestream</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { me, isStaff, can, role } = useAuth();
  const shell = useShell();
  const alerts = shell.data?.unacknowledgedAlerts ?? 0;
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Vận hành',
      items: [
        { to: '/', label: 'Tổng quan', icon: LayoutDashboard, show: true, end: true },
        { to: '/shops', label: 'Gian hàng', icon: Store, show: true },
        { to: '/live', label: 'Phòng điều khiển', icon: MonitorPlay, show: true },
        { to: '/schedules', label: 'Lịch phát', icon: CalendarClock, show: true },
        { to: '/comments', label: 'Bình luận', icon: MessagesSquare, show: true },
        { to: '/reports', label: 'Lịch sử & báo cáo', icon: BarChart3, show: can('report.view') },
        { to: '/alerts', label: 'Cảnh báo', icon: Bell, show: true, badge: alerts },
      ],
    },
    {
      title: 'Quản trị',
      items: [
        { to: '/accounts', label: role === 'owner' ? 'Nhân viên & phân quyền' : 'Tài khoản & phân quyền', icon: Users, show: role !== 'member' },
        { to: '/servers', label: 'Máy chủ phát', icon: Server, show: isStaff },
        { to: '/monitor', label: 'Giám sát API Shopee', icon: Activity, show: isStaff },
        { to: '/audit', label: 'Nhật ký hệ thống', icon: ScrollText, show: isStaff || role === 'owner' },
        { to: '/settings', label: 'Cấu hình hệ thống', icon: Settings, show: isStaff },
      ],
    },
  ];
  const cap = shell.data?.capacity;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center px-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {groups.map((g) => {
          const items = g.items.filter((i) => i.show);
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <p className="mb-1.5 px-2.5 text-2xs font-semibold uppercase tracking-wider text-subtle">{g.title}</p>
              <div className="space-y-0.5">
                {items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    end={it.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                        isActive ? 'bg-surface text-fg shadow-card ring-1 ring-line' : 'text-muted hover:bg-surface/70 hover:text-fg',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <it.icon className={cn('size-[17px] shrink-0', isActive ? 'text-brand-500' : 'text-subtle group-hover:text-muted')} />
                        <span className="flex-1 truncate">{it.label}</span>
                        {it.badge ? <span className="rounded-full bg-rose-500 px-1.5 py-px text-2xs font-semibold text-white tabular">{it.badge > 99 ? '99+' : it.badge}</span> : null}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      {cap && (
        <div className="mx-3 mb-3 rounded-lg border border-line bg-surface p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted">Luồng đang đẩy</span>
            <span className="font-semibold tabular">
              {cap.used}/{cap.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className={cn('h-full rounded-full', cap.total && cap.used / cap.total > 0.9 ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: `${cap.total ? Math.min(100, (cap.used / cap.total) * 100) : 0}%` }} />
          </div>
          <p className="mt-1.5 text-2xs text-subtle">{cap.online} máy chủ đang kết nối</p>
        </div>
      )}
      {me && me.user.role === 'owner' && me.user.owner?.serviceExpiresOn && (
        <div className="mx-3 mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted">
          Hạn dùng tài khoản: <b className="text-fg">{me.user.owner.serviceExpiresOn.split('-').reverse().join('/')}</b>
        </div>
      )}
    </div>
  );
}

function ShopSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const dq = useDebounced(q, 150);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const r = useQuery({ queryKey: ['shops', 'suggest', dq], queryFn: () => api.get('/api/shops/suggest', { q: dq }), enabled: open });
  const items: { id: number; name: string; shopeeName: string; shopeeShopId: number; number: number }[] = r.data?.items ?? [];
  useEffect(() => setIdx(0), [dq]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);
  const go = (id: number) => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    nav(`/shops/${id}`);
  };
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIdx((i) => Math.min(items.length - 1, i + 1));
          else if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
          else if (e.key === 'Enter' && items[idx]) go(items[idx]!.id);
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Tìm shop theo tên hoặc ID (gõ không dấu được)…"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-14 text-sm placeholder:text-subtle focus:border-brand-400 focus:bg-surface focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:block">
        <Kbd>Ctrl K</Kbd>
      </span>
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 animate-slide-up overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted">{r.isLoading ? 'Đang tìm…' : 'Không có shop phù hợp'}</p>
          ) : (
            items.map((s, i) => (
              <button
                key={s.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(s.id)}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left', i === idx ? 'bg-surface-2' : '')}
              >
                <span className="w-9 text-xs tabular text-subtle">#{s.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  {s.shopeeName && s.shopeeName !== s.name && <span className="block truncate text-xs text-muted">{s.shopeeName}</span>}
                </span>
                <span className="font-mono text-2xs text-subtle">{s.shopeeShopId}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { me, isStaff } = useAuth();
  const shell = useShell();
  const [theme, toggleTheme] = useTheme();
  const nav = useNavigate();
  const qc = useQueryClient();
  const alerts = shell.data?.unacknowledgedAlerts ?? 0;
  const critical = shell.data?.criticalAlerts ?? 0;
  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    qc.clear();
    qc.setQueryData(['me'], null);
    nav('/login');
  }
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md lg:px-5">
      <button onClick={onMenu} className="-ml-1 rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Mở menu">
        <MenuIcon className="size-5" />
      </button>
      <ShopSearch />
      <div className="ml-auto flex items-center gap-1.5">
        {shell.data?.shopeeMode === 'mock' && (
          <Badge tone="violet" className="hidden md:inline-flex">
            Shopee giả lập
          </Badge>
        )}
        {isStaff && shell.data?.capacity && (
          <Link to="/servers" className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg md:flex">
            <Server className="size-4" />
            <span className="tabular font-medium text-fg">
              {shell.data.capacity.used}/{shell.data.capacity.total}
            </span>
            luồng
          </Link>
        )}
        <Link to="/alerts" className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Cảnh báo">
          <Bell className="size-[18px]" />
          {alerts > 0 && <span className={cn('absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-2xs font-bold leading-4 text-white', critical ? 'bg-rose-500' : 'bg-amber-500')}>{alerts > 99 ? '99+' : alerts}</span>}
        </Link>
        <button onClick={toggleTheme} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Đổi giao diện sáng/tối">
          {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
        {me && (
          <Menu
            width="w-60"
            trigger={({ toggle }) => (
              <button onClick={toggle} className="ml-1 flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-2">
                <Avatar name={me.user.name} />
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-[140px] truncate text-sm font-medium">{me.user.name}</span>
                  <span className="block text-2xs text-muted">{ROLE_LABELS[me.user.role]}</span>
                </span>
                <ChevronsUpDown className="hidden size-3.5 text-subtle sm:block" />
              </button>
            )}
            items={[
              { label: <span className="text-xs text-muted">Đăng nhập: <b className="text-fg">{me.user.username}</b></span>, disabled: true },
              { divider: true, label: '' },
              { label: 'Thông tin cá nhân', icon: <UserCog />, onClick: () => nav('/profile') },
              { label: 'Đổi mật khẩu', icon: <KeyRound />, onClick: () => nav('/change-password') },
              { divider: true, label: '' },
              { label: 'Đăng xuất', icon: <LogOut />, onClick: () => void logout(), danger: true },
            ]}
          />
        )}
      </div>
    </header>
  );
}

function FreezeBanner() {
  const shell = useShell();
  const { isStaff } = useAuth();
  const f = shell.data?.freeze;
  if (!f?.frozen) return null;
  return (
    <div className="flex items-center gap-2.5 border-b border-sky-300 bg-sky-600 px-4 py-1.5 text-sm text-white lg:px-5">
      <Snowflake className="size-4 shrink-0" />
      {isStaff ? (
        <span>
          <b>Hệ thống đang ĐÓNG BĂNG</b> — dừng đọc/trả lời bình luận, ghim, bật/tắt theo lịch, đồng bộ. Video đang phát vẫn chạy. Lý do: {f.reason}
        </span>
      ) : (
        <span>
          <b>Hệ thống đang tạm dừng các tác vụ tự động</b> để bảo trì. Video đang phát vẫn tiếp tục.
        </span>
      )}
      {isStaff && (
        <Link to="/settings" className="ml-auto shrink-0 font-semibold underline underline-offset-2">
          Quản lý
        </Link>
      )}
    </div>
  );
}

export function AppShell() {
  const { me } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useLiveEvents(Boolean(me));
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] border-r border-line bg-bg lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[264px] animate-slide-up border-r border-line bg-bg">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-md p-1 text-muted hover:bg-surface-2" aria-label="Đóng menu">
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[232px]">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <FreezeBanner />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4 lg:px-5 lg:py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(238,77,45,0.12),transparent)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="relative w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-subtle">
          <ShieldAlert className="mr-1 inline size-3" />
          Kết nối Shopee qua cấp quyền chính thức — không cần mật khẩu hay cookie Shopee.
        </p>
      </div>
    </div>
  );
}
