import { foldVi, LIMITS } from '@mexo/shared';

/** Lý do video lỗi / chưa dùng được (failReason từ máy chủ) */
export const VIDEO_FAIL_REASONS: Record<string, string> = {
  bad_format: 'File không phải video hoặc định dạng không hỗ trợ (dùng MP4, MOV, MKV, WEBM, FLV, TS).',
  corrupt: 'File video bị hỏng, hệ thống không đọc được nội dung.',
  no_video_stream: 'File không có hình (chỉ có âm thanh).',
  too_short: 'Video quá ngắn (dưới 1 giây).',
  stale_upload: 'Tải dở quá 24 giờ nên phần đã tải bị dọn. Chọn lại file để tải lại từ đầu.',
  legacy_no_file: 'Nhập từ hệ thống cũ, chưa có file. Tải lại đúng file gốc (cùng tên, cùng dung lượng) để gắn lại.',
  size_mismatch: 'Dung lượng nhận được lệch so với file khai báo.',
};

export function videoFailText(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return VIDEO_FAIL_REASONS[reason] ?? `Lỗi xử lý video (${reason}).`;
}

/** Mã lỗi đồng bộ sản phẩm (ShopeeError.kind) */
export const SYNC_ERRORS: Record<string, string> = {
  auth: 'Token Shopee hết hạn hoặc không hợp lệ — cần cấp quyền lại cho shop.',
  permission: 'Ứng dụng không có quyền đọc sản phẩm của shop này.',
  rate_limit: 'Shopee đang giới hạn tần suất gọi. Thử lại sau vài phút.',
  server: 'Máy chủ Shopee đang lỗi. Thử lại sau.',
  timeout: 'Shopee phản hồi quá chậm. Thử lại sau.',
  network: 'Lỗi mạng khi kết nối tới Shopee.',
  circuit_open: 'Tạm ngưng gọi Shopee do lỗi liên tiếp, hệ thống sẽ tự thử lại sau.',
  not_configured: 'Chưa cấu hình ứng dụng Shopee trên hệ thống.',
  bad_request: 'Shopee từ chối yêu cầu (tham số không hợp lệ).',
  internal: 'Lỗi hệ thống khi lưu danh mục.',
};

export const REPLY_MODE_LABELS: Record<'inherit' | 'on' | 'off', string> = {
  inherit: 'Theo cài đặt shop',
  on: 'Luôn bật trả lời',
  off: 'Tắt trả lời',
};

export const VIDEO_EXT_RE = /\.(mp4|mov|m4v|mkv|webm|flv|ts)$/i;
export const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.m4v,.mkv,.webm,.flv,.ts';
export const MAX_VIDEO_BYTES = 4 * 1024 ** 3;

export function fmtResolution(w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h) return '—';
  const p = Math.min(w, h);
  const tag = p >= 2160 ? '4K' : p >= 1440 ? '2K' : p >= 1080 ? '1080p' : p >= 720 ? '720p' : p >= 480 ? '480p' : `${p}p`;
  return `${w}×${h} · ${tag}${h > w ? ' dọc' : ''}`;
}

/** Quy tắc tên video (khớp máy chủ): không trống, ≤120 ký tự, không < > |, không kết thúc bằng dấu chấm, không trùng */
export function validateVideoName(name: string, others: { id: number; name: string }[], selfId?: number): string | null {
  const s = name.trim();
  if (!s) return 'Tên video không được để trống';
  if (s.length > LIMITS.videoNameMax) return `Tên tối đa ${LIMITS.videoNameMax} ký tự (hiện ${s.length})`;
  if (/[<>|]/.test(s)) return 'Tên không được chứa ký tự < > |';
  if (s.endsWith('.')) return 'Tên không được kết thúc bằng dấu chấm';
  const lower = s.toLowerCase();
  if (others.some((v) => v.id !== selfId && v.name.toLowerCase() === lower)) return 'Đã có video khác trùng tên trong shop';
  return null;
}

export function matchText(q: string, ...fields: (string | number | null | undefined)[]): boolean {
  const f = foldVi(q);
  if (!f) return true;
  return fields.some((x) => x !== null && x !== undefined && foldVi(String(x)).includes(f));
}
