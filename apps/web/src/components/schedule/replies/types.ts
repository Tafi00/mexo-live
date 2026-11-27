import type { Tone } from '@/components/ui/misc';

export interface ReplyConfig {
  maxPerMinute: number;
  perViewerCooldownSec: number;
  minGapSec: number;
  aiDailyBudget: number;
  maxCommentAgeSec: number;
}

export interface RepliesResp {
  enabled: boolean;
  unmatched: 'none' | 'ai';
  context: string;
  config: ReplyConfig;
  disabledReason: string | null;
  commentPoll: { state: string; reason: string | null; until: string | null; failures: number };
  aiReady: boolean;
  globalContext: string;
  aiUsedToday: number;
  rules: { all: number; on: number };
}

export interface ReplyRule {
  id: number;
  topic: string;
  keywords: string[];
  sample: string;
  answer: string;
  enabled: boolean;
  disabledReason: string | null;
  hits: number;
  updatedAt?: string;
}

export interface RulesResp {
  items: ReplyRule[];
  counts: { all: number; on: number; off: number };
}

export interface TryResult {
  status: 'reply' | 'skip' | 'blocked' | 'handoff';
  source: 'rule' | 'ai' | null;
  answer: string | null;
  ruleId: number | null;
  reason: string | null;
  latencyMs: number;
}

export interface ReplyLogRow {
  id: number;
  at: string;
  comment: string;
  answer: string | null;
  status: string;
  source: string;
  latencyMs: number | null;
  reason: string | null;
  sessionId: number | null;
}

export interface ReplyLogsResp {
  items: ReplyLogRow[];
  total: number;
  page: number;
  pageSize: number;
  last24h: { posted: number; blocked: number; skipped: number; failed: number; avgLatencyMs: number | null };
}

/** Giá trị mặc định của hệ thống (khớp mặc định trong cơ sở dữ liệu) */
export const DEFAULT_REPLY_CONFIG: ReplyConfig = { maxPerMinute: 6, perViewerCooldownSec: 60, minGapSec: 5, aiDailyBudget: 300, maxCommentAgeSec: 120 };

export const CONFIG_FIELDS: { key: keyof ReplyConfig; label: string; hint: string; unit: string; min: number; max: number; short: (v: number) => string }[] = [
  { key: 'maxPerMinute', label: 'Tối đa mỗi phút', hint: 'Số câu trả lời tối đa trong 1 phút của một phiên', unit: 'câu', min: 1, max: 30, short: (v) => `${v} câu/phút` },
  { key: 'minGapSec', label: 'Giãn cách giữa 2 câu', hint: 'Khoảng nghỉ tối thiểu giữa hai câu liên tiếp', unit: 'giây', min: 0, max: 120, short: (v) => `cách ${v} giây` },
  { key: 'perViewerCooldownSec', label: 'Mỗi người xem cách nhau', hint: 'Không trả lời lại cùng một người trong khoảng này', unit: 'giây', min: 0, max: 3600, short: (v) => `mỗi người ${v} giây` },
  { key: 'maxCommentAgeSec', label: 'Bỏ qua bình luận cũ hơn', hint: 'Bình luận quá cũ sẽ không được trả lời nữa', unit: 'giây', min: 10, max: 1800, short: (v) => `bỏ qua sau ${v} giây` },
  { key: 'aiDailyBudget', label: 'Lượt AI mỗi ngày', hint: 'Hết lượt thì chỉ trả lời câu khớp kịch bản', unit: 'lượt', min: 0, max: 10000, short: (v) => `${v} lượt AI/ngày` },
];

export const POLL_STATE: Record<string, { label: string; tone: Tone; description: string }> = {
  normal: { label: 'Bình thường', tone: 'success', description: 'Đọc bình luận mới khoảng 3 giây một lần trong phiên đang live.' },
  backoff: { label: 'Đang giãn nhịp', tone: 'warning', description: 'Shopee phản hồi lỗi hoặc giới hạn tần suất, hệ thống tạm đọc thưa hơn và tự thử lại.' },
  quarantine: { label: 'Tạm cách ly', tone: 'danger', description: 'Lỗi liên tiếp nhiều lần, tạm dừng đọc bình luận vài phút để không bị Shopee chặn.' },
  stopped: { label: 'Đã dừng', tone: 'danger', description: 'Không đọc được bình luận do vấn đề quyền hoặc token. Cần xử lý kết nối shop.' },
};

export const POLL_REASON: Record<string, string> = {
  rate_limit: 'Shopee giới hạn tần suất gọi',
  server: 'Máy chủ Shopee lỗi',
  timeout: 'Shopee phản hồi quá chậm',
  network: 'Lỗi mạng khi gọi Shopee',
  circuit_open: 'Tạm ngắt do Shopee lỗi nhiều lần',
  token: 'Token Shopee hết hiệu lực — cần cấp quyền lại',
  permission: 'Shop chưa cấp quyền đọc bình luận livestream',
  error: 'Lỗi không xác định khi đọc bình luận',
  unknown: 'Lỗi không xác định khi đọc bình luận',
};

export const LOG_STATUS_TONE: Record<string, Tone> = { posted: 'success', skipped: 'muted', blocked: 'warning', failed: 'danger', pending: 'info' };
export const LOG_SOURCE_TONE: Record<string, Tone> = { rule: 'info', ai: 'violet', manual: 'neutral' };

export function fmtLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giây`;
}
