// Dùng chung giữa API, Web và Streamer: vai trò, quyền, trạng thái, nhãn tiếng Việt.

export const ROLES = ['sysadmin', 'admin', 'owner', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  sysadmin: 'Quản trị hệ thống',
  admin: 'Quản trị viên',
  owner: 'Chủ shop',
  member: 'Nhân viên',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  sysadmin: 'Toàn quyền: tài khoản, máy chủ phát, giám sát API, đóng băng hệ thống.',
  admin: 'Vận hành: thấy mọi shop, kết nối shop, đặt hạn dùng, cấu hình AI. Không quản lý tài khoản quản trị.',
  owner: 'Khách hàng: quản lý shop của mình, tạo tài khoản nhân viên và phân quyền.',
  member: 'Nhân viên của chủ shop: chỉ thấy shop và chức năng được cấp.',
};

/** 11 quyền chi tiết theo Brief mục II.3 */
export const PERMISSIONS = [
  'shop.view',
  'shop.connect',
  'session.create',
  'session.control',
  'video.manage',
  'product.manage',
  'product.pin',
  'schedule.manage',
  'comment.reply',
  'report.view',
  'template.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'shop.view': 'Xem gian hàng',
  'shop.connect': 'Kết nối gian hàng',
  'session.create': 'Tạo phiên livestream',
  'session.control': 'Bắt đầu / kết thúc livestream',
  'video.manage': 'Tải lên và quản lý video',
  'product.manage': 'Quản lý sản phẩm',
  'product.pin': 'Ghim sản phẩm',
  'schedule.manage': 'Tạo lịch phát',
  'comment.reply': 'Trả lời bình luận',
  'report.view': 'Xem báo cáo',
  'template.manage': 'Quản lý mẫu phát',
};

export const PERMISSION_PRESETS: { key: string; label: string; permissions: Permission[] }[] = [
  { key: 'viewer', label: 'Chỉ xem', permissions: ['shop.view', 'report.view'] },
  {
    key: 'operator',
    label: 'Vận hành live',
    permissions: ['shop.view', 'session.create', 'session.control', 'product.pin', 'comment.reply', 'report.view'],
  },
  {
    key: 'content',
    label: 'Nội dung',
    permissions: ['shop.view', 'video.manage', 'template.manage', 'product.manage', 'schedule.manage'],
  },
  { key: 'full', label: 'Toàn quyền shop', permissions: [...PERMISSIONS] },
];

/** Trạng thái phiên livestream (Brief VII.3) — trạng thái nghiệp vụ tổng hợp */
export const SESSION_STATES = [
  'not_started',
  'preparing',
  'connecting',
  'live',
  'ending',
  'ended',
  'disconnected',
  'sync_error',
  'unknown',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const SESSION_STATE_LABELS: Record<SessionState, string> = {
  not_started: 'Chưa bắt đầu',
  preparing: 'Đang chuẩn bị',
  connecting: 'Đang kết nối',
  live: 'Đang livestream',
  ending: 'Đang kết thúc',
  ended: 'Đã kết thúc',
  disconnected: 'Mất kết nối',
  sync_error: 'Lỗi đồng bộ',
  unknown: 'Chưa xác minh',
};

export const OPEN_SESSION_STATES: SessionState[] = [
  'not_started',
  'preparing',
  'connecting',
  'live',
  'ending',
  'disconnected',
  'sync_error',
  'unknown',
];

/** Trạng thái truyền phát của máy chủ nội bộ — tách biệt với trạng thái Shopee */
export const STREAM_STATES = ['idle', 'waiting_server', 'preparing', 'pushing', 'error', 'lost', 'stopped'] as const;
export type StreamState = (typeof STREAM_STATES)[number];
export const STREAM_STATE_LABELS: Record<StreamState, string> = {
  idle: 'Chưa phát',
  waiting_server: 'Chờ máy nhận',
  preparing: 'Đang chuẩn bị video',
  pushing: 'Đang đẩy hình',
  error: 'Lỗi đẩy hình',
  lost: 'Máy mất kết nối',
  stopped: 'Đã dừng',
};

export const SHOPEE_STATUS_LABELS: Record<string, string> = {
  not_started: 'Chưa bắt đầu',
  ongoing: 'Đang live',
  ended: 'Đã kết thúc',
  unknown: 'Không rõ',
};

export const CONNECTION_STATES = ['ok', 'expiring', 'expired', 'revoked', 'needs_reauth', 'error'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];
export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  ok: 'Đang kết nối',
  expiring: 'Quyền sắp hết hạn',
  expired: 'Quyền đã hết hạn',
  revoked: 'Mất quyền',
  needs_reauth: 'Cần cấp quyền lại',
  error: 'Lỗi kết nối',
};

