import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { settings } from '../db/schema.js';

export interface AiSettings {
  baseUrl: string;
  apiKeyEnc: string | null;
  keyHint: string | null;
  model: string;
  temperature: number;
  globalContext: string;
  models: string[];
}

export interface FreezeState {
  frozen: boolean;
  reason: string | null;
  at: string | null;
  by: string | null;
}

export interface SystemLimits {
  maxActiveSchedulesPerShop: number;
  scheduleDaysAhead: number;
  scheduleStartGraceMin: number;
  defaultShopLimit: number;
  defaultConcurrentLimit: number;
  defaultStorageQuotaGb: number;
  liveCutGraceMin: number;
  stuckAfterMin: number;
  apiLogRetentionDays: number;
  commentRetentionDays: number;
  feedStartDelaySec: number;
  serviceExpiringDays: number;
  authExpiringDays: number;
}

const DEFAULTS = {
  ai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnc: null,
    keyHint: null,
    model: 'gpt-4o-mini',
    temperature: 0.4,
    globalContext:
      'Chỉ tư vấn sản phẩm và hướng dẫn khách đặt mua trực tiếp trên livestream Shopee. Không điều hướng sang nền tảng khác, không xin số điện thoại hay thông tin cá nhân, không nói giá cụ thể. Trả lời ngắn gọn, lịch sự, mời khách bấm giỏ hàng hoặc sản phẩm đang ghim.',
    models: [],
  } as AiSettings,
  freeze: { frozen: false, reason: null, at: null, by: null } as FreezeState,
  limits: {
    maxActiveSchedulesPerShop: 10,
    scheduleDaysAhead: 30,
    scheduleStartGraceMin: 10,
    defaultShopLimit: 10,
    defaultConcurrentLimit: 10,
    defaultStorageQuotaGb: 50,
    liveCutGraceMin: 30,
    stuckAfterMin: 10,
    apiLogRetentionDays: 14,
    commentRetentionDays: 7,
    feedStartDelaySec: 6,
    serviceExpiringDays: 7,
    authExpiringDays: 14,
  } as SystemLimits,
};

type Keys = keyof typeof DEFAULTS;
type ValueOf<K extends Keys> = (typeof DEFAULTS)[K];

const cache = new Map<string, unknown>();

export async function getSetting<K extends Keys>(key: K): Promise<ValueOf<K>> {
  if (cache.has(key)) return cache.get(key) as ValueOf<K>;
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const value = { ...(DEFAULTS[key] as object), ...((row?.value as object) ?? {}) } as ValueOf<K>;
  cache.set(key, value);
  return value;
}

export async function setSetting<K extends Keys>(key: K, patch: Partial<ValueOf<K>>): Promise<ValueOf<K>> {
  const current = await getSetting(key);
  const next = { ...(current as object), ...(patch as object) } as ValueOf<K>;
  await db
    .insert(settings)
    .values({ key, value: next as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: next as object, updatedAt: new Date() } });
  cache.set(key, next);
  return next;
}

export async function isFrozen(): Promise<boolean> {
  return (await getSetting('freeze')).frozen;
}

export function invalidateSettingsCache(): void {
  cache.clear();
}
