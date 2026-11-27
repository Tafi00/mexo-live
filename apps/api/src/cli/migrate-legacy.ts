/**
 * NHẬP DỮ LIỆU TỪ HỆ THỐNG CŨ (live.mexo.vn) — file backup JSON.
 *
 *   pnpm migrate:legacy [đường-dẫn-backup.json] [--dry-run]
 *
 * Chạy lại an toàn: bản ghi đã nhập (theo Shop ID Shopee / legacy id) sẽ được bỏ qua.
 * Những phần KHÔNG có trong backup (token Shopee, file video, mật khẩu, khóa AI, khóa máy chủ) phải làm lại — xem báo cáo sau khi chạy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { foldVi, vnDate } from '@mexo/shared';
import { env } from '../env.js';
import { closeDb, db, initDb } from '../db/client.js';
import { accounts, activityLogs, liveSessions, products, schedules, servers, shopNameHistory, shops, templateItems, templates, videos } from '../db/schema.js';
import { hashPassword, tempPassword } from '../lib/crypto.js';
import { setSetting } from '../services/settings.js';
import { ensureBootstrapAdmin } from './bootstrap.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args.find((a) => !a.startsWith('--'));
const file = path.resolve(process.cwd(), fileArg ?? '../../mexo-live-backup.json');

type Any = any;
const ok = (x: Any) => x && x.status === 200 ? x.data : null;

function log(msg: string) {
  console.log(msg);
}

async function main() {
  if (!fs.existsSync(file)) {
    console.error(`Không tìm thấy file backup: ${file}`);
    process.exit(1);
  }
  log(`Đọc backup: ${file}`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8')) as Any;
  log(`  Xuất lúc: ${d.exportedAt} — nguồn: ${d.source}`);
  const shopList: Any[] = d.shops ?? ok(d.global['/api/shops'])?.items ?? [];
  const details: Record<string, Any> = d.shopDetails ?? {};

  const report: string[] = [];
  const warnings: string[] = [];
  const stats = { accounts: 0, servers: 0, shops: 0, shopsSkipped: 0, products: 0, videos: 0, templates: 0, templateItems: 0, schedules: 0, history: 0, openSessions: 0, activity: 0, names: 0 };

  if (dryRun) {
    let p = 0, v = 0, t = 0, h = 0, a = 0;
    for (const s of shopList) {
      const sd = details[s.id] ?? {};
      p += ok(sd.products)?.items?.length ?? 0;
      v += ok(sd.videos)?.items?.length ?? 0;
      t += ok(sd.templates)?.items?.length ?? 0;
      h += ok(sd.history)?.items?.length ?? 0;
      a += ok(sd.activity)?.items?.length ?? 0;
    }
    log(`\n[DRY RUN] Sẽ nhập: ${shopList.length} shop, ${p} sản phẩm, ${v} video, ${t} mẫu phát, ${h} phiên lịch sử, ${a} nhật ký, ${ok(d.global['/api/accounts'])?.items?.length ?? 0} tài khoản, ${ok(d.global['/api/servers'])?.items?.length ?? 0} máy chủ.`);
    return;
  }

  await initDb();
  await ensureBootstrapAdmin();
  const started = Date.now();

  // ───── Tài khoản ─────
  const accountMap = new Map<string, number>(); // tên hiển thị → id (để gắn nhật ký)
  const passwords: { username: string; role: string; password: string }[] = [];
  for (const acc of ok(d.global['/api/accounts'])?.items ?? []) {
    const [exists] = await db.select().from(accounts).where(eq(sql`lower(${accounts.username})`, String(acc.username).toLowerCase()));
    if (exists) {
      accountMap.set(acc.name, exists.id);
      warnings.push(`Tài khoản "${acc.username}" đã tồn tại — bỏ qua.`);
      continue;
    }
    const pwd = tempPassword();
    const role = acc.role === 'sysadmin' ? 'sysadmin' : acc.role === 'owner' ? 'owner' : 'admin';
    const [row] = await db
      .insert(accounts)
      .values({
        username: acc.username,
        name: acc.name,
        role,
        status: acc.status === 'active' ? 'active' : 'locked',
        passwordHash: hashPassword(pwd),
        mustChangePassword: true,
        shopLimit: role === 'owner' ? (acc.shopLimit ?? 1) : null,
        concurrentLimit: role === 'owner' ? 10 : null,
        serviceExpiresOn: role === 'owner' ? acc.serviceExpiresOn ?? null : null,
        lastLoginAt: acc.lastLoginAt ? new Date(acc.lastLoginAt) : null,
        createdAt: acc.createdAt ? new Date(acc.createdAt) : new Date(),
        note: 'Nhập từ hệ thống cũ',
      })
      .returning();
    accountMap.set(acc.name, row!.id);
    passwords.push({ username: acc.username, role, password: pwd });
    stats.accounts++;
  }

  // ───── Máy chủ phát (khóa cũ không xuất được → cần cấp khóa mới) ─────
  for (const s of ok(d.global['/api/servers'])?.items ?? []) {
    const [exists] = await db.select().from(servers).where(eq(servers.name, s.name));
    if (exists) continue;
    await db.insert(servers).values({
      name: s.name,
      keyState: 'revoked',
      keyHash: null,
      maxStreams: s.maxStreams ?? 0,
      version: s.version ?? null,
      note: 'Nhập từ hệ thống cũ — bấm "Cấp lại khóa" rồi cài MexoStreamer mới với khóa đó',
      createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
    });
    stats.servers++;
  }

  // ───── Cấu hình AI (không có khóa API) ─────
  const ai = ok(d.global['/api/settings/ai']);
  if (ai) {
    await setSetting('ai', { baseUrl: ai.baseUrl, model: ai.model, temperature: ai.temperature, globalContext: ai.globalContext ?? '', models: ai.models ?? [] });
  }

  // ───── Shop & dữ liệu theo shop ─────
  let idx = 0;
  for (const s of shopList) {
    idx++;
    const shopeeShopId = Number(s.shopeeId ?? s.id);
    const sd = details[s.id] ?? {};
    const [exists] = await db.select().from(shops).where(eq(shops.shopeeShopId, shopeeShopId));
    if (exists) {
      stats.shopsSkipped++;
      continue;
    }
    const replies = ok(sd.replies);
    const prod = ok(sd.products);
    const alias = s.alias && s.alias !== s.shopeeName ? s.alias : null;
    const [shop] = await db
      .insert(shops)
      .values({
        number: s.number ?? idx,
        shopeeShopId,
        shopeeName: s.shopeeName ?? '',
        alias,
        searchText: foldVi(`${alias ?? ''} ${s.shopeeName ?? ''} ${shopeeShopId}`),
        serviceExpiresOn: s.serviceExpiresOn ?? null,
        authExpiresAt: s.authExpiresAt ? new Date(s.authExpiresAt) : null,
        connection: 'needs_reauth',
        connectionError: 'Nhập từ hệ thống cũ: cần chủ shop cấp quyền cho ứng dụng mới',
        replyEnabled: false, // tắt để không trả lời trùng với hệ thống cũ trong giai đoạn chuyển đổi
        replyUnmatched: replies?.unmatched === 'live' ? 'ai' : 'none',
        replyContext: replies?.context ?? '',
        productSync: prod?.sync
          ? { status: prod.sync.status === 'done' ? 'done' : 'never', loaded: prod.sync.loaded ?? 0, total: prod.sync.total ?? 0, syncedAt: prod.sync.syncedAt ?? null, errorCode: null }
          : { status: 'never', loaded: 0, total: 0, syncedAt: null, errorCode: null },
        legacyId: String(s.id),
        // Hệ thống cũ còn đang vận hành shop: bên mới chỉ theo dõi cho tới khi chuyển hẳn từng shop
        legacyHold: true,
        tags: replies?.enabled ? ['v1-tra-loi-tu-dong'] : [],
      })
      .returning();
    const shopId = shop!.id;
    stats.shops++;
    if (s.shopeeName) await db.insert(shopNameHistory).values({ shopId, kind: 'shopee', name: s.shopeeName });
    if (alias) await db.insert(shopNameHistory).values({ shopId, kind: 'alias', name: alias });
    stats.names += alias ? 2 : 1;

    // Sản phẩm
    const plist: Any[] = prod?.items ?? [];
    const syncedAt = prod?.sync?.syncedAt ? new Date(prod.sync.syncedAt) : null;
    for (let i = 0; i < plist.length; i += 500) {
      const batch = plist.slice(i, i + 500).map((p) => ({
        shopId,
        itemId: Number(p.id),
        number: p.number ?? 0,
        name: p.name ?? '',
        searchText: foldVi(`${p.name ?? ''} ${p.sku ?? ''} ${p.id}`),
        sku: p.sku ?? null,
        imageUrl: p.imageUrl ?? null,
        price: p.price ?? null,
        originalPrice: p.originalPrice ?? null,
        currency: p.currency ?? 'VND',
        stock: p.stock ?? null,
        sold: p.sold ?? null,
        rating: p.rating ?? null,
        likes: p.likes ?? null,
        syncedAt,
      }));
      await db.insert(products).values(batch).onConflictDoNothing();
      stats.products += batch.length;
    }

    // Video (chỉ metadata — file nằm trên máy chủ cũ)
    const vlist: Any[] = ok(sd.videos)?.items ?? [];
    const videoMap = new Map<string, { id: number; number: number; templateCount: number }>();
    for (const v of vlist) {
      const [row] = await db
        .insert(videos)
        .values({
          shopId,
          number: v.number ?? 0,
          name: v.name,
          sourceFileName: v.sourceFileName ?? null,
          durationSec: v.durationSec ?? null,
          sizeBytes: v.sizeBytes ?? 0,
          uploadedBytes: 0,
          status: 'missing_file',
          failReason: 'legacy_no_file',
          legacyId: String(v.id),
          createdAt: v.updatedAt ? new Date(v.updatedAt) : new Date(),
          updatedAt: v.updatedAt ? new Date(v.updatedAt) : new Date(),
        })
        .returning({ id: videos.id });
      videoMap.set(String(v.id), { id: row!.id, number: v.number ?? 0, templateCount: v.templateCount ?? 0 });
      stats.videos++;
    }

    // Mẫu phát — backup chỉ có tóm tắt (không có danh sách video→sản phẩm).
    // Suy ra danh sách video từ templateCount khi shop chỉ có 1 mẫu và số video khớp videoCount.
    const tlist: Any[] = ok(sd.templates)?.items ?? [];
    const templateMap = new Map<string, number>();
    for (const t of tlist) {
      const [row] = await db
        .insert(templates)
        .values({
          shopId,
          number: t.number ?? 0,
          name: t.name,
          note: t.note ?? '',
          liveTitle: t.name,
          loop: true,
          legacyId: String(t.id),
          legacyNeedsReview: true,
          createdAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
          updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
        })
        .returning({ id: templates.id });
      templateMap.set(String(t.id), row!.id);
      stats.templates++;
      const used = [...videoMap.values()].filter((v) => v.templateCount > 0).sort((a, b) => a.number - b.number);
      if (tlist.length === 1 && used.length === t.videoCount) {
        if (used.length) {
          await db.insert(templateItems).values(used.map((v, i) => ({ templateId: row!.id, position: i + 1, videoId: v.id, pins: [] })));
          stats.templateItems += used.length;
        }
      } else {
        warnings.push(`Shop ${s.name} (${shopeeShopId}): không suy ra được danh sách video của mẫu "${t.name}" — cần dựng lại.`);
      }
    }

    // Lịch phát — nhập ở trạng thái TẠM DỪNG (hệ thống cũ vẫn đang chạy lịch; thiếu ảnh bìa)
    const seenSchedules = new Set<string>();
    for (const r of ok(sd.schedules)?.items ?? []) {
      const sc = r.schedule;
      if (!sc || seenSchedules.has(String(sc.id))) continue;
      seenSchedules.add(String(sc.id));
      await db.insert(schedules).values({
        shopId,
        title: sc.title,
        templateId: sc.templateId ? templateMap.get(String(sc.templateId)) ?? null : null,
        coverKey: null,
        repeat: sc.repeat === 'weekly' ? 'weekly' : sc.repeat === 'once' ? 'once' : 'daily',
        weekdays: sc.weekdays ?? [],
        startDate: sc.startDate < vnDate() && sc.repeat !== 'once' ? vnDate() : sc.startDate,
        endDate: sc.endDate ?? null,
        startTime: sc.time,
        endTime: sc.endTime,
        state: 'paused',
        legacyId: String(sc.id),
        createdAt: sc.createdAt ? new Date(sc.createdAt) : new Date(),
      });
      stats.schedules++;
      warnings.push(`Shop ${s.name}: lịch "${sc.title}" (${sc.time}–${sc.endTime}, ${sc.repeat}) nhập ở trạng thái TẠM DỪNG — cần tải lại ảnh bìa, gán sản phẩm ghim cho mẫu, rồi kích hoạt sau khi tắt lịch bên hệ thống cũ.`);
    }

    // Lịch sử phiên
    const hist: Any[] = ok(sd.history)?.items ?? [];
    for (let i = 0; i < hist.length; i += 200) {
      const batch = hist.slice(i, i + 200).map((h) => ({
        shopId,
        shopeeSessionId: Number(h.id) || null,
        origin: 'legacy',
        title: h.title ?? '',
        description: h.description ?? '',
        state: 'ended',
        shopeeStatus: 'ended',
        streamState: 'stopped',
        shareUrl: h.shareUrl ?? null,
        metrics: { viewers: h.viewers ?? 0, peakViewers: h.peakViewers ?? 0, orders: h.orders ?? 0 },
        endedReason: h.endedReason ?? null,
        createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
        startedAt: h.startedAt ? new Date(h.startedAt) : null,
        endedAt: h.endedAt ? new Date(h.endedAt) : null,
        lastShopeeSyncAt: h.refreshedAt ? new Date(h.refreshedAt) : null,
      }));
      await db.insert(liveSessions).values(batch);
      stats.history += batch.length;
    }

    // Phiên đang live trên hệ thống cũ → "chưa xác minh" (khóa shop để không tạo phiên trùng)
    if (s.session) {
      const m = /session=(\d+)/.exec(s.session.shareUrl ?? '');
      await db.insert(liveSessions).values({
        shopId,
        shopeeSessionId: m ? Number(m[1]) : null,
        origin: 'legacy',
        title: s.session.title ?? '',
        state: 'unknown',
        shopeeStatus: 'unknown',
        streamState: 'idle',
        shareUrl: s.session.shareUrl ?? null,
        startedAt: s.session.startedAt ? new Date(s.session.startedAt) : null,
        metrics: { viewers: s.session.viewers ?? 0 },
        lastError: 'Phiên đang chạy trên hệ thống cũ lúc backup. Sau khi shop cấp quyền cho ứng dụng mới, hệ thống sẽ tự xác minh với Shopee.',
        createdAt: s.session.startedAt ? new Date(s.session.startedAt) : new Date(),
      });
      stats.openSessions++;
    }

    // Nhật ký shop
    const acts: Any[] = ok(sd.activity)?.items ?? [];
    if (acts.length) {
      await db.insert(activityLogs).values(
        acts.map((a) => ({
          at: new Date(a.at),
          actorId: accountMap.get(a.actor) ?? null,
          actorName: a.actor ?? 'Hệ thống cũ',
          shopId,
          code: a.code,
          params: { ...(a.params ?? {}), legacy: true },
        })),
      );
      stats.activity += acts.length;
    }
    if (idx % 20 === 0) log(`  … đã nhập ${idx}/${shopList.length} shop`);
  }

  await db.insert(activityLogs).values({ actorName: 'Hệ thống', code: 'legacy_import', params: { file: path.basename(file), exportedAt: d.exportedAt, ...stats } });

  // ───── Báo cáo ─────
  report.push(`# Báo cáo nhập dữ liệu từ hệ thống cũ`);
  report.push('');
  report.push(`- File: \`${path.basename(file)}\` (xuất lúc ${d.exportedAt} từ ${d.source})`);
  report.push(`- Chạy lúc: ${new Date().toISOString()} — mất ${Math.round((Date.now() - started) / 1000)} giây`);
  report.push('');
  report.push('## Số lượng đã nhập');
  report.push('');
  report.push('| Hạng mục | Số lượng |');
  report.push('|---|---|');
  report.push(`| Shop | ${stats.shops} (bỏ qua ${stats.shopsSkipped} đã có) |`);
  report.push(`| Sản phẩm | ${stats.products} |`);
  report.push(`| Video (metadata) | ${stats.videos} |`);
  report.push(`| Mẫu phát | ${stats.templates} (${stats.templateItems} vị trí video suy ra được) |`);
  report.push(`| Lịch phát | ${stats.schedules} (tạm dừng) |`);
  report.push(`| Phiên lịch sử | ${stats.history} |`);
  report.push(`| Phiên đang live lúc backup | ${stats.openSessions} (trạng thái "chưa xác minh") |`);
  report.push(`| Nhật ký hoạt động | ${stats.activity} |`);
  report.push(`| Tài khoản | ${stats.accounts} |`);
  report.push(`| Máy chủ phát | ${stats.servers} (cần cấp khóa mới) |`);
  report.push('');
  if (passwords.length) {
    report.push('## Mật khẩu tạm (hiện MỘT lần — gửi riêng cho từng người rồi XÓA file này)');
    report.push('');
    report.push('| Tên đăng nhập | Vai trò | Mật khẩu tạm |');
    report.push('|---|---|---|');
    for (const p of passwords) report.push(`| ${p.username} | ${p.role} | \`${p.password}\` |`);
    report.push('');
  }
  report.push('## Việc cần làm tiếp (không có trong backup)');
  report.push('');
  report.push('1. **Token Shopee:** mỗi shop đang ở trạng thái "Cần cấp quyền lại". Gửi liên kết cấp quyền cho từng chủ shop (Gian hàng → Kết nối lại).');
  report.push(`2. **File video:** ${stats.videos} video chỉ có thông tin. Tải lại đúng file gốc (cùng tên, cùng dung lượng) — hệ thống tự gắn vào video cũ và mẫu phát sẽ hợp lệ lại.`);
  report.push('3. **Mẫu phát:** backup không có sản phẩm ghim cho từng video → mở từng mẫu, gán sản phẩm ghim, lưu lại.');
  report.push('4. **Trả lời tự động:** đã TẮT ở hệ thống mới để không trả lời trùng. Shop từng bật được gắn nhóm `v1-tra-loi-tu-dong` — bật lại hàng loạt sau khi tắt bên cũ.');
  report.push('5. **Lịch phát:** đang tạm dừng, cần ảnh bìa + mẫu hợp lệ rồi kích hoạt sau khi tắt lịch bên cũ.');
  report.push('6. **Khóa API AI:** nhập lại trong Cấu hình hệ thống → AI.');
  report.push('7. **Máy chủ phát:** cấp lại khóa cho từng máy, cài MexoStreamer mới.');
  report.push('');
  if (warnings.length) {
    report.push('## Cảnh báo');
    report.push('');
    for (const w of warnings) report.push(`- ${w}`);
  }
  fs.mkdirSync(env.dataDir, { recursive: true });
  const out = path.join(env.dataDir, `legacy-import-report-${vnDate()}.md`);
  fs.writeFileSync(out, report.join('\n'), 'utf8');
  log(`\nHoàn tất. Báo cáo: ${out}`);
  log(JSON.stringify(stats, null, 2));
  await closeDb();
}

main().catch(async (e) => {
  console.error('[migrate-legacy] lỗi:', e);
  await closeDb().catch(() => {});
  process.exit(1);
});
