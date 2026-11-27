import { Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppShell, ShellSkeleton } from '@/components/layout/AppShell';
import { PageLoading } from '@/components/ui/misc';
import { lazyPage } from '@/lib/lazyPage';

// Bảng loader: dùng chung cho lazy() và để tải sẵn code của trang đang mở song song với bước kiểm tra đăng nhập
const load = {
  Login: () => import('@/pages/Login'),
  ChangePassword: () => import('@/pages/ChangePassword'),
  Profile: () => import('@/pages/Profile'),
  ConnectCallback: () => import('@/pages/ConnectCallback'),
  Dashboard: () => import('@/pages/Dashboard'),
  ShopList: () => import('@/pages/shops/ShopList'),
  ShopLayout: () => import('@/pages/shops/ShopLayout'),
  ShopOverview: () => import('@/pages/shops/ShopOverview'),
  ShopSessions: () => import('@/pages/shops/ShopSessions'),
  ShopHistory: () => import('@/pages/shops/ShopHistory'),
  ShopProducts: () => import('@/pages/shops/ShopProducts'),
  ShopVideos: () => import('@/pages/shops/ShopVideos'),
  ShopTemplates: () => import('@/pages/shops/ShopTemplates'),
  TemplateEditor: () => import('@/pages/shops/TemplateEditor'),
  ShopSchedules: () => import('@/pages/shops/ShopSchedules'),
  ShopReplies: () => import('@/pages/shops/ShopReplies'),
  ShopConnection: () => import('@/pages/shops/ShopConnection'),
  ShopActivity: () => import('@/pages/shops/ShopActivity'),
  SessionDetail: () => import('@/pages/sessions/SessionDetail'),
  LiveRoom: () => import('@/pages/LiveRoom'),
  SchedulesCalendar: () => import('@/pages/SchedulesCalendar'),
  CommentsInbox: () => import('@/pages/CommentsInbox'),
  Reports: () => import('@/pages/Reports'),
  Alerts: () => import('@/pages/Alerts'),
  Accounts: () => import('@/pages/Accounts'),
  Servers: () => import('@/pages/Servers'),
  Monitor: () => import('@/pages/Monitor'),
  Audit: () => import('@/pages/Audit'),
  SettingsPage: () => import('@/pages/Settings'),
};
const Login = lazyPage(load.Login);
const ChangePassword = lazyPage(load.ChangePassword);
const Profile = lazyPage(load.Profile);
const ConnectCallback = lazyPage(load.ConnectCallback);
const Dashboard = lazyPage(load.Dashboard);
const ShopList = lazyPage(load.ShopList);
const ShopLayout = lazyPage(load.ShopLayout);
const ShopOverview = lazyPage(load.ShopOverview);
const ShopSessions = lazyPage(load.ShopSessions);
const ShopHistory = lazyPage(load.ShopHistory);
const ShopProducts = lazyPage(load.ShopProducts);
const ShopVideos = lazyPage(load.ShopVideos);
const ShopTemplates = lazyPage(load.ShopTemplates);
const TemplateEditor = lazyPage(load.TemplateEditor);
const ShopSchedules = lazyPage(load.ShopSchedules);
const ShopReplies = lazyPage(load.ShopReplies);
const ShopConnection = lazyPage(load.ShopConnection);
const ShopActivity = lazyPage(load.ShopActivity);
const SessionDetail = lazyPage(load.SessionDetail);
const LiveRoom = lazyPage(load.LiveRoom);
const SchedulesCalendar = lazyPage(load.SchedulesCalendar);
const CommentsInbox = lazyPage(load.CommentsInbox);
const Reports = lazyPage(load.Reports);
const Alerts = lazyPage(load.Alerts);
const Accounts = lazyPage(load.Accounts);
const Servers = lazyPage(load.Servers);
const Monitor = lazyPage(load.Monitor);
const Audit = lazyPage(load.Audit);
const SettingsPage = lazyPage(load.SettingsPage);

