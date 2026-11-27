import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { liveSessions, servers, streamJobs, videos } from '../db/schema.js';
import { env } from '../env.js';
import { actorRef, requireRole } from '../auth/auth.js';
import { decrypt } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import { idOf, parse, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { publish } from '../services/events.js';
import { onStreamReport, type StreamReport } from '../services/sessions.js';
import { sendFile } from '../services/storage.js';
import { authServer, capacity, cmpVersion, newServerKey, runningByServer, serverState } from '../services/streamers.js';
import { rc } from '../services/runtimeConfig.js';

export async function serverRoutes(app: FastifyInstance) {
  app.get('/api/servers', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const rows = await db.select().from(servers).orderBy(servers.id);
    const load = await runningByServer();
    const items = rows.map((s) => ({
      id: s.id,
      name: s.name,
      state: serverState(s),
      version: s.version,
      maxStreams: s.maxStreams,
      runningStreams: load.get(s.id) ?? 0,
      host: s.host,
      ip: s.ip,
      metrics: s.metrics,
      lastHeartbeatAt: s.lastHeartbeatAt,
      keyState: s.keyState,
      keyHint: s.keyHint,
      keyExpiresAt: s.keyExpiresAt,
      suspended: s.suspended,
      note: s.note,
      createdAt: s.createdAt,
    }));
    return {
      items,
      counts: {
        all: items.length,
        online: items.filter((i) => i.state === 'online').length,
        attention: items.filter((i) => ['lost', 'rejected', 'key_expired'].includes(i.state)).length,
        inactive: items.filter((i) => ['pending', 'suspended', 'revoked'].includes(i.state)).length,
      },
      capacity: await capacity(),
      canEdit: a.role === 'sysadmin',
      minVersion: rc().streamerMinVersion,
      lostAfterSeconds: rc().streamerLostAfterSec,
      apiUrl: rc().apiPublicUrl,
    };
  });

  app.get('/api/servers/:id/jobs', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const rows = await db
      .select({ j: streamJobs, title: liveSessions.title, shopId: liveSessions.shopId, state: liveSessions.state })
      .from(streamJobs)
      .innerJoin(liveSessions, eq(liveSessions.id, streamJobs.sessionId))
      .where(eq(streamJobs.serverId, idOf(req.params)))
      .orderBy(desc(streamJobs.id))
      .limit(200);
    return { items: rows.map((r) => ({ ...r.j, sessionTitle: r.title, shopId: r.shopId, sessionState: r.state })) };
  });

  app.post('/api/servers', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), note: z.string().max(300).optional() }), req.body);
    const k = newServerKey();
    const [row] = await db
      .insert(servers)
      .values({ name: body.name, note: body.note ?? null, keyHash: k.hash, keyHint: k.hint, keyExpiresAt: new Date(Date.now() + 180 * 86400000) })
      .returning();
    await audit(actorRef(a), 'server_created', { params: { name: body.name } });
    publish({ type: 'server' });
    return { id: row!.id, key: k.key, keyExpiresAt: row!.keyExpiresAt };
  });

  app.patch('/api/servers/:id', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const id = idOf(req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), suspended: z.boolean().optional(), note: z.string().max(300).nullable().optional() }), req.body);
    await db.update(servers).set(body).where(eq(servers.id, id));
    await audit(actorRef(a), 'server_updated', { params: { id, ...body } });
    publish({ type: 'server' });
    return { ok: true };
  });

  app.post('/api/servers/:id/rotate-key', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const id = idOf(req.params);
    const k = newServerKey();
    const expires = new Date(Date.now() + 180 * 86400000);
    await db.update(servers).set({ keyHash: k.hash, keyHint: k.hint, keyState: 'active', keyExpiresAt: expires }).where(eq(servers.id, id));
    await audit(actorRef(a), 'server_key_rotated', { params: { id } });
    publish({ type: 'server' });
    return { key: k.key, keyExpiresAt: expires };
  });

  app.post('/api/servers/:id/revoke-key', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const id = idOf(req.params);
    await db.update(servers).set({ keyState: 'revoked' }).where(eq(servers.id, id));
    await audit(actorRef(a), 'server_key_revoked', { params: { id } });
    publish({ type: 'server' });
    return { ok: true };
  });

  app.delete('/api/servers/:id', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const id = idOf(req.params);
    const running = await db.select({ id: streamJobs.id }).from(streamJobs).where(and(eq(streamJobs.serverId, id), eq(streamJobs.desired, 'run')));
    if (running.length) throw err.conflict('server_busy', `Máy đang chạy ${running.length} luồng. Hãy tạm ngưng và chờ các phiên kết thúc trước khi xóa.`);
    await db.delete(servers).where(eq(servers.id, id));
    await audit(actorRef(a), 'server_deleted', { params: { id } });
    publish({ type: 'server' });
    return { ok: true };
  });

  // ───────────── Giao thức MexoStreamer ─────────────
  const reportSchema = z.object({
    version: z.string().max(20),
    maxStreams: z.number().int().min(0).max(5000),
    host: z.string().max(120).optional(),
    metrics: z.object({ cpu: z.number().optional(), ram: z.number().optional(), ramTotal: z.number().optional(), netOutMbps: z.number().optional(), diskUsed: z.number().optional(), diskTotal: z.number().optional(), load: z.number().optional() }).partial().optional(),
    streams: z
      .array(
        z.object({
          jobId: z.number().int(),
          state: z.enum(['preparing', 'pushing', 'error', 'stopped']),
          videoIndex: z.number().int().nullable().optional(),
          positionSec: z.number().nullable().optional(),
          loops: z.number().int().optional(),
          error: z.string().max(500).nullable().optional(),
          commandSeq: z.number().int().nullable().optional(),
        }),
      )
      .max(5000)
      .default([]),
  });

  app.post('/api/streamer/heartbeat', async (req, reply) => {
    const key = String(req.headers['x-mexo-server-key'] ?? '');
    const server = await authServer(key);
    if (!server) return reply.code(401).send({ error: { code: 'bad_key', message: 'Khóa máy chủ không hợp lệ, đã thu hồi hoặc hết hạn' } });
    const body = parse(reportSchema, req.body);
    const wasOnline = serverState(server) === 'online';
    await db
      .update(servers)
      .set({ version: body.version, maxStreams: body.maxStreams, host: body.host ?? server.host, ip: req.ip, metrics: body.metrics ?? null, lastHeartbeatAt: new Date() })
      .where(eq(servers.id, server.id));
    if (!wasOnline) publish({ type: 'server' });
    if (cmpVersion(body.version, rc().streamerMinVersion) < 0) {
      return { accepted: false, reason: `Phiên bản ${body.version} thấp hơn mức tối thiểu ${rc().streamerMinVersion}`, jobs: [], stop: body.streams.map((s) => s.jobId), intervalSec: 10 };
    }
    // Xử lý báo cáo luồng
    const reportedIds = body.streams.map((s) => s.jobId);
    const reportedJobs = reportedIds.length ? await db.select().from(streamJobs).where(inArray(streamJobs.id, reportedIds)) : [];
    const stop: number[] = [];
    for (const r of body.streams) {
      const job = reportedJobs.find((j) => j.id === r.jobId);
      if (!job || job.serverId !== server.id || job.desired !== 'run') {
        stop.push(r.jobId);
        if (job && job.serverId === server.id && r.state === 'stopped') await db.update(streamJobs).set({ state: 'stopped', lastReportAt: new Date() }).where(eq(streamJobs.id, job.id));
        continue;
      }
      await onStreamReport(job, r as StreamReport);
    }
    if (server.suspended) {
      // Tạm ngưng: không nhận việc mới, các luồng đang chạy vẫn giữ
      return { accepted: true, suspended: true, jobs: [], stop, intervalSec: 3 };
    }
    // Việc được giao cho máy này
    const assigned = await db
      .select({ j: streamJobs, s: liveSessions })
      .from(streamJobs)
      .innerJoin(liveSessions, eq(liveSessions.id, streamJobs.sessionId))
      .where(and(eq(streamJobs.serverId, server.id), eq(streamJobs.desired, 'run')));
    const videoIds = [...new Set(assigned.flatMap((a) => (a.s.playlist ?? []).map((p) => p.videoId)))];
    const vrows = videoIds.length ? await db.select({ id: videos.id, sizeBytes: videos.sizeBytes, updatedAt: videos.updatedAt }).from(videos).where(inArray(videos.id, videoIds)) : [];
    const vmap = new Map(vrows.map((v) => [v.id, v]));
    const jobs = assigned
      .filter((a) => a.s.state !== 'ended')
      .map((a) => ({
        jobId: a.j.id,
        sessionId: a.s.id,
        title: a.s.title,
        pushUrl: decrypt(a.s.pushUrlEnc),
        loop: a.s.loop,
        resumeIndex: a.j.resumeIndex,
        command: a.j.command,
        playlist: (a.s.playlist ?? []).map((p) => ({
          videoId: p.videoId,
          name: p.name,
          durationSec: p.durationSec,
          sizeBytes: vmap.get(p.videoId)?.sizeBytes ?? 0,
          version: vmap.get(p.videoId)?.updatedAt?.getTime() ?? 0,
          url: `${rc().apiPublicUrl}/api/streamer/videos/${p.videoId}`,
        })),
      }));
    // Việc mới chưa được máy nhận
    for (const a of assigned) {
      if (a.j.state === 'waiting_server' && !reportedIds.includes(a.j.id)) {
        await db.update(streamJobs).set({ state: 'preparing', lastReportAt: new Date() }).where(eq(streamJobs.id, a.j.id));
      }
    }
    return { accepted: true, jobs, stop, intervalSec: 3 };
  });

  app.get('/api/streamer/videos/:id', async (req, reply) => {
    const server = await authServer(String(req.headers['x-mexo-server-key'] ?? ''));
    if (!server) return reply.code(401).send({ error: { code: 'bad_key', message: 'Khóa máy chủ không hợp lệ' } });
    const [v] = await db.select().from(videos).where(eq(videos.id, idOf(req.params)));
    if (!v?.storageKey || v.status !== 'ready') return reply.code(404).send({ error: { code: 'not_found', message: 'Video chưa sẵn sàng' } });
    // Chỉ máy đang được giao phát video này mới tải được
    const allowed = await db
      .select({ id: streamJobs.id, playlist: liveSessions.playlist })
      .from(streamJobs)
      .innerJoin(liveSessions, eq(liveSessions.id, streamJobs.sessionId))
      .where(and(eq(streamJobs.serverId, server.id), eq(streamJobs.desired, 'run')));
    if (!allowed.some((x) => (x.playlist ?? []).some((p) => p.videoId === v.id))) return reply.code(403).send({ error: { code: 'forbidden', message: 'Máy không được giao video này' } });
    return sendFile(req, reply, v.storageKey, v.mime || 'video/mp4');
  });
}