export const VIDEO_STATES = ['ready', 'uploading', 'processing', 'missing_file', 'failed'] as const;
export type VideoState = (typeof VIDEO_STATES)[number];
export const VIDEO_STATE_LABELS: Record<VideoState, string> = {
  ready: 'Sẵn sàng',
  uploading: 'Đang tải lên',
  processing: 'Đang xử lý',
  missing_file: 'Chưa có file',
  failed: 'Lỗi',
};

export const RUN_STATES = ['upcoming', 'starting', 'live', 'ending', 'done', 'missed', 'failed', 'cancelled'] as const;
export type RunState = (typeof RUN_STATES)[number];
export const RUN_STATE_LABELS: Record<RunState, string> = {
  upcoming: 'Sắp tới',
  starting: 'Đang bật',
  live: 'Đang phát',
  ending: 'Đang tắt',
  done: 'Đã chạy',
  missed: 'Bỏ lỡ',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

export const RUN_ISSUE_LABELS: Record<string, string> = {
  no_template: 'Lịch chưa có mẫu phát',
  no_cover: 'Lịch chưa có ảnh bìa',
  template_invalid: 'Mẫu phát không đạt kiểm tra',
  shop_busy: 'Shop đang có phiên khác',
  shop_expired: 'Shop hết hạn dùng',
  shop_suspended: 'Shop đã ngưng dịch vụ',
  shop_disconnected: 'Shop mất kết nối Shopee',
  create_failed: 'Shopee không tạo được phiên',
  start_failed: 'Không khởi động được phát tự động',
  no_server: 'Không có máy chủ phát còn trống',
  system_down: 'Hệ thống không chạy lúc tới giờ',
  restarted: 'Hệ thống khởi động lại đúng lúc bật',
  frozen: 'Hệ thống đang đóng băng',
  end_failed: 'Shopee chưa cho kết thúc phiên',
  ended_manually: 'Phiên đã được tắt tay trước giờ',
  schedule_cancelled: 'Lịch đã bị hủy',
};

export const REPEAT_LABELS = { once: 'Một lần', daily: 'Hằng ngày', weekly: 'Theo thứ trong tuần' } as const;
export const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export const ALERT_SEVERITY_LABELS = { critical: 'Nghiêm trọng', warning: 'Cần xử lý', info: 'Thông tin' } as const;

export const ALERT_TYPE_LABELS: Record<string, string> = {
  server_lost: 'Máy chủ mất kết nối',
  server_rejected: 'Máy chủ bị từ chối (phiên bản cũ)',
  server_overload: 'Máy chủ quá tải',
  reply_disabled: 'Trả lời tự động bị tắt do lỗi gửi',
  ai_budget: 'Shop hết lượt AI trong ngày',
  shop_reauth: 'Shop cần kết nối lại',
  auth_expiring: 'Quyền Shopee sắp hết hạn',
  auth_expired: 'Quyền Shopee đã hết hạn',
  service_expiring: 'Sắp hết hạn dịch vụ',
  service_expired: 'Đã hết hạn dịch vụ',
  pin_failed: 'Ghim sản phẩm lỗi',
  session_stuck: 'Phiên có vẻ bị treo',
  session_autocut: 'Phiên sẽ tự ngắt do hết hạn',
  session_autocut_failed: 'Không tự ngắt được phiên',
  feed_lost: 'Mất hình',
  api_rate_low: 'Tỷ lệ gọi API Shopee thấp',
  api_mass_failure: 'Nhiều shop lỗi API đồng thời',
  schedule_start_failed: 'Lịch không bật được',
  schedule_end_failed: 'Chưa tắt được phiên theo lịch',
  rule_disabled: 'Kịch bản bị tắt do vi phạm nội dung',
  job_failing: 'Tác vụ nền lỗi liên tiếp',
  egress_ip: 'IP ra Internet sai',
  storage_full: 'Kho lưu trữ sắp đầy',
  internal_error: 'Lỗi chương trình',
};

export const ACTIVITY_LABELS: Record<string, string> = {
  connected: 'Kết nối shop',
  reconnected: 'Cấp quyền lại',
  alias_set: 'Đặt tên gợi nhớ',
  alias_cleared: 'Xóa tên gợi nhớ',
  service_expiry_set: 'Đổi hạn dùng',
  suspended: 'Ngưng dịch vụ',
  reopened: 'Mở lại dịch vụ',
  assignee_set: 'Đổi người phụ trách',
  owner_set: 'Gắn chủ shop',
  tags_set: 'Đổi nhóm',
  products_synced: 'Đồng bộ sản phẩm',
  video_uploaded: 'Tải video',
  video_renamed: 'Đổi tên video',
  video_deleted: 'Xóa video',
  template_created: 'Tạo mẫu phát',
  template_updated: 'Sửa mẫu phát',
  template_deleted: 'Xóa mẫu phát',
  schedule_created: 'Tạo lịch phát',
  schedule_updated: 'Sửa lịch phát',
  schedule_paused: 'Tạm dừng lịch',
  schedule_resumed: 'Kích hoạt lịch',
  schedule_cancelled: 'Hủy lịch',
  session_created: 'Tạo phiên',
  session_started: 'Bắt đầu phiên',
  session_ended: 'Kết thúc phiên',
  stream_started: 'Bắt đầu phát tự động',
  stream_stopped: 'Dừng đẩy hình',
  session_synced: 'Đồng bộ trạng thái phiên',
  session_lock_released: 'Giải phóng khóa phiên',
  pin_changed: 'Đổi sản phẩm ghim',
  cart_changed: 'Đổi giỏ live',
  reply_settings: 'Đổi cấu hình trả lời',
  reply_rule: 'Sửa kịch bản trả lời',
  comment_posted: 'Trả lời bình luận thủ công',
  login: 'Đăng nhập',
  login_failed: 'Đăng nhập sai',
  logout: 'Đăng xuất',
  password_changed: 'Đổi mật khẩu',
  account_created: 'Tạo tài khoản',
  account_updated: 'Sửa tài khoản',
  account_locked: 'Khóa tài khoản',
  account_unlocked: 'Mở khóa tài khoản',
  account_deleted: 'Xóa tài khoản',
  password_reset: 'Đặt lại mật khẩu',
  role_changed: 'Đổi vai trò',
  shops_assigned: 'Đổi shop được giao',
  shop_limit_set: 'Đổi giới hạn shop',
  account_expiry_set: 'Gia hạn tài khoản',
  server_created: 'Thêm máy chủ',
  server_updated: 'Sửa máy chủ',
  server_key_rotated: 'Cấp lại khóa máy chủ',
  server_key_revoked: 'Thu hồi khóa máy chủ',
  server_deleted: 'Xóa máy chủ',
  system_frozen: 'Đóng băng hệ thống',
  system_unfrozen: 'Mở băng hệ thống',
  settings_updated: 'Đổi cấu hình hệ thống',
  legacy_import: 'Nhập dữ liệu từ hệ thống cũ',
};

export const REPLY_STATUS_LABELS = { posted: 'Đã đăng', skipped: 'Bỏ qua', blocked: 'Bị chặn', failed: 'Gửi lỗi', pending: 'Chờ duyệt' } as const;
export const REPLY_SOURCE_LABELS = { rule: 'Kịch bản', ai: 'AI', manual: 'Thủ công' } as const;

export const SERVER_STATE_LABELS: Record<string, string> = {
  online: 'Đang kết nối',
  lost: 'Mất kết nối',
  rejected: 'Bị từ chối',
  pending: 'Chưa chạy',
  suspended: 'Tạm ngưng',
  revoked: 'Đã thu hồi khóa',
  key_expired: 'Khóa hết hạn',
};

export const LIMITS = {
  coverMaxBytes: 2 * 1024 * 1024,
  cartMaxDefault: 100,
  pasteMaxItems: 1000,
  ruleKeywordsMax: 20,
  ruleAnswerMax: 300,
  rulesPerShopMax: 200,
  templateVideosMax: 200,
  videoNameMax: 120,
  uploadChunkBytes: 8 * 1024 * 1024,
  replyLogRetentionDays: 30,
} as const;

/** Bỏ dấu tiếng Việt để tìm kiếm không dấu */
export function foldVi(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export const VN_OFFSET_MINUTES = 7 * 60;

/** Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD) */
export function vnDate(d: Date = new Date()): string {
  return new Date(d.getTime() + VN_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

/** Ghép ngày + giờ VN thành Date (UTC) */
export function vnDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? time + ':00' : time}+07:00`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / 86400000);
}

export type Signal = 'ok' | 'attn' | 'off';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; ref?: string };
}
