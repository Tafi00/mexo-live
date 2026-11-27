import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { foldVi, vnDate, addDays, vnDateTime, type Signal } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, liveSessions, scheduleRuns, schedules, shops } from '../db/schema.js';
import { shopServiceState } from '../auth/auth.js';
import { getSetting } from './settings.js';

type ShopRow = typeof shops.$inferSelect;
type SessionRow = typeof liveSessions.$inferSelect;

export type ShopStatus = 'live' | 'ready' | 'attention' | 'scheduled' | 'expired' | 'suspended' | 'disconnected';

export interface ShopIssue {
  code: string;
  level: 'critical' | 'warning' | 'info';
  text: string;
}

function signals(s: SessionRow): { feed: Signal; pin: Signal; reply: Signal } {
  const feed: Signal = s.streamState === 'pushing' ? 'ok' : s.streamState === 'idle' || s.streamState === 'stopped' ? 'off' : 'attn';
  return { feed, pin: s.pinState as Signal, reply: s.replyState as Signal };
}

export function sessionSummary(s: SessionRow) {
  return {
    id: s.id,
    shopeeSessionId: s.shopeeSessionId,
    title: s.title,
    state: s.state,
    streamState: s.streamState,
    origin: s.origin,
    startedAt: s.startedAt,
    createdAt: s.createdAt,
    viewers: s.metrics?.viewers ?? 0,
    likes: s.metrics?.likes ?? 0,
    orders: s.metrics?.orders ?? 0,
    videoIndex: s.videoIndex,
    videoCount: s.playlist?.length ?? null,
    videoName: s.videoIndex !== null && s.playlist ? (s.playlist[s.videoIndex]?.name ?? null) : null,
    pinnedItemId: s.pinnedItemId,
    shareUrl: s.shareUrl,
    stuck: s.stuck,
    liveCutAt: s.liveCutAt,
    signals: signals(s),
    lastError: s.lastError,
    templateName: s.templateName,
  };
}

