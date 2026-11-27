import { sql } from 'drizzle-orm';
import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  date,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const big = (name: string) => bigint(name, { mode: 'number' });

// ───────────────────────── Tài khoản & phân quyền ─────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    username: text('username').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(), // sysadmin | admin | owner | member
    status: text('status').notNull().default('active'), // active | locked
    /** member → chủ shop sở hữu */
    parentId: integer('parent_id'),
    /** member: danh sách quyền chi tiết */
    permissions: jsonb('permissions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** owner: giới hạn */
    shopLimit: integer('shop_limit'),
    concurrentLimit: integer('concurrent_limit'),
    storageQuotaBytes: big('storage_quota_bytes'),
    /** owner: hạn dùng tài khoản (áp cho các shop gắn vào). null = không giới hạn */
    serviceExpiresOn: date('service_expires_on', { mode: 'string' }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('accounts_username_uq').on(sql`lower(${t.username})`), index('accounts_parent_idx').on(t.parentId)],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(), // sha256 của token cookie
    accountId: integer('account_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('auth_sessions_account_idx').on(t.accountId)],
);

/** Nhân viên được giao shop nào */
export const memberShops = pgTable(
  'member_shops',
  {
    accountId: integer('account_id').notNull(),
    shopId: integer('shop_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.shopId] })],
);

// ───────────────────────── Gian hàng ─────────────────────────

export const shops = pgTable(
  'shops',
  {
    id: serial('id').primaryKey(),
    number: integer('number').notNull(),
    shopeeShopId: big('shopee_shop_id').notNull(),
    region: text('region').notNull().default('VN'),
    shopeeName: text('shopee_name').notNull().default(''),
    alias: text('alias'),
    searchText: text('search_text').notNull().default(''),
    ownerId: integer('owner_id'),
    assigneeId: integer('assignee_id'),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Hạn dùng dịch vụ theo hợp đồng (giờ VN). null = không thời hạn */
    serviceExpiresOn: date('service_expires_on', { mode: 'string' }),
    suspendedAt: ts('suspended_at'),
    suspendReason: text('suspend_reason'),
    // Kết nối Shopee
    connection: text('connection').notNull().default('needs_reauth'),
    connectionError: text('connection_error'),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    accessExpiresAt: ts('access_expires_at'),
    authExpiresAt: ts('auth_expires_at'),
    tokenRefreshedAt: ts('token_refreshed_at'),
    livestreamCheck: text('livestream_check').notNull().default('unchecked'), // ok | denied | unchecked
    lastCheckedAt: ts('last_checked_at'),
    cartLimit: integer('cart_limit').notNull().default(100),
    // Đồng bộ sản phẩm
    productSync: jsonb('product_sync')
      .$type<{ status: string; loaded: number; total: number; syncedAt: string | null; errorCode: string | null }>()
      .notNull()
      .default(sql`'{"status":"never","loaded":0,"total":0,"syncedAt":null,"errorCode":null}'::jsonb`),
    // Trả lời bình luận
    replyEnabled: boolean('reply_enabled').notNull().default(false),
    replyUnmatched: text('reply_unmatched').notNull().default('none'), // none | ai
    replyContext: text('reply_context').notNull().default(''),
    replyConfig: jsonb('reply_config')
      .$type<{ maxPerMinute: number; perViewerCooldownSec: number; minGapSec: number; aiDailyBudget: number; maxCommentAgeSec: number }>()
      .notNull()
      .default(sql`'{"maxPerMinute":6,"perViewerCooldownSec":60,"minGapSec":5,"aiDailyBudget":300,"maxCommentAgeSec":120}'::jsonb`),
    replyDisabledReason: text('reply_disabled_reason'),
    commentPoll: jsonb('comment_poll')
      .$type<{ state: string; reason: string | null; until: string | null; failures: number }>()
      .notNull()
      .default(sql`'{"state":"normal","reason":null,"until":null,"failures":0}'::jsonb`),
    legacyId: text('legacy_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shops_shopee_uq').on(t.shopeeShopId),
    index('shops_owner_idx').on(t.ownerId),
    index('shops_assignee_idx').on(t.assigneeId),
  ],
);

export const shopNameHistory = pgTable(
  'shop_name_history',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    kind: text('kind').notNull(), // shopee | alias
    name: text('name').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('shop_name_history_shop_idx').on(t.shopId)],
);

// ───────────────────────── Sản phẩm ─────────────────────────

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    itemId: big('item_id').notNull(),
    number: integer('number').notNull().default(0),
    name: text('name').notNull(),
    searchText: text('search_text').notNull().default(''),
    sku: text('sku'),
    imageUrl: text('image_url'),
    price: real('price'),
    originalPrice: real('original_price'),
    currency: text('currency').notNull().default('VND'),
    stock: integer('stock'),
    sold: integer('sold'),
    rating: real('rating'),
    likes: integer('likes'),
    itemStatus: text('item_status').notNull().default('NORMAL'),
    models: jsonb('models').$type<{ modelId: number; name: string; sku: string | null; price: number | null; stock: number | null }[]>(),
    extra: jsonb('extra'),
    removed: boolean('removed').notNull().default(false),
    syncedAt: ts('synced_at'),
  },
  (t) => [uniqueIndex('products_shop_item_uq').on(t.shopId, t.itemId), index('products_shop_idx').on(t.shopId)],
);

