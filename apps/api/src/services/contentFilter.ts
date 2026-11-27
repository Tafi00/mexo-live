import { foldVi } from '@mexo/shared';

/**
 * Lớp lọc nội dung — áp cho MỌI câu đăng lên live (kịch bản, AI, thủ công có cảnh báo).
 * Chặn: link, số điện thoại, kênh liên hệ ngoài Shopee, nhắc giá, nhắc sàn khác,
 * lời lẽ xúc phạm, khuyến mãi chưa xác nhận.
 */
export type FilterReason = 'link' | 'phone' | 'external_contact' | 'price' | 'other_platform' | 'offensive' | 'unverified_promo' | 'too_long' | 'empty';

export const FILTER_REASON_LABELS: Record<FilterReason, string> = {
  link: 'Chứa đường link',
  phone: 'Chứa số điện thoại',
  external_contact: 'Điều hướng liên hệ ngoài Shopee',
  price: 'Nhắc giá (trong live không nói giá)',
  other_platform: 'Nhắc sàn hoặc bên thứ ba',
  offensive: 'Lời lẽ xúc phạm',
  unverified_promo: 'Khuyến mãi chưa được xác nhận',
  too_long: 'Câu trả lời quá dài',
  empty: 'Câu trả lời rỗng',
};

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|vn|net|org|me|io|ly|link|shop|store|xyz)\b)/i;
const PHONE = /(\+?84|0)[\s.-]?(\d[\s.-]?){8,10}\b/;
const EXTERNAL = /\b(zalo|zl|facebook|fb|face|messenger|mess|telegram|tele|viber|instagram|insta|ig|whatsapp|wechat|inbox|ib|nhan tin rieng|chat rieng|ket ban|add friend|lien he qua|goi cho)\b/;
const HANDLE = /(^|\s)@[a-z0-9_.]{3,}/i;
const PRICE = /(\b\d{1,3}([.,]\d{3})+\s*(d|đ|vnd|dong)?\b|\b\d+\s*(k|nghin|ngan|trieu|tr|cu|d|đ|vnd|dong)\b|\bgia\s*(chi|chỉ|là|la|:)?\s*\d)/i;
const PLATFORM = /\b(lazada|tiktok|tiki|sendo|amazon|alibaba|taobao|1688|website|web shop|ngoai san)\b/;
// So khớp trên chữ CÓ DẤU để tránh nhầm "lớn", "các", "ngủ"...
const OFFENSIVE = /(^|[^\p{L}\p{N}])(đm|đmm|dcm|đcm|vcl|vkl|clm|cmm|ngu|óc chó|đồ ngu|cút|đéo|địt|lồn|cặc|thằng chó|con chó|mẹ mày|bố mày)(?=$|[^\p{L}\p{N}])/iu;
const PROMO = /\b(giam\s*\d+\s*%|sale\s*\d+\s*%|tang kem|mua\s*\d+\s*tang\s*\d+|freeship|mien phi van chuyen|voucher\s*\d+|ma giam gia)\b/;

export function checkContent(text: string, opts: { allowPromo?: boolean; maxLen?: number } = {}): { ok: boolean; reasons: FilterReason[] } {
  const reasons: FilterReason[] = [];
  const raw = text.trim();
  if (!raw) return { ok: false, reasons: ['empty'] };
  const f = foldVi(raw);
  if (raw.length > (opts.maxLen ?? 300)) reasons.push('too_long');
  if (LINK.test(raw)) reasons.push('link');
  if (PHONE.test(raw.replace(/[()]/g, ''))) reasons.push('phone');
  if (EXTERNAL.test(f) || HANDLE.test(raw)) reasons.push('external_contact');
  if (PRICE.test(f)) reasons.push('price');
  if (PLATFORM.test(f)) reasons.push('other_platform');
  if (OFFENSIVE.test(raw.normalize('NFC').toLowerCase())) reasons.push('offensive');
  if (!opts.allowPromo && PROMO.test(f)) reasons.push('unverified_promo');
  return { ok: reasons.length === 0, reasons };
}

/** Khớp từ khóa (có dấu và không dấu) */
export function matchKeywords(comment: string, keywords: string[]): number {
  const c = ` ${foldVi(comment).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  let hits = 0;
  for (const k of keywords) {
    const fk = foldVi(k).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (fk && c.includes(` ${fk} `)) hits++;
  }
  return hits;
}
