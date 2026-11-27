import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { apiCalls, comments, oauthStates, replyLogs, servers, sessionMetricSamples, shops, streamJobs, videos, liveSessions } from './db/schema.js';
import { env } from './env.js';
import { purgeExpiredLogins, shopServiceState } from './auth/auth.js';
import { raiseAlert, resolveAlert } from './services/alerts.js';
import { commentsTick } from './services/comments.js';
import { publish } from './services/events.js';
import { getSetting, isFrozen } from './services/settings.js';
import { engineTick, failoverTick, liveCutTick, reconcileTick } from './services/sessions.js';
import { flushApiLogs, refreshAccessToken } from './services/shopee/index.js';
import { schedulerTick, recoverRuns } from './services/scheduler.js';
import { serverState } from './services/streamers.js';
import { removeFile, dirUsage } from './services/storage.js';

interface Job {
  name: string;
  everyMs: number;
  fn: () => Promise<void>;
  failures: number;
  running: boolean;
  lastRunAt: number;
  lastOkAt: number;
  lastError: string | null;
  lastDurationMs: number;
}

const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];

function register(name: string, everyMs: number, fn: () => Promise<void>) {
  jobs.push({ name, everyMs, fn, failures: 0, running: false, lastRunAt: 0, lastOkAt: 0, lastError: null, lastDurationMs: 0 });
}

async function run(job: Job) {
  if (job.running) return;
  job.running = true;
  job.lastRunAt = Date.now();
  try {
    await job.fn();
    job.lastOkAt = Date.now();
    if (job.failures >= 5) await resolveAlert(`job_failing:${job.name}`);
    job.failures = 0;
    job.lastError = null;
  } catch (e) {
    job.failures++;
    job.lastError = e instanceof Error ? e.message : String(e);
    console.error(`[job:${job.name}] lỗi lần ${job.failures}:`, e);
    if (job.failures === 5) {
      await raiseAlert({ key: `job_failing:${job.name}`, type: 'job_failing', severity: 'critical', message: `Tác vụ nền "${job.name}" lỗi ${job.failures} lần liên tiếp: ${job.lastError}` });
    }
  } finally {
    job.running = false;
    job.lastDurationMs = Date.now() - job.lastRunAt;
  }
}

export function jobStatus() {
  return jobs.map(({ fn, ...j }) => j);
}

// ───────────── Tác vụ bảo trì ─────────────

/** Làm mới access token sắp hết, cảnh báo quyền Shopee sắp/đã hết hạn */
async function tokensTick() {
  if (await isFrozen()) return;
  const limits = await getSetting('limits');
  const list = await db.select().from(shops).where(and(isNull(shops.suspendedAt), isNotNull(shops.refreshTokenEnc)));
  const now = Date.now();
  for (const s of list) {
    if (s.connection === 'needs_reauth' || s.connection === 'revoked') continue;
    if (s.accessExpiresAt && s.accessExpiresAt.getTime() - now < 30 * 60000) {
      await refreshAccessToken(s.id).catch(() => {});
    }
    if (s.authExpiresAt) {
      const days = (s.authExpiresAt.getTime() - now) / 86400000;
      const name = s.alias || s.shopeeName;
      if (days < 0) {
        if (s.connection !== 'expired') await db.update(shops).set({ connection: 'expired' }).where(eq(shops.id, s.id));
        await raiseAlert({ key: `auth_expired:${s.id}`, type: 'auth_expired', severity: 'critical', shopId: s.id, message: `${name}: quyền Shopee đã hết hạn, cần cấp quyền lại` });
      } else if (days < limits.authExpiringDays) {
        if (s.connection === 'ok') await db.update(shops).set({ connection: 'expiring' }).where(eq(shops.id, s.id));
        await raiseAlert({ key: `auth_expiring:${s.id}`, type: 'auth_expiring', severity: 'warning', shopId: s.id, message: `${name}: quyền Shopee hết hạn sau ${Math.ceil(days)} ngày` });
      } else if (s.connection === 'expiring') {
        await db.update(shops).set({ connection: 'ok' }).where(eq(shops.id, s.id));
        await resolveAlert(`auth_expiring:${s.id}`);
      }
    }
  }
}