export async function buildShopViews(ids: number[] | null) {
  const limits = await getSetting('limits');
  const shopRows = ids === null ? await db.select().from(shops).orderBy(asc(shops.number)) : ids.length ? await db.select().from(shops).where(inArray(shops.id, ids)).orderBy(asc(shops.number)) : [];
  const shopIds = shopRows.map((s) => s.id);
  const open = shopIds.length ? await db.select().from(liveSessions).where(and(inArray(liveSessions.shopId, shopIds), ne(liveSessions.state, 'ended'))) : [];
  const openMap = new Map(open.map((s) => [s.shopId, s]));
  const today = vnDate();
  const dayStart = vnDateTime(today, '00:00');
  const dayEnd = vnDateTime(addDays(today, 1), '00:00');
  const runs = shopIds.length
    ? await db
        .select({ r: scheduleRuns, title: schedules.title })
        .from(scheduleRuns)
        .innerJoin(schedules, eq(schedules.id, scheduleRuns.scheduleId))
        .where(and(inArray(scheduleRuns.shopId, shopIds), gte(scheduleRuns.startAt, new Date(Date.now() - 12 * 3600000)), lte(scheduleRuns.startAt, new Date(Date.now() + 8 * 86400000)), inArray(scheduleRuns.status, ['upcoming', 'starting', 'live'])))
        .orderBy(asc(scheduleRuns.startAt))
    : [];
  const nextRun = new Map<number, { startAt: Date; endAt: Date; title: string; status: string; today: boolean }>();
  for (const { r, title } of runs) {
    if (!nextRun.has(r.shopId) && (r.status !== 'upcoming' || r.startAt.getTime() > Date.now() - 60000))
      nextRun.set(r.shopId, { startAt: r.startAt, endAt: r.endAt, title, status: r.status, today: r.startAt >= dayStart && r.startAt < dayEnd });
  }
  const accIds = [...new Set(shopRows.flatMap((s) => [s.ownerId, s.assigneeId]).filter((x): x is number => Boolean(x)))];
  const accRows = accIds.length ? await db.select({ id: accounts.id, name: accounts.name, username: accounts.username }).from(accounts).where(inArray(accounts.id, accIds)) : [];
  const accMap = new Map(accRows.map((a) => [a.id, a]));
  const now = Date.now();

  return shopRows.map((shop: ShopRow) => {
    const svc = shopServiceState(shop, limits.serviceExpiringDays);
    const s = openMap.get(shop.id) ?? null;
    const issues: ShopIssue[] = [];
    if (shop.connection === 'needs_reauth') issues.push({ code: 'reauth', level: 'critical', text: 'Cần cấp quyền lại Shopee' });
    if (shop.connection === 'revoked') issues.push({ code: 'revoked', level: 'critical', text: 'Shopee đã thu hồi quyền' });
    if (shop.connection === 'expired') issues.push({ code: 'auth_expired', level: 'critical', text: 'Quyền Shopee đã hết hạn' });
    if (shop.connection === 'expiring') issues.push({ code: 'auth_expiring', level: 'warning', text: 'Quyền Shopee sắp hết hạn' });
    if (svc.state === 'expired') issues.push({ code: 'expired', level: 'critical', text: 'Đã hết hạn dịch vụ' });
    if (svc.state === 'expiring') issues.push({ code: 'expiring', level: 'warning', text: `Còn ${svc.daysLeft} ngày sử dụng` });
    if (shop.replyDisabledReason) issues.push({ code: 'reply_off', level: 'warning', text: 'Trả lời tự động bị tắt do lỗi gửi' });
    if (shop.legacyHold) issues.push({ code: 'legacy_hold', level: 'info', text: 'Đang chạy ở hệ thống cũ — hệ thống mới chỉ theo dõi' });
    if (s) {
      if (s.feedLostAt) issues.push({ code: 'feed_lost', level: 'critical', text: `Mất hình ${Math.round((now - s.feedLostAt.getTime()) / 1000)} giây` });
      if (s.streamState === 'error') issues.push({ code: 'feed_error', level: 'warning', text: 'Máy lỗi đẩy hình (đang tự chạy lại)' });
      if (s.pinState === 'attn') issues.push({ code: 'pin', level: 'warning', text: s.pinError ?? 'Ghim lỗi' });
      if (s.stuck) issues.push({ code: 'stuck', level: 'critical', text: 'Phiên có vẻ bị treo' });
      if (s.state === 'sync_error') issues.push({ code: 'sync', level: 'warning', text: 'Lỗi đồng bộ trạng thái với Shopee' });
      if (s.origin === 'legacy' && s.state === 'unknown') issues.push({ code: 'legacy', level: 'info', text: 'Phiên từ hệ thống cũ — chưa xác minh' });
      if (s.origin === 'legacy' && s.state === 'live') issues.push({ code: 'legacy_live', level: 'info', text: 'Phiên do hệ thống cũ đang phát — kết thúc tại đây khi chuyển hẳn sang hệ thống mới' });
      if (s.liveCutAt) issues.push({ code: 'autocut', level: 'warning', text: 'Phiên sẽ tự ngắt do hết hạn' });
    }
    let status: ShopStatus;
    if (shop.suspendedAt) status = 'suspended';
    else if (svc.state === 'expired') status = 'expired';
    else if (s && ['live', 'connecting', 'preparing', 'disconnected'].includes(s.state)) status = 'live';
    else if (issues.some((i) => i.level !== 'info')) status = 'attention';
    else if (shop.connection !== 'ok' && shop.connection !== 'expiring') status = 'disconnected';
    else if (nextRun.get(shop.id)?.today) status = 'scheduled';
    else status = 'ready';
    const owner = shop.ownerId ? accMap.get(shop.ownerId) ?? null : null;
    const assignee = shop.assigneeId ? accMap.get(shop.assigneeId) ?? null : null;
    return {
      id: shop.id,
      number: shop.number,
      name: shop.alias || shop.shopeeName || String(shop.shopeeShopId),
      alias: shop.alias,
      shopeeName: shop.shopeeName,
      shopeeShopId: shop.shopeeShopId,
      region: shop.region,
      owner,
      assignee,
      tags: shop.tags,
      status,
      service: { state: svc.state, daysLeft: svc.daysLeft, expiresOn: shop.serviceExpiresOn, suspendedAt: shop.suspendedAt, suspendReason: shop.suspendReason },
      connection: shop.connection,
      connectionError: shop.connectionError,
      legacyHold: shop.legacyHold,
      authExpiresAt: shop.authExpiresAt,
      livestreamCheck: shop.livestreamCheck,
      replyEnabled: shop.replyEnabled,
      session: s ? sessionSummary(s) : null,
      nextRun: nextRun.get(shop.id) ?? null,
      issues,
      searchText: shop.searchText,
      createdAt: shop.createdAt,
    };
  });
}

