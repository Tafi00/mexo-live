import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { env } from '../env.js';
import { db } from '../db/client.js';
import { accounts } from '../db/schema.js';
import { hashPassword } from '../lib/crypto.js';

/**
 * Lần chạy đầu (chưa có tài khoản nào): tạo tài khoản quản trị hệ thống mặc định.
 * Tên đăng nhập/mật khẩu lấy từ BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD (mặc định admin / ChangeMe@2026).
 * Bắt buộc đổi mật khẩu ở lần đăng nhập đầu.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(accounts);
  if (Number(r?.n ?? 0) > 0) return;
  const username = process.env.BOOTSTRAP_ADMIN_USER || 'admin';
  // Production không dùng mật khẩu mặc định ai cũng biết: thiếu BOOTSTRAP_ADMIN_PASSWORD thì sinh ngẫu nhiên và in ra log 1 lần
  const generated = !process.env.BOOTSTRAP_ADMIN_PASSWORD && env.isProd ? randomBytes(12).toString('base64url') : '';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || generated || 'ChangeMe@2026';
  await db.insert(accounts).values({ username, name: 'Quản trị hệ thống', role: 'sysadmin', passwordHash: hashPassword(password), mustChangePassword: true });
  console.log(`\n  [bootstrap] Đã tạo tài khoản quản trị hệ thống "${username}" (bắt buộc đổi mật khẩu khi đăng nhập lần đầu)`);
  if (generated) console.log(`  [bootstrap] Mật khẩu tạm (chỉ hiện 1 lần): ${generated}`);
  console.log('');
}
