import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { foldVi, LIMITS, vnDate } from '@mexo/shared';
import ExcelJS from 'exceljs';
import { db } from '../db/client.js';
import { aiUsage, comments, liveSessions, replyLogs, replyRules, shops } from '../db/schema.js';
import { actorRef, requireActor, requireShop, visibleShopIds } from '../auth/auth.js';
import { decrypt } from '../lib/crypto.js';
import { err } from '../lib/errors.js';
import { idOf, parse, toCsv, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { resolveAlert } from '../services/alerts.js';
import { checkContent, FILTER_REASON_LABELS } from '../services/contentFilter.js';
import { decideReply } from '../services/comments.js';
import { getSetting } from '../services/settings.js';

const ruleSchema = z.object({
  topic: z.string().trim().min(1, 'Cần nhập chủ đề').max(80),
  keywords: z.array(z.string().trim().min(1).max(40)).min(1, 'Cần ít nhất 1 từ khóa').max(LIMITS.ruleKeywordsMax),
  sample: z.string().max(300).default(''),
  answer: z.string().trim().min(1, 'Cần nhập câu trả lời').max(LIMITS.ruleAnswerMax),
  enabled: z.boolean().default(true),
});

function lintAnswer(answer: string) {
  const c = checkContent(answer, { allowPromo: true });
  if (!c.ok) throw err.badRequest('content_blocked', `Câu trả lời vi phạm lớp lọc: ${c.reasons.map((r) => FILTER_REASON_LABELS[r]).join(', ')}`);
}

export async function replyRoutes(app: FastifyInstance) {
  app.get('/api/shops/:id/replies', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const ai = await getSetting('ai');
    const [u] = await db.select().from(aiUsage).where(and(eq(aiUsage.shopId, shop.id), eq(aiUsage.day, vnDate())));
    const [rc] = await db.select({ n: sql<number>`count(*)`, on: sql<number>`count(*) filter (where ${replyRules.enabled})` }).from(replyRules).where(eq(replyRules.shopId, shop.id));
    return {
      enabled: shop.replyEnabled,
      unmatched: shop.replyUnmatched,
      context: shop.replyContext,
      config: shop.replyConfig,
      disabledReason: shop.replyDisabledReason,
      commentPoll: shop.commentPoll,
      aiReady: Boolean(decrypt(ai.apiKeyEnc)),
      globalContext: ai.globalContext,
      aiUsedToday: u?.calls ?? 0,
      rules: { all: Number(rc?.n ?? 0), on: Number(rc?.on ?? 0) },
    };
  });

  app.put('/api/shops/:id/replies', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'comment.reply', 'write');
    const body = parse(
      z.object({
        enabled: z.boolean(),
        unmatched: z.enum(['none', 'ai']),
        context: z.string().max(3000).default(''),
        config: z
          .object({
            maxPerMinute: z.number().int().min(1).max(30),
            perViewerCooldownSec: z.number().int().min(0).max(3600),
            minGapSec: z.number().int().min(0).max(120),
            aiDailyBudget: z.number().int().min(0).max(10000),
            maxCommentAgeSec: z.number().int().min(10).max(1800),
          })
          .optional(),
      }),
      req.body,
    );
    const ai = await getSetting('ai');
    if (body.enabled && body.unmatched === 'ai' && !body.context.trim() && !ai.globalContext.trim())
      throw err.badRequest('context_required', 'Cần nhập đặc trưng của shop (hoặc quy định chung) trước khi bật AI trả lời');
    if (body.enabled && body.unmatched === 'ai' && !decrypt(ai.apiKeyEnc)) throw err.badRequest('ai_not_ready', 'Hệ thống chưa cấu hình AI');
    await db
      .update(shops)
      .set({ replyEnabled: body.enabled, replyUnmatched: body.unmatched, replyContext: body.context, ...(body.config ? { replyConfig: body.config } : {}), ...(body.enabled ? { replyDisabledReason: null } : {}) })
      .where(eq(shops.id, shop.id));
    if (body.enabled) await resolveAlert(`reply_disabled:${shop.id}`);
    await audit(actorRef(actor), 'reply_settings', { shopId: shop.id, params: { enabled: body.enabled, unmatched: body.unmatched } });
    return { ok: true };
  });

  app.post('/api/shops/:id/replies/try', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ comment: z.string().trim().min(1).max(300), unmatched: z.enum(['none', 'ai']).optional(), context: z.string().max(3000).optional() }), req.body);
    const tmp = { ...shop, replyUnmatched: body.unmatched ?? shop.replyUnmatched, replyContext: body.context ?? shop.replyContext };
    return decideReply(tmp, body.comment, { dryRun: true });
  });

  app.get('/api/shops/:id/reply-rules', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const items = await db.select().from(replyRules).where(eq(replyRules.shopId, shop.id)).orderBy(desc(replyRules.id));
    return { items, counts: { all: items.length, on: items.filter((i) => i.enabled).length, off: items.filter((i) => !i.enabled).length } };
  });

  app.post('/api/shops/:id/reply-rules', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'comment.reply', 'write');
    const body = parse(ruleSchema, req.body);
    lintAnswer(body.answer);
    const [cnt] = await db.select({ n: sql<number>`count(*)` }).from(replyRules).where(eq(replyRules.shopId, shop.id));
    if (Number(cnt?.n ?? 0) >= LIMITS.rulesPerShopMax) throw err.conflict('too_many_rules', `Mỗi shop tối đa ${LIMITS.rulesPerShopMax} kịch bản`);
    const [row] = await db.insert(replyRules).values({ ...body, shopId: shop.id }).returning();
    await audit(actorRef(actor), 'reply_rule', { shopId: shop.id, params: { topic: body.topic, action: 'create' } });
    return row;
  });

  app.put('/api/shops/:id/reply-rules/:rid', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'comment.reply', 'write');
    const body = parse(ruleSchema, req.body);
    lintAnswer(body.answer);
    const rid = idOf(req.params, 'rid');
    await db.update(replyRules).set({ ...body, disabledReason: null, updatedAt: new Date() }).where(and(eq(replyRules.id, rid), eq(replyRules.shopId, shop.id)));
    await resolveAlert(`rule_disabled:${rid}`);
    await audit(actorRef(actor), 'reply_rule', { shopId: shop.id, params: { topic: body.topic, action: 'update' } });
    return { ok: true };
  });

  app.delete('/api/shops/:id/reply-rules/:rid', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'comment.reply', 'write');
    await db.delete(replyRules).where(and(eq(replyRules.id, idOf(req.params, 'rid')), eq(replyRules.shopId, shop.id)));
    await audit(actorRef(actor), 'reply_rule', { shopId: shop.id, params: { action: 'delete' } });
    return { ok: true };
  });

  // Nhập kịch bản từ bảng tính (XLSX hoặc CSV): chủ đề, từ khóa, câu hỏi mẫu, câu trả lời
  app.post('/api/shops/:id/reply-rules/import', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'comment.reply', 'write');
    const file = await req.file();
    if (!file) throw err.badRequest('no_file', 'Chưa chọn file');
    const buf = await file.toBuffer();
    let rows: string[][] = [];
    if (/\.xlsx$/i.test(file.filename)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      ws?.eachRow((r) => rows.push((r.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: string }).text) : String(v)))));
    } else {
      rows = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
    }
    if (rows.length && /chu de|topic/i.test(foldVi(rows[0]![0] ?? ''))) rows = rows.slice(1);
    const existing = await db.select().from(replyRules).where(eq(replyRules.shopId, shop.id));
    const byTopic = new Map(existing.map((r) => [foldVi(r.topic), r]));
    let created = 0;
    let updated = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const [topic, kw, sample, answer] = rows[i]!.map((x) => (x ?? '').trim());
      if (!topic && !answer) continue;
      const keywords = (kw ?? '').split(/[,;|\n]/).map((k) => k.trim()).filter(Boolean).slice(0, LIMITS.ruleKeywordsMax);
      if (!topic || !answer || !keywords.length) {
        errors.push({ row: i + 2, message: 'Thiếu chủ đề, từ khóa hoặc câu trả lời' });
        continue;
      }
      const check = checkContent(answer, { allowPromo: true });
      if (!check.ok) {
        errors.push({ row: i + 2, message: `Vi phạm lớp lọc: ${check.reasons.map((r) => FILTER_REASON_LABELS[r]).join(', ')}` });
        continue;
      }
      const ex = byTopic.get(foldVi(topic));
      if (ex) {
        await db.update(replyRules).set({ keywords, sample: sample ?? '', answer: answer.slice(0, LIMITS.ruleAnswerMax), updatedAt: new Date() }).where(eq(replyRules.id, ex.id));
        updated++;
      } else {
        if (existing.length + created >= LIMITS.rulesPerShopMax) {
          errors.push({ row: i + 2, message: 'Vượt số kịch bản tối đa' });
          continue;
        }
        await db.insert(replyRules).values({ shopId: shop.id, topic: topic.slice(0, 80), keywords, sample: sample ?? '', answer: answer.slice(0, LIMITS.ruleAnswerMax) });
        created++;
      }
    }
    await audit(actorRef(actor), 'reply_rule', { shopId: shop.id, params: { action: 'import', created, updated } });
    return { created, updated, errors };
  });

  app.get('/api/shops/:id/reply-rules/export', async (req, reply) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const rows = await db.select().from(replyRules).where(eq(replyRules.shopId, shop.id));
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="kich-ban-tra-loi-${shop.shopeeShopId}.csv"`);
    return toCsv(['Chủ đề', 'Từ khóa', 'Câu hỏi mẫu', 'Câu trả lời', 'Bật'], rows.map((r) => [r.topic, r.keywords.join(', '), r.sample, r.answer, r.enabled ? 'có' : 'không']));
  });

  app.get('/api/shops/:id/reply-logs', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const q = parse(z.object({ status: z.string().optional(), source: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().max(200).default(50) }), req.query);
    const conds: SQL[] = [eq(replyLogs.shopId, shop.id)];
    if (q.status) conds.push(eq(replyLogs.status, q.status));
    if (q.source) conds.push(eq(replyLogs.source, q.source));
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(replyLogs).where(and(...conds))) as [{ n: number }];
    const items = await db.select().from(replyLogs).where(and(...conds)).orderBy(desc(replyLogs.at)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [stats] = await db
      .select({
        posted: sql<number>`count(*) filter (where ${replyLogs.status} = 'posted')`,
        blocked: sql<number>`count(*) filter (where ${replyLogs.status} = 'blocked')`,
        skipped: sql<number>`count(*) filter (where ${replyLogs.status} = 'skipped')`,
        failed: sql<number>`count(*) filter (where ${replyLogs.status} = 'failed')`,
        avgLatency: sql<number>`avg(${replyLogs.latencyMs}) filter (where ${replyLogs.status} = 'posted')`,
      })
      .from(replyLogs)
      .where(and(eq(replyLogs.shopId, shop.id), gte(replyLogs.at, new Date(Date.now() - 86400000))));
    return { items, total: Number(n), page: q.page, pageSize: q.pageSize, last24h: { posted: Number(stats?.posted ?? 0), blocked: Number(stats?.blocked ?? 0), skipped: Number(stats?.skipped ?? 0), failed: Number(stats?.failed ?? 0), avgLatencyMs: stats?.avgLatency ? Math.round(Number(stats.avgLatency)) : null } };
  });

  // Hộp bình luận nhiều shop (phiên đang live)
  app.get('/api/comments/inbox', async (req) => {
    const a = requireActor(req);
    const q = parse(z.object({ shopId: z.coerce.number().int().optional(), q: z.string().optional(), handled: z.string().optional(), after: z.coerce.number().int().optional(), limit: z.coerce.number().int().max(500).default(200) }), req.query);
    const ids = await visibleShopIds(a);
    const live = await db
      .select({ id: liveSessions.id, shopId: liveSessions.shopId, title: liveSessions.title, alias: shops.alias, shopeeName: shops.shopeeName })
      .from(liveSessions)
      .innerJoin(shops, eq(shops.id, liveSessions.shopId))
      .where(and(inArray(liveSessions.state, ['live', 'disconnected']), ids === null ? sql`true` : ids.length ? inArray(liveSessions.shopId, ids) : sql`false`));
    const sessions = q.shopId ? live.filter((l) => l.shopId === q.shopId) : live;
    if (!sessions.length) return { items: [], sessions: live.map((l) => ({ id: l.id, shopId: l.shopId, shopName: l.alias || l.shopeeName, title: l.title })) };
    const conds: SQL[] = [inArray(comments.sessionId, sessions.map((s) => s.id))];
    if (q.after) conds.push(sql`${comments.id} > ${q.after}`);
    if (q.handled === 'pending') conds.push(sql`${comments.handled} IS NULL`);
    else if (q.handled) conds.push(eq(comments.handled, q.handled));
    let rows = await db.select().from(comments).where(and(...conds)).orderBy(desc(comments.id)).limit(q.limit);
    if (q.q) {
      const f = foldVi(q.q);
      rows = rows.filter((r) => foldVi(r.content).includes(f) || foldVi(r.username).includes(f));
    }
    const smap = new Map(live.map((l) => [l.id, l]));
    return {
      items: rows.map((r) => ({ ...r, shopName: smap.get(r.sessionId)?.alias || smap.get(r.sessionId)?.shopeeName, sessionTitle: smap.get(r.sessionId)?.title })),
      sessions: live.map((l) => ({ id: l.id, shopId: l.shopId, shopName: l.alias || l.shopeeName, title: l.title })),
    };
  });
}

function parseCsv(text: string): string[][] {
  // Nhận dạng dấu phân cách theo dòng tiêu đề (Excel tiếng Việt thường xuất bằng dấu chấm phẩy)
  const head = text.split('\n', 1)[0] ?? '';
  const TAB = String.fromCharCode(9);
  const delim = head.includes(',') ? ',' : head.includes(';') ? ';' : head.includes(TAB) ? TAB : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