export type ShopView = Awaited<ReturnType<typeof buildShopViews>>[number];

export function filterShopViews(list: ShopView[], q: { tab?: string; q?: string; assignee?: string; tag?: string; owner?: string; sort?: string }) {
  let items = list;
  const counts = {
    all: list.filter((x) => x.status !== 'suspended').length,
    needs: list.filter((x) => x.status !== 'suspended' && x.issues.some((i) => i.level !== 'info')).length,
    live: list.filter((x) => x.status === 'live').length,
    scheduled: list.filter((x) => x.nextRun?.today).length,
    expiring: list.filter((x) => x.service.state === 'expiring' || x.service.state === 'expired').length,
    disconnected: list.filter((x) => x.connection !== 'ok' && x.connection !== 'expiring' && x.status !== 'suspended').length,
    suspended: list.filter((x) => x.status === 'suspended').length,
  };
  switch (q.tab) {
    case 'needs':
      items = items.filter((x) => x.status !== 'suspended' && x.issues.some((i) => i.level !== 'info'));
      break;
    case 'live':
      items = items.filter((x) => x.status === 'live');
      break;
    case 'scheduled':
      items = items.filter((x) => x.nextRun?.today);
      break;
    case 'expiring':
      items = items.filter((x) => x.service.state === 'expiring' || x.service.state === 'expired');
      break;
    case 'disconnected':
      items = items.filter((x) => x.connection !== 'ok' && x.connection !== 'expiring' && x.status !== 'suspended');
      break;
    case 'suspended':
      items = items.filter((x) => x.status === 'suspended');
      break;
    default:
      items = items.filter((x) => x.status !== 'suspended');
  }
  if (q.q) {
    const f = foldVi(q.q);
    items = items.filter((x) => x.searchText.includes(f) || String(x.shopeeShopId).includes(f) || foldVi(x.name).includes(f));
  }
  if (q.assignee) items = items.filter((x) => (q.assignee === 'none' ? !x.assignee : String(x.assignee?.id) === q.assignee));
  if (q.owner) items = items.filter((x) => (q.owner === 'none' ? !x.owner : String(x.owner?.id) === q.owner));
  if (q.tag) items = items.filter((x) => x.tags.includes(q.tag!));
  const sev = (x: ShopView) => (x.issues.some((i) => i.level === 'critical') ? 0 : x.issues.some((i) => i.level === 'warning') ? 1 : 2);
  switch (q.sort) {
    case 'name':
      items = [...items].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      break;
    case 'viewers':
      items = [...items].sort((a, b) => (b.session?.viewers ?? -1) - (a.session?.viewers ?? -1));
      break;
    case 'expiry':
      items = [...items].sort((a, b) => (a.service.expiresOn ?? '9999').localeCompare(b.service.expiresOn ?? '9999'));
      break;
    case 'auth':
      items = [...items].sort((a, b) => (a.authExpiresAt?.getTime() ?? Infinity) - (b.authExpiresAt?.getTime() ?? Infinity));
      break;
    case 'number':
      items = [...items].sort((a, b) => a.number - b.number);
      break;
    default:
      items = [...items].sort((a, b) => sev(a) - sev(b) || a.number - b.number);
  }
  return { items, counts };
}
