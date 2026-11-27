import crypto from 'node:crypto';
import { env } from '../env.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64!, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

const encKey = crypto.createHash('sha256').update('mexo-enc:' + env.appSecret).digest();

/** Mã hóa AES-256-GCM cho token Shopee, khóa API, URL đẩy luồng */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [v, ivB64, tagB64, dataB64] = payload.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Mật khẩu tạm dễ đọc (bỏ ký tự dễ nhầm) */
export function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function refCode(): string {
  return 'E' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

export function hmacSha256Hex(key: string, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

const COMMON = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', '11111111', '00000000', '88888888',
  'abc12345', 'iloveyou', 'admin123', 'matkhau123', 'shopee123', 'mexo1234', '12341234', 'qwertyui', '123123123',
]);

/** Kiểm tra mật khẩu mới theo quy tắc hệ thống; trả về mã lỗi hoặc null */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < 8) return 'password_too_short';
  if (password.length > 128) return 'password_too_long';
  if (COMMON.has(password.toLowerCase())) return 'password_too_common';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'password_contains_username';
  if (/^(.)\1+$/.test(password)) return 'password_too_common';
  return null;
}
