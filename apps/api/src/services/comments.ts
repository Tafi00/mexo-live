import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { vnDate } from '@mexo/shared';
import { db } from '../db/client.js';
import { aiUsage, comments, liveSessions, products, replyLogs, replyRules, shops, templates } from '../db/schema.js';
import { err } from '../lib/errors.js';
import { aiReply } from './ai.js';
import { raiseAlert, resolveAlert } from './alerts.js';
import { audit, type ActorRef } from './audit.js';
import { checkContent, FILTER_REASON_LABELS, matchKeywords } from './contentFilter.js';
import { publish } from './events.js';
import { getSetting, isFrozen } from './settings.js';
import * as shopee from './shopee/index.js';
import { ShopeeError } from './shopee/index.js';

type ShopRow = typeof shops.$inferSelect;
type SessionRow = typeof liveSessions.$inferSelect;

// Trạng thái đọc bình luận theo phiên (trong bộ nhớ)
const offsets = new Map<number, string | null>();
const nextPollAt = new Map<number, number>();
const intervalMs = new Map<number, number>();
// Giới hạn trả lời
const postedTimes = new Map<number, number[]>(); // sessionId → các mốc đã đăng
const viewerLast = new Map<string, number>(); // shop:user → lần trả lời cuối
const postFailures = new Map<number, number>(); // shopId → lỗi gửi liên tiếp
const aiFailures = new Map<number, number>(); // shopId → lỗi AI liên tiếp
const aiPausedUntil = new Map<number, number>();
const queue = new Map<number, (typeof comments.$inferSelect)[]>(); // sessionId → hàng chờ trả lời
const working = new Set<number>();

const BASE_INTERVAL = 3000;

async function setPollState(shop: ShopRow, state: string, reason: string | null, until: Date | null, failures: number) {
  await db.update(shops).set({ commentPoll: { state, reason, until: until?.toISOString() ?? null, failures } }).where(eq(shops.id, shop.id));
}

/** Vòng đọc bình luận (2 giây/lần) */
export async function commentsTick(): Promise<void> {
  if (await isFrozen()) return;
  const live = await db
    .select({ s: liveSessions, shop: shops })
    .from(liveSessions)
    .innerJoin(shops, eq(shops.id, liveSessions.shopId))
    .where(inArray(liveSessions.state, ['live', 'disconnected']));
  const now = Date.now();
  await Promise.all(
    live.map(async ({ s, shop }) => {
      if (!s.shopeeSessionId || !(shop.connection === 'ok' || shop.connection === 'expiring')) return;
      const poll = shop.commentPoll;
      if ((poll.state === 'stopped' || poll.state === 'quarantine') && poll.until && Date.parse(poll.until) > now) return;
      if ((nextPollAt.get(s.id) ?? 0) > now) return;
      await pollSession(shop, s);
    }),
  );
  for (const id of [...offsets.keys()]) if (!live.find((l) => l.s.id === id)) {
    offsets.delete(id);
    nextPollAt.delete(id);
    intervalMs.delete(id);
    queue.delete(id);
  }
}

