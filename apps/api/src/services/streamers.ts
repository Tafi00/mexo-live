import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { servers, streamJobs } from '../db/schema.js';
import { env } from '../env.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { rc } from './runtimeConfig.js';

export type ServerRow = typeof servers.$inferSelect;

export function cmpVersion(a: string | null | undefined, b: string): number {
  const pa = String(a ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function serverState(s: ServerRow, now = Date.now()): 'online' | 'lost' | 'rejected' | 'pending' | 'suspended' | 'revoked' | 'key_expired' {
  if (s.suspended) return 'suspended';
  if (s.keyState === 'revoked') return 'revoked';
  if (s.keyExpiresAt && s.keyExpiresAt.getTime() < now) return 'key_expired';
  if (!s.lastHeartbeatAt) return 'pending';
  if (s.version && cmpVersion(s.version, rc().streamerMinVersion) < 0) return 'rejected';
  if (now - s.lastHeartbeatAt.getTime() > rc().streamerLostAfterSec * 1000) return 'lost';
  return 'online';
}

export function newServerKey(): { key: string; hash: string; hint: string } {
  const key = 'mxs_' + randomToken(32);
  return { key, hash: sha256(key), hint: '…' + key.slice(-4) };
}

export async function authServer(key: string | undefined): Promise<ServerRow | null> {
  if (!key) return null;
  const [s] = await db.select().from(servers).where(eq(servers.keyHash, sha256(key)));
  if (!s) return null;
  if (s.keyState !== 'active') return null;
  if (s.keyExpiresAt && s.keyExpiresAt.getTime() < Date.now()) return null;
  return s;
}

export const ACTIVE_JOB_STATES = ['waiting_server', 'preparing', 'pushing', 'error', 'lost'];

/** Số luồng đang chạy theo máy */
export async function runningByServer(): Promise<Map<number, number>> {
  const rows = await db
    .select({ serverId: streamJobs.serverId, n: sql<number>`count(*)` })
    .from(streamJobs)
    .where(and(eq(streamJobs.desired, 'run'), inArray(streamJobs.state, ACTIVE_JOB_STATES)))
    .groupBy(streamJobs.serverId);
  return new Map(rows.filter((r) => r.serverId !== null).map((r) => [r.serverId!, Number(r.n)]));
}

/** Chọn máy chủ phát: đang kết nối, không tạm ngưng, còn luồng; ưu tiên máy tải thấp */
export async function pickServer(preferId?: number | null, excludeId?: number | null): Promise<ServerRow | null> {
  const all = await db.select().from(servers);
  const load = await runningByServer();
  const candidates = all
    .filter((s) => serverState(s) === 'online' && s.id !== excludeId)
    .map((s) => ({ s, used: load.get(s.id) ?? 0 }))
    .filter((x) => x.used < x.s.maxStreams);
  if (preferId) {
    const p = candidates.find((x) => x.s.id === preferId);
    return p ? p.s : null;
  }
  candidates.sort((a, b) => a.used / Math.max(1, a.s.maxStreams) - b.used / Math.max(1, b.s.maxStreams));
  return candidates[0]?.s ?? null;
}

export async function capacity(): Promise<{ used: number; total: number; online: number }> {
  const all = await db.select().from(servers);
  const load = await runningByServer();
  let total = 0;
  let used = 0;
  let online = 0;
  for (const s of all) {
    if (serverState(s) === 'online') {
      total += s.maxStreams;
      online++;
    }
    used += load.get(s.id) ?? 0;
  }
  return { used, total, online };
}
