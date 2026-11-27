/**
 * Tạo / đặt lại tài khoản quản trị hệ thống từ dòng lệnh (khi quên mật khẩu hoặc mất quyền).
 *   pnpm create-admin <username> [tên hiển thị]
 */
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, initDb } from '../db/client.js';
import { accounts, activityLogs } from '../db/schema.js';
import { hashPassword, tempPassword } from '../lib/crypto.js';

async function main() {
  const [username, ...nameParts] = process.argv.slice(2);
  if (!username) {
    console.error('Cách dùng: pnpm create-admin <username> [tên hiển thị]');
    process.exit(1);
  }
  await initDb();
  const pwd = tempPassword();
  const [exists] = await db.select().from(accounts).where(eq(sql`lower(${accounts.username})`, username.toLowerCase()));
  if (exists) {
    await db.update(accounts).set({ passwordHash: hashPassword(pwd), role: 'sysadmin', status: 'active', mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(accounts.id, exists.id));
    await db.insert(activityLogs).values({ actorName: 'Dòng lệnh', code: 'password_reset', targetAccountId: exists.id, params: { cli: true } });
    console.log(`Đã đặt lại "${username}" thành quản trị hệ thống.`);
  } else {
    const [row] = await db.insert(accounts).values({ username, name: nameParts.join(' ') || username, role: 'sysadmin', passwordHash: hashPassword(pwd), mustChangePassword: true }).returning();
    await db.insert(activityLogs).values({ actorName: 'Dòng lệnh', code: 'account_created', targetAccountId: row!.id, params: { cli: true, role: 'sysadmin' } });
    console.log(`Đã tạo quản trị hệ thống "${username}".`);
  }
  console.log(`Mật khẩu tạm (hiện một lần): ${pwd}`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
