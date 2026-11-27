import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { PageLoading } from '@/components/ui/misc';

const Login = lazy(() => import('@/pages/Login'));
const ChangePassword = lazy(() => import('@/pages/ChangePassword'));
const Profile = lazy(() => import('@/pages/Profile'));
const ConnectCallback = lazy(() => import('@/pages/ConnectCallback'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const ShopList = lazy(() => import('@/pages/shops/ShopList'));
const ShopLayout = lazy(() => import('@/pages/shops/ShopLayout'));
const ShopOverview = lazy(() => import('@/pages/shops/ShopOverview'));
const ShopSessions = lazy(() => import('@/pages/shops/ShopSessions'));
const ShopHistory = lazy(() => import('@/pages/shops/ShopHistory'));
const ShopProducts = lazy(() => import('@/pages/shops/ShopProducts'));
const ShopVideos = lazy(() => import('@/pages/shops/ShopVideos'));
const ShopTemplates = lazy(() => import('@/pages/shops/ShopTemplates'));
const TemplateEditor = lazy(() => import('@/pages/shops/TemplateEditor'));
const ShopSchedules = lazy(() => import('@/pages/shops/ShopSchedules'));
const ShopReplies = lazy(() => import('@/pages/shops/ShopReplies'));
const ShopConnection = lazy(() => import('@/pages/shops/ShopConnection'));
const ShopActivity = lazy(() => import('@/pages/shops/ShopActivity'));
const SessionDetail = lazy(() => import('@/pages/sessions/SessionDetail'));
const LiveRoom = lazy(() => import('@/pages/LiveRoom'));
const SchedulesCalendar = lazy(() => import('@/pages/SchedulesCalendar'));
const CommentsInbox = lazy(() => import('@/pages/CommentsInbox'));
const Reports = lazy(() => import('@/pages/Reports'));
const Alerts = lazy(() => import('@/pages/Alerts'));
const Accounts = lazy(() => import('@/pages/Accounts'));
const Servers = lazy(() => import('@/pages/Servers'));
const Monitor = lazy(() => import('@/pages/Monitor'));
const Audit = lazy(() => import('@/pages/Audit'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoading />;
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
            <RequireAuth>
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