// ───────────────────────── Video ─────────────────────────

export const videoFolders = pgTable(
  'video_folders',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('video_folders_shop_idx').on(t.shopId)],
);

export const videos = pgTable(
  'videos',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    number: integer('number').notNull().default(0),
    folderId: integer('folder_id'),
    name: text('name').notNull(),
    sourceFileName: text('source_file_name'),
    fileFingerprint: text('file_fingerprint'),
    durationSec: real('duration_sec'),
    sizeBytes: big('size_bytes').notNull().default(0),
    uploadedBytes: big('uploaded_bytes').notNull().default(0),
    status: text('status').notNull().default('uploading'),
    failReason: text('fail_reason'),
    storageKey: text('storage_key'),
    mime: text('mime'),
    width: integer('width'),
    height: integer('height'),
    codec: text('codec'),
    bitrate: integer('bitrate'),
    legacyId: text('legacy_id'),
    createdBy: integer('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('videos_shop_idx').on(t.shopId)],
);

// ───────────────────────── Mẫu phát ─────────────────────────

export type PinPoint = { productId: number; atSec: number };

export const templates = pgTable(
  'templates',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    number: integer('number').notNull().default(0),
    name: text('name').notNull(),
    note: text('note').notNull().default(''),
    liveTitle: text('live_title'),
    liveDescription: text('live_description'),
    coverKey: text('cover_key'),
    loop: boolean('loop').notNull().default(true),
    expectedDurationMin: integer('expected_duration_min'),
    replyMode: text('reply_mode').notNull().default('inherit'), // inherit | on | off
    legacyId: text('legacy_id'),
    legacyNeedsReview: boolean('legacy_needs_review').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('templates_shop_idx').on(t.shopId)],
);

export const templateItems = pgTable(
  'template_items',
  {
    id: serial('id').primaryKey(),
    templateId: integer('template_id').notNull(),
    position: integer('position').notNull(),
    videoId: integer('video_id').notNull(),
    pins: jsonb('pins').$type<PinPoint[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [index('template_items_tpl_idx').on(t.templateId)],
);

// ───────────────────────── Phiên livestream ─────────────────────────

export type PlaylistEntry = {
  videoId: number;
  name: string;
  durationSec: number;
  pins: { itemId: number; productId: number; atSec: number }[];
};

export const liveSessions = pgTable(
  'live_sessions',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    shopeeSessionId: big('shopee_session_id'),
    origin: text('origin').notNull().default('manual'), // manual | schedule | legacy | external
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    coverKey: text('cover_key'),
    coverUrl: text('cover_url'),
    templateId: integer('template_id'),
    templateName: text('template_name'),
    scheduleRunId: integer('schedule_run_id'),
    createdBy: integer('created_by'),
    createdByName: text('created_by_name'),
    state: text('state').notNull().default('not_started'),
    shopeeStatus: text('shopee_status').notNull().default('unknown'),
    streamState: text('stream_state').notNull().default('idle'),
    serverId: integer('server_id'),
    pushUrlEnc: text('push_url_enc'),
    domainId: big('domain_id'),
    shareUrl: text('share_url'),
    playlist: jsonb('playlist').$type<PlaylistEntry[]>(),
    loop: boolean('loop').notNull().default(true),
    videoIndex: integer('video_index'),
    videoPositionSec: real('video_position_sec'),
    loops: integer('loops').notNull().default(0),
    pinnedItemId: big('pinned_item_id'),
    /** Ghim tay: giữ nguyên tới khi video đổi */
    manualPinVideoIndex: integer('manual_pin_video_index'),
    pinState: text('pin_state').notNull().default('off'), // ok | attn | off
    pinError: text('pin_error'),
    pinVerifiedAt: ts('pin_verified_at'),
    feedSince: ts('feed_since'),
    feedLostAt: ts('feed_lost_at'),
    replyState: text('reply_state').notNull().default('off'),
    /** Bật/tắt trả lời tự động riêng cho phiên: inherit (theo mẫu/shop) | on | off */
    replyMode: text('reply_mode').notNull().default('inherit'),
    metrics: jsonb('metrics')
      .$type<{ viewers?: number; peakViewers?: number; views?: number; avgViewSec?: number; likes?: number; comments?: number; orders?: number; gmv?: number; shares?: number }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastShopeeSyncAt: ts('last_shopee_sync_at'),
    syncFailures: integer('sync_failures').notNull().default(0),
    stuck: boolean('stuck').notNull().default(false),
    lastError: text('last_error'),
    endedReason: text('ended_reason'),
    endRequestedAt: ts('end_requested_at'),
    liveCutAt: ts('live_cut_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('live_sessions_shop_idx').on(t.shopId),
    index('live_sessions_state_idx').on(t.state),
    index('live_sessions_created_idx').on(t.createdAt),
    // Mỗi shop chỉ có 1 phiên mở tại một thời điểm
    uniqueIndex('live_sessions_one_open_uq').on(t.shopId).where(sql`state <> 'ended'`),
  ],
);

export const sessionEvents = pgTable(
  'session_events',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id').notNull(),
    at: ts('at').notNull().defaultNow(),
    level: text('level').notNull().default('info'), // info | warn | error
    code: text('code').notNull(),
    message: text('message').notNull(),
    data: jsonb('data'),
  },
  (t) => [index('session_events_session_idx').on(t.sessionId)],
);

export const sessionMetricSamples = pgTable(
  'session_metric_samples',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id').notNull(),
    at: ts('at').notNull().defaultNow(),
    viewers: integer('viewers'),
    likes: integer('likes'),
    comments: integer('comments'),
    orders: integer('orders'),
  },
  (t) => [index('session_metric_samples_session_idx').on(t.sessionId)],
);