async function pollSession(shop: ShopRow, s: SessionRow): Promise<void> {
  const cur = intervalMs.get(s.id) ?? BASE_INTERVAL;
  try {
    const first = !offsets.has(s.id);
    const { comments: list, nextOffset } = await shopee.getLatestComments(shop, s.shopeeSessionId!, offsets.get(s.id) ?? null);
    offsets.set(s.id, nextOffset);
    intervalMs.set(s.id, BASE_INTERVAL);
    nextPollAt.set(s.id, Date.now() + BASE_INTERVAL);
    if (shop.commentPoll.state !== 'normal') await setPollState(shop, 'normal', null, null, 0);
    if (!list.length) return;
    const inserted = await db
      .insert(comments)
      .values(list.map((c) => ({ shopId: shop.id, sessionId: s.id, commentId: c.commentId, userId: c.userId, username: c.username, content: c.content.slice(0, 500), at: c.at })))
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    publish({ type: 'comment', shopId: shop.id, sessionId: s.id });
    // Lần đọc đầu sau khi khởi động: không trả lời tồn đọng
    if (first) return;
    const q = queue.get(s.id) ?? [];
    q.push(...inserted);
    queue.set(s.id, q.slice(-30));
    void drainQueue(shop.id, s.id);
  } catch (e) {
    const kind = e instanceof ShopeeError ? e.kind : 'unknown';
    const failures = shop.commentPoll.failures + 1;
    if (kind === 'rate_limit' || kind === 'server' || kind === 'timeout' || kind === 'network' || kind === 'circuit_open') {
      const next = Math.min(60000, cur * 2);
      intervalMs.set(s.id, next);
      nextPollAt.set(s.id, Date.now() + next);
      if (failures >= 20) {
        await setPollState(shop, 'quarantine', kind, new Date(Date.now() + 5 * 60000), failures);
      } else await setPollState(shop, 'backoff', kind, new Date(Date.now() + next), failures);
    } else if (kind === 'auth' || kind === 'permission') {
      await setPollState(shop, 'stopped', kind === 'auth' ? 'token' : 'permission', new Date(Date.now() + 10 * 60000), failures);
    } else if (kind === 'session_ended' || kind === 'session_invalid') {
      nextPollAt.set(s.id, Date.now() + 60000);
    } else {
      nextPollAt.set(s.id, Date.now() + 10000);
      await setPollState(shop, 'backoff', 'error', new Date(Date.now() + 10000), failures);
    }
  }
}

async function drainQueue(shopId: number, sessionId: number): Promise<void> {
  if (working.has(sessionId)) return;
  working.add(sessionId);
  try {
    for (;;) {
      const q = queue.get(sessionId);
      const c = q?.shift();
      if (!c) break;
      const [shop] = await db.select().from(shops).where(eq(shops.id, shopId));
      const [s] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
      if (!shop || !s || s.state !== 'live') break;
      if (!(await autoReplyEnabled(shop, s))) {
        queue.delete(sessionId);
        break;
      }
      await handleComment(shop, s, c);
    }
  } finally {
    working.delete(sessionId);
  }
}

async function autoReplyEnabled(shop: ShopRow, s: SessionRow): Promise<boolean> {
  if (await isFrozen()) return false;
  // Shop còn chạy ở hệ thống cũ: bên cũ đang trả lời, bên mới chỉ đọc bình luận
  if (shop.legacyHold) return false;
  // Ưu tiên: cài đặt riêng của phiên → của mẫu phát → của shop
  if (s.replyMode === 'off') return false;
  if (s.replyMode === 'on') return !shop.replyDisabledReason;
  if (s.templateId) {
    const [t] = await db.select({ mode: templates.replyMode }).from(templates).where(eq(templates.id, s.templateId));
    if (t?.mode === 'off') return false;
    if (t?.mode === 'on') return !shop.replyDisabledReason;
  }
  return shop.replyEnabled && !shop.replyDisabledReason;
}

export interface ReplyDecision {
  status: 'reply' | 'skip' | 'blocked' | 'handoff';
  source: 'rule' | 'ai' | null;
  answer: string | null;
  ruleId: number | null;
  reason: string | null;
  latencyMs: number;
}

