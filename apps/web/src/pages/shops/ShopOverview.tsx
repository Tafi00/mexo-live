import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Circle, Clapperboard, Clock, Eye, Heart, ListVideo, MessagesSquare, Package, Radio, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtDate, fmtDuration, fmtNumber, fmtRelative, fmtTime, todayVn } from '@/lib/format';
import type { ScheduleRun } from '@/lib/types';
import { RunStatusBadge, SessionStateBadge, Signals, StreamStateBadge } from '@/components/domain/status';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, StatCard } from '@/components/ui/misc';
import { useShop } from './ShopLayout';

function CheckRow({ ok, warn, label, detail, to }: { ok: boolean; warn?: boolean; label: string; detail?: string; to?: string }) {
  const body = (
    <div className="flex items-center gap-3 px-5 py-3">
      {ok ? <CheckCircle2 className="size-[18px] shrink-0 text-emerald-500" /> : warn ? <AlertTriangle className="size-[18px] shrink-0 text-amber-500" /> : <Circle className="size-[18px] shrink-0 text-subtle" />}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        {detail && <p className="text-xs text-muted">{detail}</p>}
      </div>
      {to && <ArrowRight className="size-4 text-subtle" />}
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:bg-surface-2/60">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function ShopOverview() {
  const { shop } = useShop();
  const sched = useQuery({ queryKey: ['shop', shop.id, 'schedules'], queryFn: () => api.get(`/api/shops/${shop.id}/schedules`) });
  const tpl = useQuery({ queryKey: ['shop', shop.id, 'templates'], queryFn: () => api.get(`/api/shops/${shop.id}/templates`) });
  const vids = useQuery({ queryKey: ['shop', shop.id, 'videos', 'summary'], queryFn: () => api.get(`/api/shops/${shop.id}/videos`) });
  const replies = useQuery({ queryKey: ['shop', shop.id, 'replies'], queryFn: () => api.get(`/api/shops/${shop.id}/replies`) });
  const report = useQuery({
    queryKey: ['shop', shop.id, 'report7d'],
    queryFn: () => api.get(`/api/reports/sessions`, { shopId: shop.id, from: addDaysStr(todayVn(), -6), to: todayVn(), pageSize: 1 }),
    retry: false,
  });

  const today = todayVn();
  const runs: ScheduleRun[] = (sched.data?.runs ?? []).filter((r: ScheduleRun) => r.runDate === today || (new Date(r.startAt) > new Date() && r.status === 'upcoming'));
  const s = shop.session;
  const vc = vids.data?.counts;
  const tc = tpl.data?.counts;

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Card>
          <CardHeader
            title="Phiên hiện tại"
            icon={<Radio className="size-4" />}
            actions={s && <ButtonLink to={`/sessions/${s.id}`} size="sm" variant="primary">Mở điều khiển</ButtonLink>}
          />
          {s ? (
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <SessionStateBadge state={s.state} stuck={s.stuck} />
                {s.origin !== 'legacy' && <StreamStateBadge state={s.streamState} />}
                {s.origin === 'schedule' && <span className="text-xs text-muted">· Theo lịch phát</span>}
                {s.origin === 'legacy' && <span className="text-xs text-amber-600">· Từ hệ thống cũ</span>}
              </div>
              <p className="mt-2 text-[15px] font-semibold">{s.title}</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                <span>{s.startedAt ? `Lên sóng ${fmtTime(s.startedAt)} (${fmtRelative(s.startedAt)})` : 'Chưa lên sóng'}</span>
                {s.videoCount ? <span>Video {(s.videoIndex ?? 0) + 1}/{s.videoCount}{s.videoName ? `: ${s.videoName}` : ''}</span> : null}
                {s.templateName && <span>Mẫu: {s.templateName}</span>}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-surface-2 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-xs text-muted"><Eye className="size-3.5" />Đang xem</p>
                  <p className="text-lg font-semibold tabular">{fmtNumber(s.viewers)}</p>
                </div>
                <div className="rounded-lg bg-surface-2 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-xs text-muted"><Heart className="size-3.5" />Lượt thích</p>
                  <p className="text-lg font-semibold tabular">{fmtNumber(s.likes)}</p>
                </div>
                <div className="rounded-lg bg-surface-2 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-xs text-muted"><ShoppingBag className="size-3.5" />Đơn hàng</p>
                  <p className="text-lg font-semibold tabular">{fmtNumber(s.orders)}</p>
                </div>
              </div>
              {s.origin !== 'legacy' && (
                <div className="mt-4 flex items-center gap-3 text-xs text-muted">
                  Tín hiệu: <Signals signals={s.signals} />
                </div>
              )}
              {s.lastError && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{s.lastError}</p>}
            </div>
          ) : (
            <EmptyState compact icon={Radio} title="Shop chưa có phiên nào đang mở" description="Tạo phiên mới hoặc đặt lịch phát tự động." action={<ButtonLink to="sessions?new=1" variant="primary" size="sm">Tạo phiên live</ButtonLink>} />
          )}
        </Card>

        <Card>
          <CardHeader title="Lịch phát hôm nay và sắp tới" icon={<CalendarClock className="size-4" />} actions={<ButtonLink to="schedules" size="sm">Quản lý lịch</ButtonLink>} />
          {runs.length ? (
            <div className="divide-y divide-line">
              {runs.slice(0, 6).map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-24 shrink-0">
                    <p className="text-[13px] font-semibold tabular">{fmtTime(r.startAt)}–{fmtTime(r.endAt)}</p>
                    <p className="text-xs text-muted">{r.runDate === today ? 'Hôm nay' : fmtDate(r.runDate)}</p>
                  </div>
                  <p className="min-w-0 flex-1 truncate text-[13px]">{sched.data?.schedules.find((x: any) => x.id === r.scheduleId)?.title ?? 'Lịch phát'}</p>
                  <RunStatusBadge status={r.status} size="sm" />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon={CalendarClock} title="Không có lịch phát hôm nay" />
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Phiên 7 ngày" value={report.data ? fmtNumber(report.data.summary.count) : '—'} icon={<Radio className="size-4" />} tone="brand" />
          <StatCard label="Giờ phát 7 ngày" value={report.data ? fmtNumber(report.data.summary.totalSeconds / 3600, 1) : '—'} icon={<Clock className="size-4" />} tone="info" />
        </div>
        <Card>
          <CardHeader title="Sẵn sàng phát tự động" description="Các điều kiện để livestream tự động chạy trơn tru" />
          <div className="divide-y divide-line">
            <CheckRow ok={shop.connection === 'ok'} warn={shop.connection === 'expiring'} label="Kết nối Shopee" detail={shop.connection === 'ok' ? (shop.authExpiresAt ? `Uỷ quyền tới ${fmtDate(shop.authExpiresAt)}` : 'Đang kết nối') : 'Cần cấp quyền lại'} to="connection" />
            <CheckRow
              ok={shop.productSync.status === 'done' && shop.productSync.total > 0}
              warn={shop.productSync.status === 'failed'}
              label="Danh mục sản phẩm"
              detail={shop.productSync.syncedAt ? `${fmtNumber(shop.productSync.total)} sản phẩm · đồng bộ ${fmtRelative(shop.productSync.syncedAt)}` : 'Chưa tải từ Shopee'}
              to="products"
            />
            <CheckRow ok={Boolean(vc?.ready)} warn={Boolean(vc?.missing_file || vc?.failed)} label="Thư viện video" detail={vc ? `${vc.ready} sẵn sàng${vc.missing_file ? ` · ${vc.missing_file} chưa có file` : ''}${vc.failed ? ` · ${vc.failed} lỗi` : ''}` : '…'} to="videos" />
            <CheckRow ok={Boolean(tc?.all) && !tc?.warn} warn={Boolean(tc?.warn)} label="Mẫu phát" detail={tc ? `${tc.all} mẫu${tc.warn ? ` · ${tc.warn} mẫu cần kiểm tra` : ''}` : '…'} to="templates" />
            <CheckRow ok={Boolean(replies.data?.enabled)} label="Trả lời bình luận tự động" detail={replies.data ? (replies.data.enabled ? `Đang bật · ${replies.data.rules.on} kịch bản${replies.data.unmatched === 'ai' ? ' + AI' : ''}` : 'Đang tắt') : '…'} to="replies" />
          </div>
        </Card>
        {shop.issues.length > 0 && (
          <Card>
            <CardHeader title="Việc cần xử lý" icon={<AlertTriangle className="size-4 text-amber-500" />} />
            <ul className="divide-y divide-line">
              {shop.issues.map((i) => (
                <li key={i.code} className={cn('px-5 py-2.5 text-[13px]', i.level === 'critical' ? 'text-rose-700 dark:text-rose-400' : i.level === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}>
                  {i.text}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {[
            { to: 'videos', icon: Clapperboard, label: 'Tải video' },
            { to: 'templates/new', icon: ListVideo, label: 'Tạo mẫu' },
            { to: 'replies', icon: MessagesSquare, label: 'Kịch bản' },
          ].map((x) => (
            <Link key={x.to} to={x.to} className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-3 font-medium text-muted shadow-card hover:border-line-strong hover:text-fg">
              <x.icon className="size-4" />
              {x.label}
            </Link>
          ))}
        </div>
        {report.data && report.data.summary.count > 0 && (
          <p className="px-1 text-xs text-muted">
            7 ngày qua: {fmtDuration(report.data.summary.totalSeconds)} phát, cao nhất {fmtNumber(report.data.summary.peakViewers)} người xem, {fmtNumber(report.data.summary.orders)} đơn.
          </p>
        )}
      </div>
    </div>
  );
}
