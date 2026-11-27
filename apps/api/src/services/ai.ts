import { env } from '../env.js';
import { decrypt } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import { getSetting } from './settings.js';

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|.*\.local$|.*\.internal$)/i;

export function validateAiBaseUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw err.badRequest('ai_bad_url', 'Base URL không hợp lệ');
  }
  if (!env.aiAllowPrivateHosts) {
    if (u.protocol !== 'https:') throw err.badRequest('ai_insecure_url', 'Base URL phải dùng HTTPS');
    if (PRIVATE_HOST.test(u.hostname)) throw err.badRequest('ai_private_host', 'Không cho phép địa chỉ nội bộ (bật API_AI_ALLOW_PRIVATE_HOSTS nếu cần)');
  }
}

export interface AiReplyInput {
  comment: string;
  shopName: string;
  shopContext: string;
  pinnedProduct?: { name: string; sku: string | null; stock: number | null } | null;
  cartProducts?: string[];
}

const RULES = `Quy tắc bắt buộc:
- Trả lời tối đa 2 câu ngắn, tiếng Việt, xưng "shop", gọi khách là "bạn".
- Không nêu giá tiền cụ thể, không gửi link, số điện thoại hay kênh liên hệ ngoài Shopee.
- Không nhắc tới sàn khác. Không hứa khuyến mãi nếu thông tin shop không ghi rõ.
- Khi khách hỏi cách mua: mời bấm giỏ hàng hoặc sản phẩm đang ghim trên live.
- Nếu không đủ thông tin để trả lời chính xác, hoặc là khiếu nại/đơn hàng cụ thể cần nhân viên: trả lời đúng một từ HANDOFF.
- Nếu bình luận không phải câu hỏi (khen, chào, spam): trả lời đúng một từ SKIP.`;

export async function aiReply(input: AiReplyInput): Promise<{ answer: string | null; action: 'reply' | 'handoff' | 'skip'; latencyMs: number }> {
  const cfg = await getSetting('ai');
  const key = decrypt(cfg.apiKeyEnc);
  if (!key) throw err.badRequest('ai_not_configured', 'Chưa cấu hình khóa API AI');
  const system = [
    cfg.globalContext.trim(),
    `Shop: ${input.shopName}.`,
    input.shopContext.trim() ? `Thông tin riêng của shop:\n${input.shopContext.trim()}` : '',
    input.pinnedProduct
      ? `Sản phẩm đang ghim: ${input.pinnedProduct.name}${input.pinnedProduct.stock !== null ? ` (tồn kho: ${input.pinnedProduct.stock > 0 ? 'còn hàng' : 'hết hàng'})` : ''}.`
      : '',
    input.cartProducts?.length ? `Một số sản phẩm trong giỏ live: ${input.cartProducts.slice(0, 15).join('; ')}.` : '',
    RULES,
  ]
    .filter(Boolean)
    .join('\n\n');
  const t0 = Date.now();
  const res = await chat(cfg.baseUrl, key, cfg.model, cfg.temperature, system, input.comment, 15000);
  const latencyMs = Date.now() - t0;
  const text = res.trim().replace(/^["“]|["”]$/g, '');
  if (/^HANDOFF\b/i.test(text)) return { answer: null, action: 'handoff', latencyMs };
  if (/^SKIP\b/i.test(text) || !text) return { answer: null, action: 'skip', latencyMs };
  return { answer: text, action: 'reply', latencyMs };
}

export async function chat(baseUrl: string, key: string, model: string, temperature: number, system: string, user: string, timeoutMs = 15000): Promise<string> {
  validateAiBaseUrl(baseUrl);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: 160,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw err.badRequest('ai_http_error', `AI trả lỗi ${res.status}: ${body?.error?.message ?? ''}`.slice(0, 300));
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw err.badRequest('ai_bad_response', 'AI trả về dữ liệu không hợp lệ');
    return content;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw err.badRequest('ai_timeout', 'AI không phản hồi (quá 15 giây)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels(baseUrl: string, key: string): Promise<string[]> {
  validateAiBaseUrl(baseUrl);
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw err.badRequest('ai_http_error', `Không tải được danh sách model (${res.status})`);
  const body: any = await res.json();
  return ((body?.data ?? []) as any[]).map((m) => String(m.id)).sort();
}