/** Cảnh báo hạn dùng dịch vụ */
async function expiryTick() {
  const limits = await getSetting('limits');
  const list = await db.select().from(shops).where(and(isNull(shops.suspendedAt), isNotNull(shops.serviceExpiresOn)));
  for (const s of list) {
    const svc = shopServiceState(s, limits.serviceExpiringDays);
    const name = s.alias || s.shopeeName;
    if (svc.state === 'expired') {
      await resolveAlert(`service_expiring:${s.id}`);
      await raiseAlert({ key: `service_expired:${s.id}`, type: 'service_expired', severity: 'warning', shopId: s.id, message: `${name}: đã hết hạn dịch vụ ngày ${s.serviceExpiresOn}` });
    } else if (svc.state === 'expiring') {
      await raiseAlert({ key: `service_expiring:${s.id}`, type: 'service_expiring', severity: 'info', shopId: s.id, message: `${name}: còn ${svc.daysLeft} ngày sử dụng` });
    } else {
      await resolveAlert(`service_expiring:${s.id}`);
      await resolveAlert(`service_expired:${s.id}`);
    }
  }
  await liveCutTick();
}

/** Theo dõi máy chủ phát */
const serverStates = new Map<number, string>();
async function serversTick() {
  const list = await db.select().from(servers);
  for (const s of list) {
    const st = serverState(s);
    const prev = serverStates.get(s.id);
    serverStates.set(s.id, st);
    if (st === 'lost') {
      await raiseAlert({ key: `server_lost:${s.id}`, type: 'server_lost', severity: 'critical', serverId: s.id, message: `Máy ${s.name} không báo về quá ${env.streamerLostAfterSec} giây` });
      // Đánh dấu luồng của máy mất kết nối
      await db
        .update(streamJobs)
        .set({ state: 'lost' })
        .where(and(eq(streamJobs.serverId, s.id), eq(streamJobs.desired, 'run'), inArray(streamJobs.state, ['preparing', 'pushing', 'error'])));
    } else if (st === 'rejected') {
      await raiseAlert({ key: `server_rejected:${s.id}`, type: 'server_rejected', severity: 'warning', serverId: s.id, message: `Máy ${s.name} chạy phiên bản ${s.version}, thấp hơn mức tối thiểu ${env.streamerMinVersion}` });
    } else if (st === 'online') {
      await resolveAlert(`server_lost:${s.id}`);
      await resolveAlert(`server_rejected:${s.id}`);
      const m = s.metrics;
      if (m && ((m.cpu ?? 0) > 90 || (m.ram && m.ramTotal && m.ram / m.ramTotal > 0.92))) {
        await raiseAlert({ key: `server_overload:${s.id}`, type: 'server_overload', severity: 'warning', serverId: s.id, message: `Máy ${s.name}: CPU ${m.cpu?.toFixed(0)}%, RAM ${m.ram && m.ramTotal ? Math.round((m.ram / m.ramTotal) * 100) : '?'}%` });
      } else await resolveAlert(`server_overload:${s.id}`);
    }
    if (prev !== st) publish({ type: 'server' });
  }
  await failoverTick();
}

/** Tỷ lệ gọi API thành công (Shopee phạt nếu < 90%/ngày) */
async function apiHealthTick() {
  const hourAgo = new Date(Date.now() - 3600000);
  const [h] = await db
    .select({ total: sql<number>`count(*)`, ok: sql<number>`count(*) filter (where ${apiCalls.success})` })
    .from(apiCalls)
    .where(and(gte(apiCalls.at, hourAgo), eq(apiCalls.counted, true)));
  const total = Number(h?.total ?? 0);
  const rate = total ? Number(h!.ok) / total : 1;
  if (total >= 50 && rate < 0.93) {
    await raiseAlert({ key: 'api_rate_low:hour', type: 'api_rate_low', severity: 'critical', message: `Tỷ lệ gọi API thành công 1 giờ qua: ${(rate * 100).toFixed(1)}% (${total} lệnh)` });
  } else if (total >= 50 && rate < 0.97) {
    await raiseAlert({ key: 'api_rate_low:hour', type: 'api_rate_low', severity: 'warning', message: `Tỷ lệ gọi API thành công 1 giờ qua: ${(rate * 100).toFixed(1)}% (${total} lệnh)` });
  } else await resolveAlert('api_rate_low:hour');

  // Nhiều shop lỗi API đồng thời trong 5 phút
  const fiveAgo = new Date(Date.now() - 5 * 60000);
  const failing = await db
    .select({ shopId: apiCalls.shopId })
    .from(apiCalls)
    .where(and(gte(apiCalls.at, fiveAgo), eq(apiCalls.success, false), isNotNull(apiCalls.shopId), inArray(apiCalls.errorClass, ['shopee', 'network'])))
    .groupBy(apiCalls.shopId);
  if (failing.length >= 5) {
    await raiseAlert({ key: 'api_mass_failure', type: 'api_mass_failure', severity: 'critical', message: `${failing.length} shop gặp lỗi API Shopee trong 5 phút qua` });
  } else await resolveAlert('api_mass_failure');
}

