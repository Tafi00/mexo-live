import { sql } from 'drizzle-orm';
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
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe@2026';
  await db.insert(accounts).values({ username, name: 'Quản trị hệ thống', role: 'sysadmin', passwordHash: hashPassword(password), mustChangePassword: true });
  console.log(`\n  [bootstrap] Đã tạo tài khoản quản trị hệ thống "${username}" (bắt buộc đổi mật khẩu khi đăng nhập lần đầu)\n`);
}
