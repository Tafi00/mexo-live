import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

const cwd = process.cwd();
for (const p of [path.join(cwd, '.env'), path.join(cwd, '../../.env')]) {
  if (fs.existsSync(p)) loadEnv({ path: p, override: false });
}

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' && process.env[name] !== undefined ? v : fallback;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const isProd = str('NODE_ENV') === 'production';

export const env = {
  isProd,
  port: num('PORT', 4000),
  host: str('HOST', '0.0.0.0'),
  databaseUrl: str('DATABASE_URL'),
  dataDir: path.resolve(cwd, str('DATA_DIR', './data')),
  storageDir: path.resolve(cwd, str('STORAGE_DIR', './storage')),
  appSecret: str('APP_SECRET', 'dev-only-secret-change-me-in-production-please'),
  /** Địa chỉ web (dùng cho redirect OAuth, kiểm tra Origin) */
  publicUrl: str('PUBLIC_URL', 'http://localhost:5173').replace(/\/$/, ''),
  /** Địa chỉ API mà máy phát và Shopee redirect gọi tới */
  apiPublicUrl: str('API_PUBLIC_URL', 'http://localhost:4000').replace(/\/$/, ''),
  serveWeb: bool('SERVE_WEB', isProd),
  webDist: path.resolve(cwd, str('WEB_DIST', '../web/dist')),
  shopee: {
    mode: str('SHOPEE_MODE', 'mock') as 'mock' | 'sandbox' | 'live',
    partnerId: num('SHOPEE_PARTNER_ID', 0),
    partnerKey: str('SHOPEE_PARTNER_KEY'),
    redirectUrl: str('SHOPEE_REDIRECT_URL', ''),
    timeoutMs: num('SHOPEE_TIMEOUT_MS', 15000),
  },
  expectedEgressIp: str('EXPECTED_EGRESS_IP'),
  streamerMinVersion: str('STREAMER_MIN_VERSION', '1.0.0'),
  streamerLostAfterSec: num('STREAMER_LOST_AFTER_SEC', 30),
  aiAllowPrivateHosts: bool('API_AI_ALLOW_PRIVATE_HOSTS', false),
  jobsEnabled: bool('JOBS_ENABLED', true),
  cookieSecure: bool('COOKIE_SECURE', isProd),
  sessionTtlDays: num('SESSION_TTL_DAYS', 14),
  instanceId: str('INSTANCE_ID', `api-${process.pid}`),
};

if (isProd && env.appSecret.startsWith('dev-only')) {
  // eslint-disable-next-line no-console
  console.error('[FATAL] APP_SECRET chưa được đặt cho môi trường production.');
  process.exit(1);
}

export const shopeeHost =
  env.shopee.mode === 'live'
    ? 'https://partner.shopeemobile.com'
    : env.shopee.mode === 'sandbox'
      ? 'https://partner.test-stable.shopeemobile.com'
      : env.apiPublicUrl + '/api/mock-shopee';

export function shopeeRedirectUrl(): string {
  return env.shopee.redirectUrl || `${env.publicUrl}/connect/callback`;
}