// ───────────────────────── Máy chủ phát ─────────────────────────

export const servers = pgTable('servers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash'),
  keyHint: text('key_hint'),
  keyState: text('key_state').notNull().default('active'), // active | revoked
  keyExpiresAt: ts('key_expires_at'),
  suspended: boolean('suspended').notNull().default(false),
  version: text('version'),
  maxStreams: integer('max_streams').notNull().default(0),
  runningStreams: integer('running_streams').notNull().default(0),
  host: text('host'),
  ip: text('ip'),
  metrics: jsonb('metrics').$type<{ cpu?: number; ram?: number; ramTotal?: number; netOutMbps?: number; diskUsed?: number; diskTotal?: number; load?: number }>(),
  lastHeartbeatAt: ts('last_heartbeat_at'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const streamJobs = pgTable(
  'stream_jobs',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id').notNull(),
    shopId: integer('shop_id').notNull(),
    serverId: integer('server_id'),
    desired: text('desired').notNull().default('run'), // run | stop
    state: text('state').notNull().default('waiting_server'),
    resumeIndex: integer('resume_index').notNull().default(0),
    videoIndex: integer('video_index'),
    positionSec: real('position_sec'),
    restarts: integer('restarts').notNull().default(0),
    /** Lệnh điều khiển gửi xuống máy phát (vd: chuyển sang video index) */
    command: jsonb('command').$type<{ seq: number; type: 'skip'; index: number } | null>(),
    error: text('error'),
    lastReportAt: ts('last_report_at'),
    startedAt: ts('started_at'),
    stoppedAt: ts('stopped_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('stream_jobs_session_idx').on(t.sessionId), index('stream_jobs_server_idx').on(t.serverId)],
);

// ───────────────────────── Lịch phát ─────────────────────────

export const schedules = pgTable(
  'schedules',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    templateId: integer('template_id'),
    coverKey: text('cover_key'),
    repeat: text('repeat').notNull(), // once | daily | weekly
    weekdays: jsonb('weekdays').$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    startTime: text('start_time').notNull(), // HH:mm giờ VN
    endTime: text('end_time').notNull(),
    state: text('state').notNull().default('active'), // active | paused | cancelled
    createdBy: integer('created_by'),
    legacyId: text('legacy_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('schedules_shop_idx').on(t.shopId)],
);

export const scheduleRuns = pgTable(
  'schedule_runs',
  {
    id: serial('id').primaryKey(),
    scheduleId: integer('schedule_id').notNull(),
    shopId: integer('shop_id').notNull(),
    runDate: date('run_date', { mode: 'string' }).notNull(),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    status: text('status').notNull().default('upcoming'),
    issue: text('issue'),
    issueDetail: text('issue_detail'),
    sessionId: integer('session_id'),
    attempts: integer('attempts').notNull().default(0),
    lockedAt: ts('locked_at'),
    nextAttemptAt: ts('next_attempt_at'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('schedule_runs_uq').on(t.scheduleId, t.runDate),
    index('schedule_runs_status_idx').on(t.status, t.startAt),
    index('schedule_runs_shop_idx').on(t.shopId),
  ],
);

// ───────────────────────── Bình luận & trả lời ─────────────────────────

export const replyRules = pgTable(
  'reply_rules',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    topic: text('topic').notNull(),
    keywords: jsonb('keywords').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    sample: text('sample').notNull().default(''),
    answer: text('answer').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    disabledReason: text('disabled_reason'),
    hits: integer('hits').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('reply_rules_shop_idx').on(t.shopId)],
);

export const comments = pgTable(
  'comments',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    sessionId: integer('session_id').notNull(),
    commentId: text('comment_id').notNull(),
    userId: text('user_id'),
    username: text('username'),
    content: text('content').notNull(),
    at: ts('at').notNull(),
    handled: text('handled'), // replied | skipped | blocked | null
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('comments_uq').on(t.sessionId, t.commentId), index('comments_shop_at_idx').on(t.shopId, t.at)],
);

export const replyLogs = pgTable(
  'reply_logs',
  {
    id: serial('id').primaryKey(),
    shopId: integer('shop_id').notNull(),
    sessionId: integer('session_id'),
    at: ts('at').notNull().defaultNow(),
    comment: text('comment').notNull(),
    answer: text('answer'),
    status: text('status').notNull(), // posted | skipped | blocked | failed
    source: text('source').notNull(), // rule | ai | manual
    ruleId: integer('rule_id'),
    latencyMs: integer('latency_ms'),
    reason: text('reason'),
    actorId: integer('actor_id'),
  },
  (t) => [index('reply_logs_shop_at_idx').on(t.shopId, t.at)],
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    shopId: integer('shop_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    calls: integer('calls').notNull().default(0),
    failures: integer('failures').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.day] })],
);

