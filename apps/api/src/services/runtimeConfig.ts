/**
 * CẤU HÌNH ĐỘNG — nhập trực tiếp trên web (Cấu hình hệ thống → Kết nối & tích hợp).
 * Giá trị lưu trong bảng settings (khóa bí mật mã hóa AES-256-GCM bằng APP_SECRET),
 * không nhập thì dùng giá trị trong .env làm mặc định. Đổi xong có hiệu lực ngay, không cần khởi động lại.
 *
 * Không đưa lên web: APP_SECRET (khóa gốc để mã hóa các bí mật khác) và DATABASE_URL (cần trước khi có DB).
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { settings } from '../db/schema.js';
import { env } from '../env.js';
import { decrypt, encrypt } from '../lib/crypto.js';

export type ShopeeMode = 'mock' | 'sandbox' | 'live';

export interface IntegrationConfig {
  shopeeMode: ShopeeMode;
  partnerId: number;
  partnerKey: string;
  redirectUrl: string;
  timeoutMs: number;
  expectedEgressIp: string;
  apiPublicUrl: string;
  streamerMinVersion: string;
  streamerLostAfterSec: number;
  aiAllowPrivateHosts: boolean;
}

/** Giá trị lưu trong DB (chỉ các trường đã đặt trên web) */
interface Stored {
  shopeeMode?: ShopeeMode;
  partnerId?: number;
  partnerKeyEnc?: string | null;
  partnerKeyHint?: string | null;
  redirectUrl?: string;
  timeoutMs?: number;
  expectedEgressIp?: string;
  apiPublicUrl?: string;
  streamerMinVersion?: string;
  streamerLostAfterSec?: number;
  aiAllowPrivateHosts?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

const KEY = 'integrations';

function fromEnv(): IntegrationConfig {
  return {
    shopeeMode: env.shopee.mode,
    partnerId: env.shopee.partnerId,
    partnerKey: env.shopee.partnerKey,
    redirectUrl: env.shopee.redirectUrl,
    timeoutMs: env.shopee.timeoutMs,
    expectedEgressIp: env.expectedEgressIp,
    apiPublicUrl: env.apiPublicUrl,
    streamerMinVersion: env.streamerMinVersion,
    streamerLostAfterSec: env.streamerLostAfterSec,
    aiAllowPrivateHosts: env.aiAllowPrivateHosts,
  };
}

let stored: Stored = {};
let current: IntegrationConfig = fromEnv();

function compute(s: Stored): IntegrationConfig {
  const base = fromEnv();
  const key = s.partnerKeyEnc ? decrypt(s.partnerKeyEnc) : null;
  return {
    shopeeMode: s.shopeeMode ?? base.shopeeMode,
    partnerId: s.partnerId ?? base.partnerId,
    partnerKey: key ?? base.partnerKey,
    redirectUrl: s.redirectUrl ?? base.redirectUrl,
    timeoutMs: s.timeoutMs ?? base.timeoutMs,
    expectedEgressIp: s.expectedEgressIp ?? base.expectedEgressIp,
    apiPublicUrl: (s.apiPublicUrl || base.apiPublicUrl).replace(/\/$/, ''),
    streamerMinVersion: s.streamerMinVersion ?? base.streamerMinVersion,
    streamerLostAfterSec: s.streamerLostAfterSec ?? base.streamerLostAfterSec,
    aiAllowPrivateHosts: s.aiAllowPrivateHosts ?? base.aiAllowPrivateHosts,
  };
}

/** Nạp cấu hình đã lưu (gọi sau khi khởi tạo DB) */
export async function loadRuntimeConfig(): Promise<void> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  stored = (row?.value as Stored) ?? {};
  current = compute(stored);
}

/** Cấu hình đang có hiệu lực (đồng bộ, dùng ở mọi nơi gọi Shopee / máy phát) */
export function rc(): IntegrationConfig {
  return current;
}

/** Địa chỉ server gọi Shopee. Giả lập chạy ngay trong tiến trình API → gọi loopback, không vòng qua domain / proxy HTTPS */
export function shopeeHost(): string {
  const m = current.shopeeMode;
  return m === 'live' ? 'https://partner.shopeemobile.com' : m === 'sandbox' ? 'https://partner.test-stable.shopeemobile.com' : `http://127.0.0.1:${env.port}/api/mock-shopee`;
}

