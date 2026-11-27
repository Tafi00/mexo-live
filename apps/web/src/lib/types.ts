// Kiểu dữ liệu trả về từ API (khớp DTO backend). Dùng chung cho các trang.

export type Signal = 'ok' | 'attn' | 'off';

export interface SessionSummary {
  id: number;
  shopeeSessionId: number | null;
  title: string;
  state: string;
  streamState: string;
  origin: string;
  startedAt: string | null;
  createdAt: string;
  viewers: number;
  likes: number;
  orders: number;
  videoIndex: number | null;
  videoCount: number | null;
  videoName: string | null;
  pinnedItemId: number | null;
  shareUrl: string | null;
  stuck: boolean;
  liveCutAt: string | null;
  signals: { feed: Signal; pin: Signal; reply: Signal };
  lastError: string | null;
  templateName: string | null;
}

export interface ShopIssue {
  code: string;
  level: 'critical' | 'warning' | 'info';
  text: string;
}

export interface ShopView {
  id: number;
  number: number;
  name: string;
  alias: string | null;
  shopeeName: string;
  shopeeShopId: number;
  region: string;
  owner: { id: number; name: string; username: string } | null;
  assignee: { id: number; name: string; username: string } | null;
  tags: string[];
  status: 'live' | 'ready' | 'attention' | 'scheduled' | 'expired' | 'suspended' | 'disconnected';
  service: { state: 'active' | 'expiring' | 'expired' | 'suspended'; daysLeft: number | null; expiresOn: string | null; suspendedAt: string | null; suspendReason: string | null };
  connection: string;
  connectionError: string | null;
  authExpiresAt: string | null;
  livestreamCheck: string;
  replyEnabled: boolean;
  session: SessionSummary | null;
  nextRun: { startAt: string; endAt: string; title: string; status: string; today: boolean } | null;
  issues: ShopIssue[];
  createdAt: string;
}

export interface ShopDetail extends ShopView {
  cartLimit: number;
  accessExpiresAt: string | null;
  tokenRefreshedAt: string | null;
  lastCheckedAt: string | null;
  productSync: { status: string; loaded: number; total: number; syncedAt: string | null; errorCode: string | null };
  replyUnmatched: string;
  replyDisabledReason: string | null;
  commentPoll: { state: string; reason: string | null; until: string | null; failures: number };
  legacyId: string | null;
}

export interface PlaylistEntry {
  videoId: number;
  name: string;
  durationSec: number;
  pins: { itemId: number; productId: number; atSec: number }[];
}

/** Phiên live đầy đủ (GET /api/sessions/:id → session) */
export interface LiveSession {
  id: number;
  shopId: number;
  shopeeSessionId: number | null;
  origin: 'manual' | 'schedule' | 'legacy' | 'external';
  title: string;
  description: string;
  coverKey: string | null;
  coverUrl: string | null;
  templateId: number | null;
  templateName: string | null;
  scheduleRunId: number | null;
  createdByName: string | null;
  state: string;
  shopeeStatus: string;
  streamState: string;
  serverId: number | null;
  shareUrl: string | null;
  playlist: PlaylistEntry[] | null;
  loop: boolean;
  videoIndex: number | null;
  videoPositionSec: number | null;
  loops: number;
  pinnedItemId: number | null;
  pinState: Signal;
  pinError: string | null;
  replyState: Signal;
  metrics: { viewers?: number; peakViewers?: number; views?: number; avgViewSec?: number; likes?: number; comments?: number; orders?: number; gmv?: number; shares?: number };
  lastShopeeSyncAt: string | null;
  syncFailures: number;
  stuck: boolean;
  lastError: string | null;
  endedReason: string | null;
  liveCutAt: string | null;
  feedSince: string | null;
  feedLostAt: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  hasPushUrl: boolean;
}

export interface Product {
  id: number;
  itemId: number;
  number: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  stock: number | null;
  sold: number | null;
  rating: number | null;
  likes: number | null;
  removed: boolean;
  models: { modelId: number; name: string; sku: string | null; price: number | null; stock: number | null }[] | null;
  syncedAt: string | null;
}

export interface Video {
  id: number;
  shopId: number;
  number: number;
  folderId: number | null;
  name: string;
  sourceFileName: string | null;
  durationSec: number | null;
  sizeBytes: number;
  uploadedBytes: number;
  status: 'ready' | 'uploading' | 'processing' | 'missing_file' | 'failed';
  failReason: string | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSummary {
  id: number;
  number: number;
  name: string;
  note: string;
  liveTitle: string | null;
  coverKey: string | null;
  loop: boolean;
  replyMode: 'inherit' | 'on' | 'off';
  videoCount: number;
  productCount: number;
  durationSec: number;
  issueCount: number;
  issues: { position: number | null; code: string; message: string }[];
  usedBySchedule: boolean;
  legacyNeedsReview: boolean;
  updatedAt: string;
}

export interface Schedule {
  id: number;
  shopId: number;
  title: string;
  description: string;
  templateId: number | null;
  templateName: string | null;
  coverKey: string | null;
  hasCover: boolean;
  repeat: 'once' | 'daily' | 'weekly';
  weekdays: number[];
  startDate: string;
  endDate: string | null;
  startTime: string;
  endTime: string;
  state: 'active' | 'paused' | 'cancelled';
  createdAt: string;
}

export interface ScheduleRun {
  id: number;
  scheduleId: number;
  shopId: number;
  runDate: string;
  startAt: string;
  endAt: string;
  status: string;
  issue: string | null;
  issueDetail: string | null;
  sessionId: number | null;
  title?: string;
  shopName?: string;
  templateName?: string | null;
  repeat?: string;
}

export interface AlertRow {
  id: number;
  key: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  shopId: number | null;
  serverId: number | null;
  sessionId: number | null;
  title: string;
  message: string;
  count: number;
  firstAt: string;
  lastAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  shopName?: string | null;
  serverName?: string | null;
}

export interface ActivityRow {
  id: number;
  at: string;
  actorId: number | null;
  actorName: string;
  shopId: number | null;
  targetAccountId: number | null;
  code: string;
  params: Record<string, unknown>;
  ip: string | null;
  shopName?: string | null;
  targetUsername?: string | null;
  label?: string;
}