/** Đường dẫn → các chunk cần cho trang đó (shop: khung shop + tab) */
const PRELOAD: [RegExp, (() => Promise<unknown>)[]][] = [
  [/^\/login/, [Login.preload]],
  [/^\/change-password/, [ChangePassword.preload]],
  [/^\/connect\/callback/, [ConnectCallback.preload]],
  [/^\/$/, [Dashboard.preload]],
  [/^\/profile/, [Profile.preload]],
  [/^\/shops\/?$/, [ShopList.preload]],
  [/^\/shops\/[^/]+\/?$/, [ShopLayout.preload, ShopOverview.preload]],
  [/^\/shops\/[^/]+\/sessions/, [ShopLayout.preload, ShopSessions.preload]],
  [/^\/shops\/[^/]+\/history/, [ShopLayout.preload, ShopHistory.preload]],
  [/^\/shops\/[^/]+\/products/, [ShopLayout.preload, ShopProducts.preload]],
  [/^\/shops\/[^/]+\/videos/, [ShopLayout.preload, ShopVideos.preload]],
  [/^\/shops\/[^/]+\/templates\/.+/, [ShopLayout.preload, TemplateEditor.preload]],
  [/^\/shops\/[^/]+\/templates/, [ShopLayout.preload, ShopTemplates.preload]],
  [/^\/shops\/[^/]+\/schedules/, [ShopLayout.preload, ShopSchedules.preload]],
  [/^\/shops\/[^/]+\/replies/, [ShopLayout.preload, ShopReplies.preload]],
  [/^\/shops\/[^/]+\/connection/, [ShopLayout.preload, ShopConnection.preload]],
  [/^\/shops\/[^/]+\/activity/, [ShopLayout.preload, ShopActivity.preload]],
  [/^\/sessions\//, [SessionDetail.preload]],
  [/^\/live/, [LiveRoom.preload]],
  [/^\/schedules/, [SchedulesCalendar.preload]],
  [/^\/comments/, [CommentsInbox.preload]],
  [/^\/reports/, [Reports.preload]],
  [/^\/alerts/, [Alerts.preload]],
  [/^\/accounts/, [Accounts.preload]],
  [/^\/servers/, [Servers.preload]],
  [/^\/monitor/, [Monitor.preload]],
  [/^\/audit/, [Audit.preload]],
  [/^\/settings/, [SettingsPage.preload]],
];
const hit = PRELOAD.find(([re]) => re.test(window.location.pathname));
hit?.[1].forEach((fn) => void fn().catch(() => {}));
// Sau khi trang đầu hiện xong: tải sẵn code các trang còn lại lúc rảnh → chuyển trang không phải chờ
setTimeout(() => {
  for (const P of [Dashboard, ShopList, ShopLayout, ShopOverview, LiveRoom, SchedulesCalendar, CommentsInbox, Reports, Alerts, Accounts, Servers, Monitor, Audit, SettingsPage, SessionDetail, ShopSessions, ShopHistory, ShopProducts, ShopVideos, ShopTemplates, TemplateEditor, ShopSchedules, ShopReplies, ShopConnection, ShopActivity, Profile]) void P.preload().catch(() => {});
}, 2500);

function RequireAuth({ children, shell }: { children: ReactNode; shell?: boolean }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return shell ? <ShellSkeleton /> : <PageLoading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.user.mustChangePassword && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/connect/callback" element={<ConnectCallback />} />
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePassword />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth shell>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="shops" element={<ShopList />} />
          <Route path="shops/:shopId" element={<ShopLayout />}>
            <Route index element={<ShopOverview />} />
            <Route path="sessions" element={<ShopSessions />} />
            <Route path="history" element={<ShopHistory />} />
            <Route path="products" element={<ShopProducts />} />
            <Route path="videos" element={<ShopVideos />} />
            <Route path="templates" element={<ShopTemplates />} />
            <Route path="templates/new" element={<TemplateEditor />} />
            <Route path="templates/:templateId" element={<TemplateEditor />} />
            <Route path="schedules" element={<ShopSchedules />} />
            <Route path="replies" element={<ShopReplies />} />
            <Route path="connection" element={<ShopConnection />} />
            <Route path="activity" element={<ShopActivity />} />
          </Route>
          <Route path="sessions/:sessionId" element={<SessionDetail />} />
          <Route path="live" element={<LiveRoom />} />
          <Route path="schedules" element={<SchedulesCalendar />} />
          <Route path="comments" element={<CommentsInbox />} />
          <Route path="reports" element={<Reports />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="servers" element={<Servers />} />
          <Route path="monitor" element={<Monitor />} />
          <Route path="audit" element={<Audit />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