/** Địa chỉ trang cấp quyền mở trên trình duyệt người dùng (giả lập: qua địa chỉ công khai của API) */
export function shopeeBrowserHost(): string {
  return current.shopeeMode === 'mock' ? current.apiPublicUrl + '/api/mock-shopee' : shopeeHost();
}

export function shopeeRedirectUrl(): string {
  return current.redirectUrl || `${env.publicUrl}/connect/callback`;
}

export type IntegrationPatch = Partial<Omit<IntegrationConfig, 'partnerKey'>> & { partnerKey?: string | null };

/** Lưu thay đổi từ web. partnerKey: chuỗi mới = đặt khóa; null = xóa (quay về .env); undefined = giữ nguyên */
export async function saveRuntimeConfig(patch: IntegrationPatch, by: string): Promise<void> {
  const next: Stored = { ...stored };
  for (const k of ['shopeeMode', 'partnerId', 'redirectUrl', 'timeoutMs', 'expectedEgressIp', 'apiPublicUrl', 'streamerMinVersion', 'streamerLostAfterSec', 'aiAllowPrivateHosts'] as const) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  if (patch.partnerKey === null) {
    next.partnerKeyEnc = null;
    next.partnerKeyHint = null;
  } else if (typeof patch.partnerKey === 'string' && patch.partnerKey.trim()) {
    const k = patch.partnerKey.trim();
    next.partnerKeyEnc = encrypt(k);
    next.partnerKeyHint = `${k.slice(0, 4)}…${k.slice(-4)}`;
  }
  await persist(next, by);
}

async function persist(next: Stored, by: string): Promise<void> {
  next.updatedAt = new Date().toISOString();
  next.updatedBy = by;
  await db
    .insert(settings)
    .values({ key: KEY, value: next as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: next as object, updatedAt: new Date() } });
  stored = next;
  current = compute(stored);
}

/** Xóa giá trị đặt trên web cho các trường → quay về giá trị trong .env */
export async function resetRuntimeFields(fields: (keyof Stored)[], by: string): Promise<void> {
  const next: Stored = { ...stored };
  for (const f of fields) delete next[f];
  if (fields.includes('partnerKeyEnc')) delete next.partnerKeyHint;
  await persist(next, by);
}

/** Thông tin cho giao diện: giá trị hiệu lực + nguồn (web / .env), KHÔNG trả khóa bí mật */
export function describeRuntimeConfig() {
  const base = fromEnv();
  const src = (k: keyof Stored) => (stored[k] !== undefined && stored[k] !== null ? 'web' : 'env');
  return {
    shopee: {
      mode: current.shopeeMode,
      partnerId: current.partnerId || null,
      hasKey: Boolean(current.partnerKey),
      keyHint: stored.partnerKeyHint ?? (base.partnerKey ? `${base.partnerKey.slice(0, 4)}…${base.partnerKey.slice(-4)} (.env)` : null),
      redirectUrl: current.redirectUrl,
      effectiveRedirectUrl: shopeeRedirectUrl(),
      timeoutMs: current.timeoutMs,
      host: current.shopeeMode === 'mock' ? '(giả lập trong API)' : shopeeHost(),
    },
    infra: {
      apiPublicUrl: current.apiPublicUrl,
      expectedEgressIp: current.expectedEgressIp,
      streamerMinVersion: current.streamerMinVersion,
      streamerLostAfterSec: current.streamerLostAfterSec,
      aiAllowPrivateHosts: current.aiAllowPrivateHosts,
      publicUrl: env.publicUrl,
    },
    sources: {
      shopeeMode: src('shopeeMode'),
      partnerId: src('partnerId'),
      partnerKey: src('partnerKeyEnc'),
      redirectUrl: src('redirectUrl'),
      timeoutMs: src('timeoutMs'),
      apiPublicUrl: src('apiPublicUrl'),
      expectedEgressIp: src('expectedEgressIp'),
      streamerMinVersion: src('streamerMinVersion'),
      streamerLostAfterSec: src('streamerLostAfterSec'),
      aiAllowPrivateHosts: src('aiAllowPrivateHosts'),
    },
    updatedAt: stored.updatedAt ?? null,
    updatedBy: stored.updatedBy ?? null,
  };
}