/** Kiểm tra IP ra Internet (Shopee chỉ nhận lệnh từ IP đã khai báo) */
async function egressTick() {
  if (!env.expectedEgressIp) return;
  try {
    const ip = (await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) })).text()).trim();
    if (ip !== env.expectedEgressIp) await raiseAlert({ key: 'egress_ip', type: 'egress_ip', severity: 'critical', message: `IP ra thực tế ${ip} khác IP đã khai với Shopee (${env.expectedEgressIp})` });
    else await resolveAlert('egress_ip');
  } catch {
    /* mạng chập chờn: bỏ qua lần này */
  }
}

/** Dọn dữ liệu cũ */
async function cleanupTick() {
  const limits = await getSetting('limits');
  const now = Date.now();
  await db.delete(apiCalls).where(lt(apiCalls.at, new Date(now - limits.apiLogRetentionDays * 86400000)));
  await db.delete(replyLogs).where(lt(replyLogs.at, new Date(now - 30 * 86400000)));
  await db.delete(comments).where(lt(comments.at, new Date(now - limits.commentRetentionDays * 86400000)));
  await db.delete(sessionMetricSamples).where(lt(sessionMetricSamples.at, new Date(now - 90 * 86400000)));
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date(now - 86400000)));
  await purgeExpiredLogins();
  // Tải dở quá 24 giờ → dọn
  const stale = await db
    .select()
    .from(videos)
    .where(and(eq(videos.status, 'uploading'), lt(videos.updatedAt, new Date(now - 24 * 3600000))));
  for (const v of stale) {
    await removeFile(v.storageKey);
    await db.update(videos).set({ status: 'failed', failReason: 'stale_upload', uploadedBytes: 0 }).where(eq(videos.id, v.id));
  }
  // Kho lưu trữ sắp đầy
  const u = await dirUsage();
  if (u.freeBytes !== null && u.totalBytes && u.freeBytes / u.totalBytes < 0.08) {
    await raiseAlert({ key: 'storage_full', type: 'storage_full', severity: 'critical', message: `Kho lưu trữ còn ${(u.freeBytes / 1e9).toFixed(1)} GB` });
  } else await resolveAlert('storage_full');
}

// ───────────── Khởi động ─────────────

export async function startJobs(): Promise<void> {
  if (!env.jobsEnabled) {
    console.log('[jobs] JOBS_ENABLED=false — không chạy tác vụ nền');
    return;
  }
  // Khôi phục sau khởi động lại
  await recoverRuns();
  // Phiên đang mở: đánh dấu cần đối soát ngay (không tạo trùng, không phát trùng)
  await db
    .update(liveSessions)
    .set({ syncFailures: 0 })
    .where(and(ne(liveSessions.state, 'ended')));

  register('api-log-flush', 2000, flushApiLogs);
  register('session-engine', 2000, engineTick);
  register('comments', 2000, commentsTick);
  register('reconcile', 5000, reconcileTick);
  register('scheduler', 10000, schedulerTick);
  register('servers', 10000, serversTick);
  register('tokens', 5 * 60000, tokensTick);
  register('expiry', 60000, expiryTick);
  register('api-health', 5 * 60000, apiHealthTick);
  register('egress-ip', 10 * 60000, egressTick);
  register('cleanup', 60 * 60000, cleanupTick);

  for (const j of jobs) {
    setTimeout(() => void run(j), 1500 + Math.random() * 1500);
    timers.push(setInterval(() => void run(j), j.everyMs));
  }
  console.log(`[jobs] đã bật ${jobs.length} tác vụ nền`);
}

export async function stopJobs(): Promise<void> {
  for (const t of timers) clearInterval(t);
  await flushApiLogs();
}