/** Quyết định câu trả lời (dùng chung cho tự động và "Thử một câu hỏi") */
export async function decideReply(shop: ShopRow, comment: string, opts: { pinnedItemId?: number | null; dryRun?: boolean } = {}): Promise<ReplyDecision> {
  const t0 = Date.now();
  const rules = await db.select().from(replyRules).where(and(eq(replyRules.shopId, shop.id), eq(replyRules.enabled, true)));
  let best: (typeof rules)[number] | null = null;
  let bestHits = 0;
  for (const r of rules) {
    const hits = matchKeywords(comment, r.keywords);
    if (hits > bestHits) {
      best = r;
      bestHits = hits;
    }
  }
  if (best) {
    const check = checkContent(best.answer, { allowPromo: true });
    if (!check.ok) {
      if (!opts.dryRun) {
        await db.update(replyRules).set({ enabled: false, disabledReason: check.reasons.map((r) => FILTER_REASON_LABELS[r]).join(', ') }).where(eq(replyRules.id, best.id));
        await raiseAlert({ key: `rule_disabled:${best.id}`, type: 'rule_disabled', severity: 'warning', shopId: shop.id, message: `${shop.alias || shop.shopeeName}: kịch bản "${best.topic}" bị tắt (${check.reasons.map((r) => FILTER_REASON_LABELS[r]).join(', ')})` });
      }
      return { status: 'blocked', source: 'rule', answer: best.answer, ruleId: best.id, reason: check.reasons.map((r) => FILTER_REASON_LABELS[r]).join(', '), latencyMs: Date.now() - t0 };
    }
    return { status: 'reply', source: 'rule', answer: best.answer, ruleId: best.id, reason: null, latencyMs: Date.now() - t0 };
  }
  if (shop.replyUnmatched !== 'ai') return { status: 'skip', source: null, answer: null, ruleId: null, reason: 'Không khớp kịch bản', latencyMs: Date.now() - t0 };
  if (!shop.replyContext.trim() && !(await getSetting('ai')).globalContext.trim())
    return { status: 'skip', source: null, answer: null, ruleId: null, reason: 'Chưa có thông tin shop cho AI', latencyMs: Date.now() - t0 };

  if (!opts.dryRun) {
    if ((aiPausedUntil.get(shop.id) ?? 0) > Date.now()) return { status: 'skip', source: 'ai', answer: null, ruleId: null, reason: 'AI tạm dừng do lỗi liên tiếp', latencyMs: 0 };
    const day = vnDate();
    const [u] = await db.select().from(aiUsage).where(and(eq(aiUsage.shopId, shop.id), eq(aiUsage.day, day)));
    if ((u?.calls ?? 0) >= shop.replyConfig.aiDailyBudget) {
      await raiseAlert({ key: `ai_budget:${shop.id}:${day}`, type: 'ai_budget', severity: 'info', shopId: shop.id, message: `${shop.alias || shop.shopeeName}: hết ${shop.replyConfig.aiDailyBudget} lượt AI hôm nay` });
      return { status: 'skip', source: 'ai', answer: null, ruleId: null, reason: 'Hết lượt AI trong ngày', latencyMs: 0 };
    }
  }
  let pinned: { name: string; sku: string | null; stock: number | null } | null = null;
  if (opts.pinnedItemId) {
    const [p] = await db.select().from(products).where(and(eq(products.shopId, shop.id), eq(products.itemId, opts.pinnedItemId)));
    if (p) pinned = { name: p.name, sku: p.sku, stock: p.stock };
  }
  const cart = await db.select({ name: products.name }).from(products).where(and(eq(products.shopId, shop.id), eq(products.removed, false))).orderBy(desc(products.sold)).limit(10);
  try {
    const r = await aiReply({ comment, shopName: shop.alias || shop.shopeeName, shopContext: shop.replyContext, pinnedProduct: pinned, cartProducts: cart.map((c) => c.name) });
    if (!opts.dryRun) {
      aiFailures.set(shop.id, 0);
      await db
        .insert(aiUsage)
        .values({ shopId: shop.id, day: vnDate(), calls: 1 })
        .onConflictDoUpdate({ target: [aiUsage.shopId, aiUsage.day], set: { calls: sql`${aiUsage.calls} + 1` } });
    }
    if (r.action === 'handoff') return { status: 'handoff', source: 'ai', answer: null, ruleId: null, reason: 'AI chuyển cho nhân viên', latencyMs: Date.now() - t0 };
    if (r.action === 'skip') return { status: 'skip', source: 'ai', answer: null, ruleId: null, reason: 'Không cần trả lời', latencyMs: Date.now() - t0 };
    const check = checkContent(r.answer!);
    if (!check.ok) return { status: 'blocked', source: 'ai', answer: r.answer, ruleId: null, reason: check.reasons.map((x) => FILTER_REASON_LABELS[x]).join(', '), latencyMs: Date.now() - t0 };
    return { status: 'reply', source: 'ai', answer: r.answer, ruleId: null, reason: null, latencyMs: Date.now() - t0 };
  } catch (e) {
    if (!opts.dryRun) {
      const f = (aiFailures.get(shop.id) ?? 0) + 1;
      aiFailures.set(shop.id, f);
      await db
        .insert(aiUsage)
        .values({ shopId: shop.id, day: vnDate(), calls: 0, failures: 1 })
        .onConflictDoUpdate({ target: [aiUsage.shopId, aiUsage.day], set: { failures: sql`${aiUsage.failures} + 1` } });
      if (f >= 5) aiPausedUntil.set(shop.id, Date.now() + 5 * 60000);
    }
    return { status: 'skip', source: 'ai', answer: null, ruleId: null, reason: `AI lỗi: ${e instanceof Error ? e.message : e}`, latencyMs: Date.now() - t0 };
  }
}

