import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { addDays, vnDate } from '@mexo/shared';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { alerts, apiCalls, files, liveSessions, scheduleRuns, schedules, servers, shops } from '../db/schema.js';
import { env } from '../env.js';
import { actorRef, isStaff, requireActor, requireRole, visibleShopIds } from '../auth/auth.js';
import { decrypt, encrypt, hmacSha256Hex } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import { idOf, parse, z } from '../lib/http.js';
import { chat, listModels, validateAiBaseUrl } from '../services/ai.js';
import { audit } from '../services/audit.js';
import { events, type LiveEvent } from '../services/events.js';
import { getSetting, setSetting } from '../services/settings.js';
import { buildShopViews } from '../services/shopView.js';
import { dirUsage, readFile, writeFile } from '../services/storage.js';
import { capacity, serverState } from '../services/streamers.js';
import { jobStatus } from '../jobs.js';
import { breakerStates } from '../services/shopee/index.js';
import { describeRuntimeConfig, rc, resetRuntimeFields, saveRuntimeConfig, shopeeRedirectUrl } from '../services/runtimeConfig.js';

export async function systemRoutes(app: FastifyInstance) {
  // ───────────── Thanh trên cùng ─────────────
  app.get('/api/shell', async (req) => {
    const a = requireActor(req, { allowMustChange: true });
    const freeze = await getSetting('freeze');
    const ids = await visibleShopIds(a);
    const conds: SQL[] = [isNull(alerts.resolvedAt), isNull(alerts.acknowledgedAt)];
    if (ids !== null) conds.push(ids.length ? inArray(alerts.shopId, ids) : sql`false`);
    const [al] = await db.select({ n: sql<number>`count(*)`, critical: sql<number>`count(*) filter (where ${alerts.severity} = 'critical')` }).from(alerts).where(and(...conds));
    return { capacity: isStaff(a) ? await capacity() : null, unacknowledgedAlerts: Number(al?.n ?? 0), criticalAlerts: Number(al?.critical ?? 0), freeze: { frozen: freeze.frozen, reason: freeze.reason, at: freeze.at }, shopeeMode: rc().shopeeMode, updatedAt: new Date() };
  });

  // ───────────── Dashboard tổng quan ─────────────
  app.get('/api/dashboard', async (req) => {
    const a = requireActor(req);
    const ids = await visibleShopIds(a);
    const views = await buildShopViews(ids);
    const shopFilter = (col: typeof liveSessions.shopId) => (ids === null ? sql`true` : ids.length ? inArray(col, ids) : sql`false`);
    const since = new Date(Date.now() - 7 * 86400000);
    const today = vnDate();
    const [sess] = await db
      .select({
        ok: sql<number>`count(*) filter (where ${liveSessions.state} = 'ended' and ${liveSessions.startedAt} is not null and coalesce(${liveSessions.endedReason},'') not in ('schedule_start_failed','not_found_on_shopee','lock_released'))`,
        failed: sql<number>`count(*) filter (where ${liveSessions.state} = 'ended' and (${liveSessions.startedAt} is null or ${liveSessions.endedReason} in ('schedule_start_failed')))`,
        errored: sql<number>`count(*) filter (where ${liveSessions.origin} <> 'legacy' and (${liveSessions.endedReason} in ('not_found_on_shopee','lock_released') or ${liveSessions.state} in ('sync_error','unknown','disconnected') or ${liveSessions.stuck}))`,
        hours: sql<number>`coalesce(sum(extract(epoch from (coalesce(${liveSessions.endedAt}, now()) - ${liveSessions.startedAt}))) filter (where ${liveSessions.startedAt} is not null), 0) / 3600`,
        orders: sql<number>`coalesce(sum((${liveSessions.metrics}->>'orders')::int), 0)`,
      })
      .from(liveSessions)
      .where(and(gte(liveSessions.createdAt, since), shopFilter(liveSessions.shopId)));
    const runFilter = ids === null ? sql`true` : ids.length ? inArray(scheduleRuns.shopId, ids) : sql`false`;
    const [runs] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${scheduleRuns.status} = 'upcoming')`,
        todayDone: sql<number>`count(*) filter (where ${scheduleRuns.status} = 'done' and ${scheduleRuns.runDate} = ${today})`,
        todayMissed: sql<number>`count(*) filter (where ${scheduleRuns.status} in ('missed','failed') and ${scheduleRuns.runDate} = ${today})`,
      })
      .from(scheduleRuns)
      .where(runFilter);
    const upcoming = await db
      .select({ r: scheduleRuns, title: schedules.title, alias: shops.alias, shopeeName: shops.shopeeName })
      .from(scheduleRuns)
      .innerJoin(schedules, eq(schedules.id, scheduleRuns.scheduleId))
      .innerJoin(shops, eq(shops.id, scheduleRuns.shopId))
      .where(and(runFilter, eq(scheduleRuns.status, 'upcoming'), gte(scheduleRuns.startAt, new Date())))
      .orderBy(asc(scheduleRuns.startAt))
      .limit(8);
    // Biểu đồ 14 ngày: số phiên, giờ phát
    const daily = await db
      .select({
        day: sql<string>`to_char((${liveSessions.createdAt} at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD')`,
        sessions: sql<number>`count(*)`,
        hours: sql<number>`coalesce(sum(extract(epoch from (coalesce(${liveSessions.endedAt}, now()) - ${liveSessions.startedAt}))) filter (where ${liveSessions.startedAt} is not null), 0) / 3600`,
        orders: sql<number>`coalesce(sum((${liveSessions.metrics}->>'orders')::int), 0)`,
      })
      .from(liveSessions)
      .where(and(gte(liveSessions.createdAt, new Date(Date.now() - 14 * 86400000)), shopFilter(liveSessions.shopId)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const alertConds: SQL[] = [isNull(alerts.resolvedAt)];
    if (ids !== null) alertConds.push(ids.length ? inArray(alerts.shopId, ids) : sql`false`);
    const recentAlerts = await db.select().from(alerts).where(and(...alertConds)).orderBy(desc(alerts.lastAt)).limit(8);
    let api = null;
    let serverSummary = null;
    if (isStaff(a)) {
      const [h] = await db
        .select({ total: sql<number>`count(*)`, ok: sql<number>`count(*) filter (where ${apiCalls.success})`, avgMs: sql<number>`avg(${apiCalls.durationMs})` })
        .from(apiCalls)
        .where(gte(apiCalls.at, new Date(Date.now() - 86400000)));
      api = { total24h: Number(h?.total ?? 0), successRate24h: Number(h?.total ?? 0) ? Number(h!.ok) / Number(h!.total) : null, avgMs: h?.avgMs ? Math.round(Number(h.avgMs)) : null };
      const srv = await db.select().from(servers);
      serverSummary = { total: srv.length, online: srv.filter((s) => serverState(s) === 'online').length, attention: srv.filter((s) => ['lost', 'rejected', 'key_expired'].includes(serverState(s))).length, capacity: await capacity() };
    }
    const active = views.filter((v) => v.status !== 'suspended');
    return {
      shops: {
        total: active.length,
        connected: active.filter((v) => v.connection === 'ok' || v.connection === 'expiring').length,
        live: active.filter((v) => v.status === 'live').length,
        needs: active.filter((v) => v.issues.some((i) => i.level !== 'info')).length,
        expiring: active.filter((v) => v.service.state === 'expiring').length,
        disconnected: active.filter((v) => v.connection !== 'ok' && v.connection !== 'expiring').length,
      },
      sessions7d: { ok: Number(sess?.ok ?? 0), failed: Number(sess?.failed ?? 0), errored: Number(sess?.errored ?? 0), hours: Math.round(Number(sess?.hours ?? 0) * 10) / 10, orders: Number(sess?.orders ?? 0) },
      concurrent: active.filter((v) => v.status === 'live').length,
      // Chỉ cộng shop đang live: phiên cũ "chưa xác minh" mang số người xem từ lúc backup, không phải hiện tại
      viewersNow: active.reduce((s, v) => s + (v.status === 'live' ? (v.session?.viewers ?? 0) : 0), 0),
      schedules: { pending: Number(runs?.pending ?? 0), todayDone: Number(runs?.todayDone ?? 0), todayMissed: Number(runs?.todayMissed ?? 0) },
      upcoming: upcoming.map((u) => ({ ...u.r, title: u.title, shopName: u.alias || u.shopeeName })),
      daily: daily.map((d) => ({ day: d.day, sessions: Number(d.sessions), hours: Math.round(Number(d.hours) * 10) / 10, orders: Number(d.orders) })),
      needsAttention: views.filter((v) => v.status !== 'suspended' && v.issues.some((i) => i.level !== 'info')).slice(0, 10).map((v) => ({ id: v.id, name: v.name, issues: v.issues })),
      topLive: views
        .filter((v) => v.status === 'live')
        .sort((x, y) => (y.session?.viewers ?? 0) - (x.session?.viewers ?? 0))
        .slice(0, 8)
        .map((v) => ({ id: v.id, name: v.name, session: v.session })),
      alerts: recentAlerts,
      api,
      servers: serverSummary,
    };
  });

  // ───────────── Cảnh báo ─────────────
  app.get('/api/alerts', async (req) => {
    const a = requireActor(req);
    const q = parse(z.object({ status: z.enum(['open', 'acknowledged', 'resolved', 'all']).default('open'), severity: z.string().optional(), type: z.string().optional(), shopId: z.coerce.number().int().optional() }), req.query);
    const ids = await visibleShopIds(a);
    const base: SQL[] = [];
    if (ids !== null) base.push(ids.length ? inArray(alerts.shopId, ids) : sql`false`);
    if (q.severity) base.push(eq(alerts.severity, q.severity));
    if (q.type) base.push(eq(alerts.type, q.type));
    if (q.shopId) base.push(eq(alerts.shopId, q.shopId));
    const st: Record<string, SQL> = {
      open: and(isNull(alerts.resolvedAt), isNull(alerts.acknowledgedAt))!,
      acknowledged: and(isNull(alerts.resolvedAt), isNotNull(alerts.acknowledgedAt))!,
      resolved: isNotNull(alerts.resolvedAt),
      all: sql`true`,
    };
    const items = await db
      .select({ a: alerts, alias: shops.alias, shopeeName: shops.shopeeName, serverName: servers.name })
      .from(alerts)
      .leftJoin(shops, eq(shops.id, alerts.shopId))
      .leftJoin(servers, eq(servers.id, alerts.serverId))
      .where(and(st[q.status]!, ...base))
      .orderBy(desc(alerts.lastAt))
      .limit(500);
    const [c] = await db
      .select({
        open: sql<number>`count(*) filter (where ${alerts.resolvedAt} is null and ${alerts.acknowledgedAt} is null)`,
        acknowledged: sql<number>`count(*) filter (where ${alerts.resolvedAt} is null and ${alerts.acknowledgedAt} is not null)`,
        resolved: sql<number>`count(*) filter (where ${alerts.resolvedAt} is not null)`,
        all: sql<number>`count(*)`,
      })
      .from(alerts)
      .where(base.length ? and(...base) : sql`true`);
    return {
      items: items.map((r) => ({ ...r.a, shopName: r.alias || r.shopeeName || null, serverName: r.serverName })),
      counts: { open: Number(c?.open ?? 0), acknowledged: Number(c?.acknowledged ?? 0), resolved: Number(c?.resolved ?? 0), all: Number(c?.all ?? 0) },
    };
  });

  app.post('/api/alerts/:id/acknowledge', async (req) => {
    const a = requireActor(req);
    const id = idOf(req.params);
    const [al] = await db.select().from(alerts).where(eq(alerts.id, id));
    if (!al) throw err.notFound();
    const ids = await visibleShopIds(a);
    if (ids !== null && (!al.shopId || !ids.includes(al.shopId))) throw err.notFound();
    await db.update(alerts).set({ acknowledgedAt: new Date(), acknowledgedBy: a.name }).where(eq(alerts.id, id));
    return { ok: true };
  });

  app.post('/api/alerts/acknowledge-all', async (req) => {
    const a = requireActor(req);
    const ids = await visibleShopIds(a);
    const conds: SQL[] = [isNull(alerts.resolvedAt), isNull(alerts.acknowledgedAt)];
    if (ids !== null) conds.push(ids.length ? inArray(alerts.shopId, ids) : sql`false`);
    const r = await db.update(alerts).set({ acknowledgedAt: new Date(), acknowledgedBy: a.name }).where(and(...conds)).returning({ id: alerts.id });
    return { ok: true, count: r.length };
  });

  // ───────────── Cấu hình AI ─────────────
  app.get('/api/settings/ai', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const ai = await getSetting('ai');
    return { baseUrl: ai.baseUrl, model: ai.model, temperature: ai.temperature, hasKey: Boolean(ai.apiKeyEnc), keyHint: ai.keyHint, models: ai.models, globalContext: ai.globalContext, ready: Boolean(decrypt(ai.apiKeyEnc)), canEdit: isStaff(a), contextMax: 4000 };
  });

  app.put('/api/settings/ai', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const body = parse(
      z.object({
        baseUrl: z.string().url().max(300),
        apiKey: z.string().max(500).optional(),
        model: z.string().trim().min(1).max(100),
        temperature: z.number().min(0).max(1.5),
        globalContext: z.string().max(4000),
      }),
      req.body,
    );
    validateAiBaseUrl(body.baseUrl);
    const patch: Record<string, unknown> = { baseUrl: body.baseUrl, model: body.model, temperature: body.temperature, globalContext: body.globalContext };
    if (body.apiKey) {
      patch.apiKeyEnc = encrypt(body.apiKey);
      patch.keyHint = `${body.apiKey.slice(0, 3)}…${body.apiKey.slice(-4)}`;
    }
    await setSetting('ai', patch);
    await audit(actorRef(a), 'settings_updated', { params: { section: 'ai', model: body.model, keyChanged: Boolean(body.apiKey) } });
    return { ok: true };
  });

  app.post('/api/settings/ai/models', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const body = parse(z.object({ baseUrl: z.string().url(), apiKey: z.string().optional() }), req.body);
    const ai = await getSetting('ai');
    const key = body.apiKey || decrypt(ai.apiKeyEnc);
    if (!key) throw err.badRequest('no_key', 'Chưa có khóa API');
    const models = await listModels(body.baseUrl, key);
    await setSetting('ai', { models });
    return { models };
  });

  app.post('/api/settings/ai/test', async (req) => {
    requireRole(req, 'sysadmin', 'admin');
    const body = parse(z.object({ baseUrl: z.string().url(), apiKey: z.string().optional(), model: z.string(), temperature: z.number().min(0).max(1.5), globalContext: z.string().max(4000), question: z.string().max(300).default('Shop ơi sản phẩm này còn hàng không ạ?') }), req.body);
    const ai = await getSetting('ai');
    const key = body.apiKey || decrypt(ai.apiKeyEnc);
    if (!key) throw err.badRequest('no_key', 'Chưa có khóa API');
    const t0 = Date.now();
    const answer = await chat(body.baseUrl, key, body.model, body.temperature, body.globalContext + '\nTrả lời tối đa 2 câu ngắn.', body.question);
    return { latencyMs: Date.now() - t0, answer };
  });

  // ───────────── Cấu hình hệ thống ─────────────
  app.get('/api/settings/system', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    const limits = await getSetting('limits');
    const freeze = await getSetting('freeze');
    const usage = await dirUsage();
    return {
      limits,
      freeze,
      canEdit: a.role === 'sysadmin',
      shopee: { mode: rc().shopeeMode, partnerId: rc().partnerId || null, redirectUrl: shopeeRedirectUrl(), hasKey: Boolean(rc().partnerKey), expectedEgressIp: rc().expectedEgressIp || null },
      streamer: { minVersion: rc().streamerMinVersion, lostAfterSec: rc().streamerLostAfterSec, apiUrl: rc().apiPublicUrl },
      storage: usage,
      jobs: jobStatus(),
      breakers: breakerStates(),
      version: '2.0.0',
    };
  });

  app.put('/api/settings/system', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const body = parse(
      z
        .object({
          maxActiveSchedulesPerShop: z.number().int().min(1).max(100),
          scheduleDaysAhead: z.number().int().min(1).max(60),
          scheduleStartGraceMin: z.number().int().min(1).max(120),
          defaultShopLimit: z.number().int().min(0).max(10000),
          defaultConcurrentLimit: z.number().int().min(0).max(10000),
          defaultStorageQuotaGb: z.number().min(1).max(100000),
          liveCutGraceMin: z.number().int().min(0).max(1440),
          stuckAfterMin: z.number().int().min(2).max(120),
          apiLogRetentionDays: z.number().int().min(1).max(90),
          commentRetentionDays: z.number().int().min(1).max(30),
          feedStartDelaySec: z.number().int().min(0).max(120),
          serviceExpiringDays: z.number().int().min(1).max(60),
          authExpiringDays: z.number().int().min(1).max(60),
        })
        .partial(),
      req.body,
    );
    await setSetting('limits', body);
    await audit(actorRef(a), 'settings_updated', { params: { section: 'limits', ...body } });
    return { ok: true };
  });

  // ───────────── Kết nối & tích hợp (nhập trực tiếp trên web) ─────────────
  app.get('/api/settings/integrations', async (req) => {
    const a = requireRole(req, 'sysadmin', 'admin');
    return { ...describeRuntimeConfig(), canEdit: a.role === 'sysadmin' };
  });

  const integrationSchema = z
    .object({
      shopeeMode: z.enum(['mock', 'sandbox', 'live']),
      partnerId: z.number().int().min(0).max(9_999_999_999),
      partnerKey: z.string().trim().min(8, 'Partner Key quá ngắn').max(200).nullable(),
      redirectUrl: z.union([z.string().url('Redirect URL không hợp lệ').max(500), z.literal('')]),
      timeoutMs: z.number().int().min(2000).max(120000),
      apiPublicUrl: z.union([z.string().url('Địa chỉ API không hợp lệ').max(300), z.literal('')]),
      expectedEgressIp: z.union([z.string().ip({ message: 'IP không hợp lệ' }), z.literal('')]),
      streamerMinVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Phiên bản dạng 1.0.0'),
      streamerLostAfterSec: z.number().int().min(10).max(600),
      aiAllowPrivateHosts: z.boolean(),
    })
    .partial();

  app.put('/api/settings/integrations', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const body = parse(integrationSchema, req.body);
    const next = { ...rc(), ...body };
    if (next.shopeeMode !== 'mock' && body.shopeeMode && (!next.partnerId || !(body.partnerKey ?? rc().partnerKey)))
      throw err.badRequest('shopee_not_configured', 'Cần nhập Partner ID và Partner Key trước khi chuyển sang chế độ sandbox / live');
    await saveRuntimeConfig(body, a.name);
    const changed = Object.keys(body).map((k) => (k === 'partnerKey' ? (body.partnerKey === null ? 'partnerKey:xóa' : 'partnerKey:đổi') : k));
    await audit(actorRef(a), 'settings_updated', { params: { section: 'integrations', fields: changed, shopeeMode: body.shopeeMode } });
    return { ok: true, ...describeRuntimeConfig() };
  });

  app.post('/api/settings/integrations/reset', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const body = parse(z.object({ fields: z.array(z.enum(['shopeeMode', 'partnerId', 'partnerKeyEnc', 'redirectUrl', 'timeoutMs', 'apiPublicUrl', 'expectedEgressIp', 'streamerMinVersion', 'streamerLostAfterSec', 'aiAllowPrivateHosts'])).min(1) }), req.body);
    await resetRuntimeFields(body.fields, a.name);
    await audit(actorRef(a), 'settings_updated', { params: { section: 'integrations', reset: body.fields } });
    return { ok: true, ...describeRuntimeConfig() };
  });

  // Kiểm tra Partner ID / Key (dùng khóa đang nhập, chưa cần lưu): gọi thử auth/access_token/get với refresh token giả.
  // Shopee trả lỗi chữ ký → sai khóa; trả lỗi refresh token → Partner ID/Key hợp lệ. Lệnh này không tính vào tỷ lệ gọi API của shop.
  app.post('/api/settings/shopee/test', async (req) => {
    requireRole(req, 'sysadmin');
    const body = parse(z.object({ shopeeMode: z.enum(['mock', 'sandbox', 'live']).optional(), partnerId: z.number().int().optional(), partnerKey: z.string().trim().optional() }), req.body);
    const mode = body.shopeeMode ?? rc().shopeeMode;
    const partnerId = body.partnerId ?? rc().partnerId;
    const partnerKey = body.partnerKey || rc().partnerKey;
    if (mode === 'mock') return { ok: true, mode, message: 'Chế độ giả lập không cần Partner ID / Key.' };
    if (!partnerId || !partnerKey) return { ok: false, mode, message: 'Thiếu Partner ID hoặc Partner Key.' };
    const host = mode === 'live' ? 'https://partner.shopeemobile.com' : 'https://partner.test-stable.shopeemobile.com';
    const path = '/api/v2/auth/access_token/get';
    const ts = Math.floor(Date.now() / 1000);
    const sign = hmacSha256Hex(partnerKey, `${partnerId}${path}${ts}`);
    const t0 = Date.now();
    try {
      const res = await fetch(`${host}${path}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'mexo-connection-test', shop_id: 1, partner_id: partnerId }),
        signal: AbortSignal.timeout(15000),
      });
      const data: any = await res.json().catch(() => ({}));
      const msg = `${data?.error ?? ''} ${data?.message ?? ''}`.toLowerCase();
      const latencyMs = Date.now() - t0;
      if (msg.includes('sign')) return { ok: false, mode, latencyMs, message: 'Shopee báo sai chữ ký — Partner Key không khớp với Partner ID.', shopee: { error: data?.error, message: data?.message, requestId: data?.request_id } };
      if (msg.includes('partner') && (msg.includes('invalid') || msg.includes('not exist') || msg.includes('not found')))
        return { ok: false, mode, latencyMs, message: 'Shopee không nhận Partner ID này (sai ID hoặc sai môi trường sandbox/live).', shopee: { error: data?.error, message: data?.message, requestId: data?.request_id } };
      return { ok: true, mode, latencyMs, message: 'Partner ID / Key hợp lệ — Shopee đã xác thực chữ ký.', shopee: { error: data?.error, message: data?.message, requestId: data?.request_id } };
    } catch (e) {
      return { ok: false, mode, message: `Không kết nối được tới Shopee (${host}): ${e instanceof Error ? e.message : e}` };
    }
  });

  // ───────────── Đóng băng hệ thống ─────────────
  app.post('/api/system/freeze', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const body = parse(z.object({ reason: z.string().trim().min(3, 'Cần ghi lý do').max(300) }), req.body);
    await setSetting('freeze', { frozen: true, reason: body.reason, at: new Date().toISOString(), by: a.name });
    await audit(actorRef(a), 'system_frozen', { params: { reason: body.reason } });
    events.emit('live', { type: 'alert' } satisfies LiveEvent);
    return { ok: true };
  });

  app.post('/api/system/unfreeze', async (req) => {
    const a = requireRole(req, 'sysadmin');
    const prev = await getSetting('freeze');
    await setSetting('freeze', { frozen: false, reason: null, at: null, by: null });
    await audit(actorRef(a), 'system_unfrozen', { params: { reason: prev.reason } });
    events.emit('live', { type: 'alert' } satisfies LiveEvent);
    return { ok: true };
  });

  // ───────────── Ảnh bìa ─────────────
  app.post('/api/files/cover', async (req) => {
    requireActor(req);
    const file = await req.file({ limits: { fileSize: 2 * 1024 * 1024 + 1 } });
    if (!file) throw err.badRequest('no_file', 'Chưa chọn ảnh');
    const buf = await file.toBuffer().catch(() => {
      throw err.badRequest('too_large', 'Ảnh bìa tối đa 2 MB');
    });
    if (buf.length > 2 * 1024 * 1024) throw err.badRequest('too_large', 'Ảnh bìa tối đa 2 MB');
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    if (!isPng && !isJpg) throw err.badRequest('bad_image', 'Ảnh bìa phải là JPG hoặc PNG');
    const key = `covers/${vnDate().slice(0, 7)}/${randomUUID()}.${isPng ? 'png' : 'jpg'}`;
    await writeFile(key, buf);
    await db.insert(files).values({ kind: 'cover', storageKey: key, mime: isPng ? 'image/png' : 'image/jpeg', sizeBytes: buf.length });
    return { key, url: `/api/files/cover?key=${encodeURIComponent(key)}` };
  });

  app.get('/api/files/cover', async (req, reply) => {
    requireActor(req);
    const { key } = parse(z.object({ key: z.string().regex(/^covers\/[\w-]+\/[\w-]+\.(png|jpg)$/) }), req.query);
    try {
      const data = await readFile(key);
      reply.header('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.send(data);
    } catch {
      throw err.notFound('Không tìm thấy ảnh');
    }
  });

  // ───────────── Sự kiện thời gian thực (SSE) ─────────────
  app.get('/api/events', async (req, reply) => {
    const a = requireActor(req, { allowMustChange: true });
    const ids = await visibleShopIds(a);
    const allowed = ids === null ? null : new Set(ids);
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(`retry: 3000\n\n`);
    let pending: LiveEvent[] = [];
    const flush = setInterval(() => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      reply.raw.write(`data: ${JSON.stringify(batch)}\n\n`);
    }, 1000);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25000);
    const onEvent = (ev: LiveEvent) => {
      if ('shopId' in ev && allowed && !allowed.has(ev.shopId)) return;
      if (pending.length < 200) pending.push(ev);
    };
    events.on('live', onEvent);
    req.raw.on('close', () => {
      clearInterval(flush);
      clearInterval(ping);
      events.off('live', onEvent);
    });
    return reply;
  });

  void addDays;
  void lte;
  void or;
}
