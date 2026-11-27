// Kiểu dữ liệu riêng cho nhóm trang "Vận hành live" (khớp DTO backend).
import type { LiveSession, PlaylistEntry, SessionSummary, ShopIssue, ShopView, Signal } from '@/lib/types';

export interface SessionEventRow {
  id: number;
  sessionId: number;
  at: string;
  level: 'info' | 'warn' | 'error' | string;
  code: string;
  message: string;
  data?: unknown;
}

export interface MetricSample {
  id: number;
  sessionId: number;
  at: string;
  viewers: number | null;
  likes: number | null;
  comments: number | null;
  orders: number | null;
}

export interface PinnedProduct {
  itemId: number;
  name: string;
  imageUrl: string | null;
  sku?: string | null;
  stock?: number | null;
  price?: number | null;
}

/** GET /api/sessions/:sid */
export interface SessionDetailResponse {
  session: LiveSession;
  shop: { id: number; name: string; shopeeShopId: number; connection: string; cartLimit: number; replyEnabled: boolean };
  job: { id: number; state: string; restarts: number; lastReportAt: string | null; error: string | null } | null;
  server: { id: number; name: string } | null;
  pinned: PinnedProduct | null;
  events: SessionEventRow[];
  samples: MetricSample[];
}

/** GET /api/sessions/:sid/cart */
export interface CartItem {
  itemId: number;
  position: number;
  product: { id: number; name: string; sku: string | null; imageUrl: string | null; price: number | null; stock: number | null } | null;
}
export interface CartView {
  items: CartItem[];
  count: number;
  limit: number;
  pinned: number | null;
}

export interface CartAddResult {
  added: number[];
  skipped: { itemId: number; reason: string }[];
  failed: { itemIds: number[]; error: string } | null;
}

export interface CartPlan {
  ordered: number[];
  alreadyIn: number[];
  toAdd: number[];
  cartCount: number;
  limit: number;
}

export interface PreflightCheck {
  key: string;
  ok: boolean;
  label: string;
  detail?: string;
}
export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
  playlist: PlaylistEntry[];
  missingInCart: number[];
  server: { id: number; name: string } | null;
}

export type CommentHandled = null | 'replied' | 'skipped' | 'blocked' | 'escalated' | 'failed';

export interface CommentRow {
  id: number;
  shopId: number;
  sessionId: number;
  commentId: string;
  userId: string | null;
  username: string | null;
  content: string;
  at: string;
  handled: CommentHandled | string;
  createdAt: string;
}

export interface InboxComment extends CommentRow {
  shopName?: string | null;
  sessionTitle?: string | null;
}

export interface InboxResponse {
  items: InboxComment[];
  sessions: { id: number; shopId: number; shopName: string; title: string }[];
}

/** GET /api/live */
export interface LiveRoomItem {
  shop: { id: number; name: string; shopeeShopId: number; status: ShopView['status']; issues: ShopIssue[]; service: ShopView['service'] };
  session: SessionSummary & {
    metrics: LiveSession['metrics'] | null;
    serverName: string | null;
    pinned: { name: string; imageUrl: string | null } | null;
    positionSec: number | null;
    videoDuration: number | null;
  };
}

export interface BulkResult {
  results: { id: number; ok: boolean; message?: string }[];
  ok: number;
  failed: number;
}

/** GET /api/reports/sessions → items[] */
export interface ReportSessionRow {
  id: number;
  shopId: number;
  shopName: string;
  shopeeShopId: number;
  shopeeSessionId: number | null;
  title: string;
  origin: string;
  templateName: string | null;
  createdByName: string | null;
  state: string;
  endedReason: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  viewers: number;
  peakViewers: number;
  views: number;
  likes: number;
  comments: number;
  orders: number;
  gmv: number;
  lastError: string | null;
  shareUrl: string | null;
}

export interface ReportSessionsResponse {
  items: ReportSessionRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: { count: number; totalSeconds: number; peakViewers: number; orders: number; gmv: number; likes: number; started: number; failed: number };
  from: string;
  to: string;
  byDay: { day: string; sessions: number; hours: number; orders: number; gmv: number }[];
}

/** GET /api/shops/:id/sessions */
export interface ShopSessionsResponse {
  open: LiveSession | null;
  items: LiveSession[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ServerOption {
  id: number;
  name: string;
  state: string;
  maxStreams: number;
  runningStreams: number;
  suspended: boolean;
}

export type { Signal };