async function handleComment(shop: ShopRow, s: SessionRow, c: typeof comments.$inferSelect): Promise<void> {
  const cfg = shop.replyConfig;
  const now = Date.now();
  const logBase = { shopId: shop.id, sessionId: s.id, comment: c.content.slice(0, 200) };
  const mark = (handled: string) => db.update(comments).set({ handled }).where(eq(comments.id, c.id));
  if (now - c.at.getTime() > cfg.maxCommentAgeSec * 1000) {
    await mark('skipped');
    return;
  }
  const vk = `${shop.id}:${c.userId ?? c.username}`;
  if (now - (viewerLast.get(vk) ?? 0) < cfg.perViewerCooldownSec * 1000) {
    await mark('skipped');
    return;
  }
  const times = (postedTimes.get(s.id) ?? []).filter((t) => now - t < 60000);
  if (times.length >= cfg.maxPerMinute) {
    await mark('skipped');
    await db.insert(replyLogs).values({ ...logBase, status: 'skipped', source: 'rule', reason: `Vượt ${cfg.maxPerMinute} câu/phút` });
    return;
  }
  const decision = await decideReply(shop, c.content, { pinnedItemId: s.pinnedItemId });
  if (decision.status === 'skip') {
    await mark('skipped');
    if (decision.source) await db.insert(replyLogs).values({ ...logBase, status: 'skipped', source: decision.source, reason: decision.reason, latencyMs: decision.latencyMs });
    return;
  }
  if (decision.status === 'handoff') {
    await mark('escalated');
    await db.insert(replyLogs).values({ ...logBase, status: 'skipped', source: 'ai', reason: 'Chuyển nhân viên xử lý', latencyMs: decision.latencyMs });
    publish({ type: 'comment', shopId: shop.id, sessionId: s.id });
    return;
  }
  if (decision.status === 'blocked') {
    await mark('blocked');
    await db.insert(replyLogs).values({ ...logBase, answer: decision.answer?.slice(0, 300), status: 'blocked', source: decision.source!, ruleId: decision.ruleId, reason: decision.reason, latencyMs: decision.latencyMs });
    return;
  }
  // Giữ khoảng cách tối thiểu giữa 2 câu
  const lastPost = times[times.length - 1] ?? 0;
  const wait = cfg.minGapSec * 1000 - (now - lastPost);
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 15000)));
  try {
    await shopee.postComment(shop, s.shopeeSessionId!, decision.answer!);
    postedTimes.set(s.id, [...times, Date.now()]);
    viewerLast.set(vk, Date.now());
    postFailures.set(shop.id, 0);
    await mark('replied');
    if (decision.ruleId) await db.update(replyRules).set({ hits: sql`${replyRules.hits} + 1` }).where(eq(replyRules.id, decision.ruleId));
    await db.insert(replyLogs).values({ ...logBase, answer: decision.answer!.slice(0, 300), status: 'posted', source: decision.source!, ruleId: decision.ruleId, latencyMs: Date.now() - c.at.getTime() });
    if (s.replyState !== 'ok') await db.update(liveSessions).set({ replyState: 'ok' }).where(eq(liveSessions.id, s.id));
    await resolveAlert(`reply_disabled:${shop.id}`);
  } catch (e) {
    const f = (postFailures.get(shop.id) ?? 0) + 1;
    postFailures.set(shop.id, f);
    await mark('failed');
    await db.insert(replyLogs).values({ ...logBase, answer: decision.answer!.slice(0, 300), status: 'failed', source: decision.source!, ruleId: decision.ruleId, reason: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    await db.update(liveSessions).set({ replyState: 'attn' }).where(eq(liveSessions.id, s.id));
    if (f >= 5) {
      await db.update(shops).set({ replyDisabledReason: `Tự tắt do ${f} lần gửi lỗi liên tiếp` }).where(eq(shops.id, shop.id));
      await raiseAlert({ key: `reply_disabled:${shop.id}`, type: 'reply_disabled', severity: 'warning', shopId: shop.id, message: `${shop.alias || shop.shopeeName}: trả lời tự động đã tắt do gửi lỗi liên tiếp` });
    }
  }
  publish({ type: 'comment', shopId: shop.id, sessionId: s.id });
}

/** Trả lời thủ công từ dashboard (vẫn qua lớp lọc; nhân viên có thể gửi dù cảnh báo nhẹ) */
export async function manualReply(actor: ActorRef, shop: ShopRow, s: SessionRow, text: string, force = false) {
  if (s.state !== 'live') throw err.conflict('not_live', 'Chỉ gửi bình luận khi phiên đang live');
  const check = checkContent(text, { allowPromo: true, maxLen: 300 });
  const hard = check.reasons.filter((r) => ['link', 'phone', 'external_contact', 'offensive', 'other_platform', 'empty', 'too_long'].includes(r));
  if (hard.length) throw err.badRequest('content_blocked', `Nội dung bị chặn: ${hard.map((r) => FILTER_REASON_LABELS[r]).join(', ')}`);
  if (!check.ok && !force) throw err.conflict('content_warning', `Cảnh báo: ${check.reasons.map((r) => FILTER_REASON_LABELS[r]).join(', ')}. Gửi lại với xác nhận nếu vẫn muốn đăng.`);
  const t0 = Date.now();
  try {
    await shopee.postComment(shop, s.shopeeSessionId!, text);
  } catch (e) {
    await db.insert(replyLogs).values({ shopId: shop.id, sessionId: s.id, comment: '(thủ công)', answer: text.slice(0, 300), status: 'failed', source: 'manual', actorId: actor.id, reason: e instanceof Error ? e.message : String(e) });
    throw err.badRequest('post_failed', `Shopee không nhận bình luận: ${e instanceof Error ? e.message : e}`);
  }
  await db.insert(replyLogs).values({ shopId: shop.id, sessionId: s.id, comment: '(thủ công)', answer: text.slice(0, 300), status: 'posted', source: 'manual', actorId: actor.id, latencyMs: Date.now() - t0 });
  await audit(actor, 'comment_posted', { shopId: shop.id, params: { sessionId: s.shopeeSessionId } });
  publish({ type: 'comment', shopId: shop.id, sessionId: s.id });
}

export async function replyToComment(actor: ActorRef, shop: ShopRow, s: SessionRow, commentRowId: number, text: string, force = false) {
  await manualReply(actor, shop, s, text, force);
  await db.update(comments).set({ handled: 'replied' }).where(eq(comments.id, commentRowId));
}