// ───────────────────────── Cảnh báo, nhật ký, giám sát ─────────────────────────

export const alerts = pgTable(
  'alerts',
  {
    id: serial('id').primaryKey(),
    key: text('key').notNull(),
    type: text('type').notNull(),
    severity: text('severity').notNull(), // critical | warning | info
    shopId: integer('shop_id'),
    serverId: integer('server_id'),
    sessionId: integer('session_id'),
    title: text('title').notNull(),
    message: text('message').notNull().default(''),
    count: integer('count').notNull().default(1),
    firstAt: ts('first_at').notNull().defaultNow(),
    lastAt: ts('last_at').notNull().defaultNow(),
    acknowledgedAt: ts('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by'),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('alerts_open_key_uq').on(t.key).where(sql`resolved_at IS NULL`),
    index('alerts_last_idx').on(t.lastAt),
    index('alerts_shop_idx').on(t.shopId),
  ],
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: serial('id').primaryKey(),
    at: ts('at').notNull().defaultNow(),
    actorId: integer('actor_id'),
    actorName: text('actor_name').notNull(),
    shopId: integer('shop_id'),
    targetAccountId: integer('target_account_id'),
    code: text('code').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ip: text('ip'),
  },
  (t) => [index('activity_logs_at_idx').on(t.at), index('activity_logs_shop_idx').on(t.shopId), index('activity_logs_target_idx').on(t.targetAccountId)],
);

export const apiCalls = pgTable(
  'api_calls',
  {
    id: serial('id').primaryKey(),
    at: ts('at').notNull().defaultNow(),
    api: text('api').notNull(),
    shopId: integer('shop_id'),
    shopeeShopId: big('shopee_shop_id'),
    sessionId: big('session_id'),
    httpStatus: integer('http_status'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorClass: text('error_class'), // shopee | network | backend | null
    requestId: text('request_id'),
    durationMs: integer('duration_ms').notNull(),
    retries: integer('retries').notNull().default(0),
    success: boolean('success').notNull(),
    counted: boolean('counted').notNull().default(true),
    ref: text('ref'),
  },
  (t) => [index('api_calls_at_idx').on(t.at), index('api_calls_api_at_idx').on(t.api, t.at), index('api_calls_shop_at_idx').on(t.shopId, t.at)],
);

export const apiDaily = pgTable(
  'api_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    api: text('api').notNull(),
    shopId: integer('shop_id').notNull().default(0),
    total: integer('total').notNull().default(0),
    success: integer('success').notNull().default(0),
    totalMs: big('total_ms').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.api, t.shopId] })],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const files = pgTable('files', {
  id: serial('id').primaryKey(),
  ownerShopId: integer('owner_shop_id'),
  kind: text('kind').notNull(), // cover
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Khóa phân tán nhẹ cho tác vụ nền (chống chạy trùng khi nhiều tiến trình) */
export const jobLocks = pgTable('job_locks', {
  name: text('name').primaryKey(),
  holder: text('holder').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  accountId: integer('account_id').notNull(),
  mode: text('mode').notNull(), // admin | owner | reauth
  shopId: integer('shop_id'),
  serviceExpiresOn: date('service_expires_on', { mode: 'string' }),
  ownerId: integer('owner_id'),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  result: jsonb('result'),
});
