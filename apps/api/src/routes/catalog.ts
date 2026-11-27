import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { foldVi, LIMITS } from '@mexo/shared';
import { db } from '../db/client.js';
import { accounts, products, schedules, templateItems, templates, videoFolders, videos } from '../db/schema.js';
import { actorRef, requireShop } from '../auth/auth.js';
import { err } from '../lib/errors.js';
import { idOf, parse, z } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { isSyncing, parseItemRefs, productCounts, startProductSync } from '../services/products.js';
import * as shopee from '../services/shopee/index.js';
import { appendChunk, fileSize, readHead, removeFile, sendFile, truncateTo } from '../services/storage.js';
import { loadTemplateFull } from '../services/templates.js';
import { probeVideo } from '../services/videoProbe.js';
import { getSetting } from '../services/settings.js';

const VIDEO_NAME = z
  .string()
  .trim()
  .min(1, 'Tên video không được trống')
  .max(LIMITS.videoNameMax)
  .refine((s) => !/[<>|]/.test(s), 'Tên không được chứa < > |')
  .refine((s) => !s.endsWith('.'), 'Tên không được kết thúc bằng dấu chấm');

function productDto(p: typeof products.$inferSelect) {
  return {
    id: p.id,
    itemId: p.itemId,
    number: p.number,
    name: p.name,
    sku: p.sku,
    imageUrl: p.imageUrl,
    price: p.price,
    originalPrice: p.originalPrice,
    currency: p.currency,
    stock: p.stock,
    sold: p.sold,
    rating: p.rating,
    likes: p.likes,
    removed: p.removed,
    models: p.models,
    syncedAt: p.syncedAt,
  };
}

async function shopStorageUsed(shopId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`coalesce(sum(${videos.uploadedBytes}),0)` }).from(videos).where(eq(videos.shopId, shopId));
  return Number(r?.n ?? 0);
}

async function quotaFor(shopId: number, ownerId: number | null): Promise<number> {
  const limits = await getSetting('limits');
  if (ownerId) {
    const [o] = await db.select({ q: accounts.storageQuotaBytes }).from(accounts).where(eq(accounts.id, ownerId));
    if (o?.q) return o.q;
  }
  void shopId;
  return limits.defaultStorageQuotaGb * 1024 ** 3;
}

export async function catalogRoutes(app: FastifyInstance) {
  // Nhận thân request dạng nhị phân cho upload theo đoạn
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: LIMITS.uploadChunkBytes + 1024 }, (_req, body, done) => done(null, body));

  // ───────────── Sản phẩm ─────────────
  app.get('/api/shops/:id/products', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const q = parse(
      z.object({
        q: z.string().optional(),
        filter: z.enum(['all', 'low', 'out', 'removed', 'instock']).default('all'),
        sort: z.enum(['number', 'name', 'price_asc', 'price_desc', 'sold', 'stock']).default('number'),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );
    const conds: SQL[] = [eq(products.shopId, shop.id)];
    if (q.filter === 'removed') conds.push(eq(products.removed, true));
    else conds.push(eq(products.removed, false));
    if (q.filter === 'low') conds.push(sql`${products.stock} > 0 and ${products.stock} <= 10`);
    if (q.filter === 'out') conds.push(sql`coalesce(${products.stock},0) <= 0`);
    if (q.filter === 'instock') conds.push(sql`${products.stock} > 0`);
    if (q.q) {
      const f = foldVi(q.q);
      conds.push(sql`(${products.searchText} LIKE ${'%' + f + '%'} OR CAST(${products.itemId} AS TEXT) = ${q.q.trim()})`);
    }
    const order = {
      number: asc(products.number),
      name: asc(products.name),
      price_asc: asc(products.price),
      price_desc: desc(products.price),
      sold: desc(products.sold),
      stock: asc(products.stock),
    }[q.sort];
    const where = and(...conds);
    const [{ n }] = (await db.select({ n: sql<number>`count(*)` }).from(products).where(where)) as [{ n: number }];
    const rows = await db.select().from(products).where(where).orderBy(order, asc(products.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return { items: rows.map(productDto), total: Number(n), page: q.page, pageSize: q.pageSize, counts: await productCounts(shop.id), sync: { ...shop.productSync, running: isSyncing(shop.id) } };
  });

  app.post('/api/shops/:id/products/sync', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'product.manage', 'write');
    if (shop.connection !== 'ok' && shop.connection !== 'expiring') throw err.conflict('shop_disconnected', 'Shop chưa kết nối Shopee');
    await startProductSync(shop, actorRef(actor));
    return { ok: true };
  });

  app.get('/api/shops/:id/products/:pid/models', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const [p] = await db.select().from(products).where(and(eq(products.id, idOf(req.params, 'pid')), eq(products.shopId, shop.id)));
    if (!p) throw err.notFound();
    const models = await shopee.getModelList(shop, p.itemId);
    await db.update(products).set({ models }).where(eq(products.id, p.id));
    return { models };
  });

  // Dán danh sách mã/link → khớp với danh mục
  app.post('/api/shops/:id/products/resolve', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ text: z.string().max(200000) }), req.body);
    const ids = parseItemRefs(body.text, LIMITS.pasteMaxItems);
    const rows = ids.length ? await db.select().from(products).where(and(eq(products.shopId, shop.id), inArray(products.itemId, ids))) : [];
    const map = new Map(rows.map((r) => [r.itemId, r]));
    return { items: ids.map((id) => ({ itemId: id, product: map.get(id) ? productDto(map.get(id)!) : null })) };
  });

  // Khớp từng dòng (giữ nguyên thứ tự, không gộp trùng): nhận item ID, link Shopee hoặc SKU
  app.post('/api/shops/:id/products/resolve-lines', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ lines: z.array(z.string().max(500)).max(LIMITS.pasteMaxItems) }), req.body);
    const parsed = body.lines.map((raw) => {
      const line = raw.trim();
      const ids = parseItemRefs(line, 1);
      return { line, itemId: ids[0] ?? null, sku: ids.length ? null : line };
    });
    const itemIds = [...new Set(parsed.map((p) => p.itemId).filter((x): x is number => x !== null))];
    const skus = [...new Set(parsed.map((p) => p.sku?.toLowerCase()).filter((x): x is string => Boolean(x)))];
    const byId = itemIds.length ? await db.select().from(products).where(and(eq(products.shopId, shop.id), inArray(products.itemId, itemIds))) : [];
    const bySku = skus.length
      ? await db.select().from(products).where(and(eq(products.shopId, shop.id), inArray(sql`lower(${products.sku})`, skus)))
      : [];
    const idMap = new Map(byId.map((p) => [p.itemId, p]));
    const skuMap = new Map<string, typeof products.$inferSelect>();
    for (const p of bySku) if (p.sku && (!skuMap.has(p.sku.toLowerCase()) || !p.removed)) skuMap.set(p.sku.toLowerCase(), p);
    return {
      items: parsed.map((p) => {
        const prod = p.itemId !== null ? idMap.get(p.itemId) : p.sku ? skuMap.get(p.sku.toLowerCase()) : undefined;
        return { line: p.line, matchedBy: prod ? (p.itemId !== null ? 'id' : 'sku') : null, itemId: p.itemId, product: prod ? productDto(prod) : null };
      }),
    };
  });

  app.post('/api/shops/:id/products/by-ids', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const body = parse(z.object({ ids: z.array(z.number().int()).max(1000) }), req.body);
    const rows = body.ids.length ? await db.select().from(products).where(and(eq(products.shopId, shop.id), inArray(products.id, body.ids))) : [];
    return { items: rows.map(productDto) };
  });

  // ───────────── Thư mục video ─────────────
  app.get('/api/shops/:id/video-folders', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const rows = await db.select().from(videoFolders).where(eq(videoFolders.shopId, shop.id)).orderBy(asc(videoFolders.name));
    return { items: rows };
  });
  app.post('/api/shops/:id/video-folders', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    const [row] = await db.insert(videoFolders).values({ shopId: shop.id, name: body.name }).returning();
    return row;
  });
  app.patch('/api/shops/:id/video-folders/:fid', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const body = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    await db.update(videoFolders).set({ name: body.name }).where(and(eq(videoFolders.id, idOf(req.params, 'fid')), eq(videoFolders.shopId, shop.id)));
    return { ok: true };
  });
  app.delete('/api/shops/:id/video-folders/:fid', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const fid = idOf(req.params, 'fid');
    await db.update(videos).set({ folderId: null }).where(and(eq(videos.folderId, fid), eq(videos.shopId, shop.id)));
    await db.delete(videoFolders).where(and(eq(videoFolders.id, fid), eq(videoFolders.shopId, shop.id)));
    return { ok: true };
  });

  // ───────────── Video ─────────────
  app.get('/api/shops/:id/videos', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const q = parse(z.object({ q: z.string().optional(), folderId: z.string().optional(), status: z.string().optional() }), req.query);
    const rows = await db.select().from(videos).where(eq(videos.shopId, shop.id)).orderBy(asc(videos.number), asc(videos.id));
    const usage = await db
      .select({ videoId: templateItems.videoId, n: sql<number>`count(distinct ${templateItems.templateId})` })
      .from(templateItems)
      .innerJoin(templates, eq(templates.id, templateItems.templateId))
      .where(eq(templates.shopId, shop.id))
      .groupBy(templateItems.videoId);
    const umap = new Map(usage.map((u) => [u.videoId, Number(u.n)]));
    let items = rows.map((v) => ({ ...v, templateCount: umap.get(v.id) ?? 0 }));
    const counts = {
      all: items.length,
      ready: items.filter((v) => v.status === 'ready').length,
      uploading: items.filter((v) => v.status === 'uploading').length,
      processing: items.filter((v) => v.status === 'processing').length,
      missing_file: items.filter((v) => v.status === 'missing_file').length,
      failed: items.filter((v) => v.status === 'failed').length,
    };
    if (q.status && q.status !== 'all') items = items.filter((v) => v.status === q.status);
    if (q.folderId) items = items.filter((v) => (q.folderId === 'none' ? !v.folderId : String(v.folderId) === q.folderId));
    if (q.q) {
      const f = foldVi(q.q);
      items = items.filter((v) => foldVi(v.name).includes(f) || foldVi(v.sourceFileName).includes(f));
    }
    const used = await shopStorageUsed(shop.id);
    return { items, counts, storage: { usedBytes: used, quotaBytes: await quotaFor(shop.id, shop.ownerId) } };
  });

  // Bắt đầu hoặc tiếp tục tải lên (resumable)
  app.post('/api/shops/:id/videos/uploads', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const body = parse(
      z.object({
        fileName: z.string().min(1).max(255),
        sizeBytes: z.number().int().min(0),
        lastModified: z.number().optional(),
        durationSec: z.number().min(0).nullable().optional(),
        width: z.number().int().nullable().optional(),
        height: z.number().int().nullable().optional(),
        mime: z.string().max(100).optional(),
        folderId: z.number().int().nullable().optional(),
        name: z.string().optional(),
      }),
      req.body,
    );
    if (body.sizeBytes === 0) throw err.badRequest('empty_file', 'File rỗng (0 byte)');
    if (body.sizeBytes > 4 * 1024 ** 3) throw err.badRequest('file_too_large', 'File vượt quá 4 GB');
    if (!/\.(mp4|mov|m4v|mkv|webm|flv|ts)$/i.test(body.fileName)) throw err.badRequest('bad_format', 'Định dạng không hỗ trợ (dùng MP4, MOV, MKV, WEBM, FLV, TS)');
    const fingerprint = `${body.fileName}|${body.sizeBytes}|${body.lastModified ?? ''}`;
    const [resume] = await db
      .select()
      .from(videos)
      .where(and(eq(videos.shopId, shop.id), eq(videos.fileFingerprint, fingerprint), inArray(videos.status, ['uploading', 'failed', 'missing_file'])));
    if (resume) {
      let onDisk = resume.storageKey ? await fileSize(resume.storageKey) : 0;
      // File đã đủ dung lượng nhưng bị lỗi kiểm tra → tải lại từ đầu để kiểm tra lại (tránh kẹt ở trạng thái "đang tải lên")
      if (resume.storageKey && onDisk >= resume.sizeBytes) {
        await truncateTo(resume.storageKey, 0);
        onDisk = 0;
      }
      await db.update(videos).set({ uploadedBytes: onDisk, status: 'uploading', failReason: null, updatedAt: new Date() }).where(eq(videos.id, resume.id));
      return { videoId: resume.id, uploadedBytes: onDisk, resumed: true, chunkBytes: LIMITS.uploadChunkBytes };
    }
    // Video nhập từ hệ thống cũ (chưa có file): tải lại đúng file gốc (cùng tên + dung lượng) sẽ gắn vào video cũ, giữ nguyên mẫu phát
    const [legacy] = await db
      .select()
      .from(videos)
      .where(and(eq(videos.shopId, shop.id), eq(videos.status, 'missing_file'), eq(videos.sourceFileName, body.fileName), eq(videos.sizeBytes, body.sizeBytes)));
    if (legacy) {
      const ext = body.fileName.split('.').pop()!.toLowerCase();
      await db
        .update(videos)
        .set({ status: 'uploading', uploadedBytes: 0, fileFingerprint: fingerprint, storageKey: `videos/${shop.id}/${legacy.id}.${ext}`, durationSec: body.durationSec ?? legacy.durationSec, mime: body.mime ?? null, failReason: null, updatedAt: new Date() })
        .where(eq(videos.id, legacy.id));
      return { videoId: legacy.id, uploadedBytes: 0, resumed: false, relinked: true, chunkBytes: LIMITS.uploadChunkBytes };
    }
    const [pending] = await db.select({ n: sql<number>`count(*)` }).from(videos).where(and(eq(videos.shopId, shop.id), eq(videos.status, 'uploading')));
    if (Number(pending?.n ?? 0) >= 20) throw err.conflict('too_many_pending', 'Có quá nhiều file đang tải dở, hãy hoàn tất hoặc xóa bớt');
    const used = await shopStorageUsed(shop.id);
    const quota = await quotaFor(shop.id, shop.ownerId);
    if (used + body.sizeBytes > quota) throw err.conflict('quota_exceeded', `Shop hết dung lượng lưu trữ (${(used / 1024 ** 3).toFixed(1)}/${(quota / 1024 ** 3).toFixed(0)} GB)`);
    let name = (body.name ?? body.fileName.replace(/\.[^.]+$/, '')).trim().replace(/[<>|]/g, '').replace(/\.+$/, '').slice(0, LIMITS.videoNameMax) || 'video';
    const existingNames = new Set((await db.select({ name: videos.name }).from(videos).where(eq(videos.shopId, shop.id))).map((v) => v.name.toLowerCase()));
    if (existingNames.has(name.toLowerCase())) {
      let i = 2;
      while (existingNames.has(`${name} (${i})`.toLowerCase())) i++;
      name = `${name} (${i})`;
    }
    const [{ n: maxNum }] = (await db.select({ n: sql<number>`coalesce(max(${videos.number}),0)` }).from(videos).where(eq(videos.shopId, shop.id))) as [{ n: number }];
    const ext = body.fileName.split('.').pop()!.toLowerCase();
    const [row] = await db
      .insert(videos)
      .values({
        shopId: shop.id,
        number: Number(maxNum) + 1,
        folderId: body.folderId ?? null,
        name,
        sourceFileName: body.fileName,
        fileFingerprint: fingerprint,
        sizeBytes: body.sizeBytes,
        durationSec: body.durationSec ?? null,
        width: body.width ?? null,
        height: body.height ?? null,
        mime: body.mime ?? null,
        status: 'uploading',
        createdBy: actor.id,
      })
      .returning();
    await db.update(videos).set({ storageKey: `videos/${shop.id}/${row!.id}.${ext}` }).where(eq(videos.id, row!.id));
    return { videoId: row!.id, uploadedBytes: 0, resumed: false, chunkBytes: LIMITS.uploadChunkBytes };
  });

  app.put('/api/shops/:id/videos/:vid/chunk', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const vid = idOf(req.params, 'vid');
    const { offset } = parse(z.object({ offset: z.coerce.number().int().min(0) }), req.query);
    const [v] = await db.select().from(videos).where(and(eq(videos.id, vid), eq(videos.shopId, shop.id)));
    if (!v || !v.storageKey) throw err.notFound('Không tìm thấy video');
    if (v.status !== 'uploading') throw err.conflict('not_uploading', 'Video không ở trạng thái đang tải lên');
    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) throw err.badRequest('empty_chunk', 'Đoạn dữ liệu rỗng');
    const onDisk = await fileSize(v.storageKey);
    if (offset !== onDisk) return { uploadedBytes: onDisk, mismatch: true };
    if (onDisk + data.length > v.sizeBytes) {
      await truncateTo(v.storageKey, onDisk);
      throw err.badRequest('size_mismatch', 'Lệch dung lượng so với khai báo');
    }
    const size = await appendChunk(v.storageKey, data);
    await db.update(videos).set({ uploadedBytes: size, updatedAt: new Date() }).where(eq(videos.id, v.id));
    if (size === v.sizeBytes) {
      await db.update(videos).set({ status: 'processing' }).where(eq(videos.id, v.id));
      // Kiểm tra định dạng & chất lượng
      const head = await readHead(v.storageKey, 64);
      const probe = await probeVideo(v.storageKey, head);
      if (!probe.ok) {
        await db.update(videos).set({ status: 'failed', failReason: probe.reason }).where(eq(videos.id, v.id));
        return { uploadedBytes: size, status: 'failed', failReason: probe.reason };
      }
      await db
        .update(videos)
        .set({
          status: 'ready',
          durationSec: probe.durationSec ?? v.durationSec,
          width: probe.width ?? v.width,
          height: probe.height ?? v.height,
          codec: probe.codec ?? null,
          bitrate: probe.bitrate ?? null,
          updatedAt: new Date(),
        })
        .where(eq(videos.id, v.id));
      await audit(actorRef(actor), 'video_uploaded', { shopId: shop.id, params: { name: v.name, sizeBytes: v.sizeBytes } });
      return { uploadedBytes: size, status: 'ready' };
    }
    return { uploadedBytes: size, status: 'uploading' };
  });

  app.patch('/api/shops/:id/videos/:vid', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const vid = idOf(req.params, 'vid');
    const body = parse(z.object({ name: VIDEO_NAME.optional(), folderId: z.number().int().nullable().optional() }), req.body);
    const [v] = await db.select().from(videos).where(and(eq(videos.id, vid), eq(videos.shopId, shop.id)));
    if (!v) throw err.notFound();
    if (body.name && body.name.toLowerCase() !== v.name.toLowerCase()) {
      const [dup] = await db.select({ id: videos.id }).from(videos).where(and(eq(videos.shopId, shop.id), sql`lower(${videos.name}) = ${body.name.toLowerCase()}`));
      if (dup) throw err.conflict('duplicate_name', 'Tên video đã tồn tại trong shop');
    }
    await db.update(videos).set({ ...(body.name ? { name: body.name } : {}), ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), updatedAt: new Date() }).where(eq(videos.id, vid));
    if (body.name && body.name !== v.name) await audit(actorRef(actor), 'video_renamed', { shopId: shop.id, params: { from: v.name, to: body.name } });
    return { ok: true };
  });

  async function deleteVideos(shopId: number, ids: number[], actor: ReturnType<typeof actorRef>) {
    const used = ids.length
      ? await db
          .select({ videoId: templateItems.videoId, name: templates.name })
          .from(templateItems)
          .innerJoin(templates, eq(templates.id, templateItems.templateId))
          .where(and(inArray(templateItems.videoId, ids), eq(templates.shopId, shopId)))
      : [];
    const blocked = new Set(used.map((u) => u.videoId));
    const rows = ids.length ? await db.select().from(videos).where(and(eq(videos.shopId, shopId), inArray(videos.id, ids))) : [];
    const deleted: number[] = [];
    for (const v of rows) {
      if (blocked.has(v.id)) continue;
      await removeFile(v.storageKey);
      await db.delete(videos).where(eq(videos.id, v.id));
      deleted.push(v.id);
      await audit(actor, 'video_deleted', { shopId, params: { name: v.name } });
    }
    return { deleted, blocked: rows.filter((v) => blocked.has(v.id)).map((v) => ({ id: v.id, name: v.name, templates: used.filter((u) => u.videoId === v.id).map((u) => u.name) })) };
  }

  app.delete('/api/shops/:id/videos/:vid', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const r = await deleteVideos(shop.id, [idOf(req.params, 'vid')], actorRef(actor));
    if (r.blocked.length) throw err.conflict('video_in_use', `Video đang nằm trong mẫu phát: ${r.blocked[0]!.templates.join(', ')}`);
    return { ok: true };
  });

  app.post('/api/shops/:id/videos/bulk-delete', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'video.manage', 'write');
    const body = parse(z.object({ ids: z.array(z.number().int()).min(1).max(500) }), req.body);
    return deleteVideos(shop.id, body.ids, actorRef(actor));
  });

  app.get('/api/shops/:id/videos/:vid/file', async (req, reply) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const [v] = await db.select().from(videos).where(and(eq(videos.id, idOf(req.params, 'vid')), eq(videos.shopId, shop.id)));
    if (!v?.storageKey || v.status !== 'ready') throw err.notFound('Video chưa có file');
    return sendFile(req, reply, v.storageKey, v.mime || 'video/mp4');
  });

  // ───────────── Mẫu phát ─────────────
  const itemSchema = z.object({
    videoId: z.number().int(),
    pins: z.array(z.object({ productId: z.number().int(), atSec: z.number().min(0).default(0) })).max(50).default([]),
  });
  const templateSchema = z.object({
    name: z.string().trim().min(1, 'Cần nhập tên mẫu').max(100),
    note: z.string().max(1000).default(''),
    liveTitle: z.string().trim().max(200).nullable().optional(),
    liveDescription: z.string().max(1000).nullable().optional(),
    coverKey: z.string().max(200).nullable().optional(),
    loop: z.boolean().default(true),
    expectedDurationMin: z.number().int().min(1).max(24 * 60).nullable().optional(),
    replyMode: z.enum(['inherit', 'on', 'off']).default('inherit'),
    items: z.array(itemSchema).max(LIMITS.templateVideosMax),
  });

  async function assertTemplateName(shopId: number, name: string, excludeId?: number) {
    const all = await db.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.shopId, shopId));
    const f = foldVi(name);
    if (all.some((t) => t.id !== excludeId && foldVi(t.name) === f)) throw err.conflict('duplicate_name', 'Tên mẫu phát đã tồn tại trong shop (không phân biệt hoa thường và dấu)');
  }

  async function assertItemsBelong(shopId: number, items: z.infer<typeof itemSchema>[]) {
    const vids = [...new Set(items.map((i) => i.videoId))];
    const pids = [...new Set(items.flatMap((i) => i.pins.map((p) => p.productId)))];
    if (vids.length) {
      const ok = await db.select({ id: videos.id }).from(videos).where(and(eq(videos.shopId, shopId), inArray(videos.id, vids)));
      if (ok.length !== vids.length) throw err.badRequest('bad_video', 'Có video không thuộc shop này');
    }
    if (pids.length) {
      const ok = await db.select({ id: products.id }).from(products).where(and(eq(products.shopId, shopId), inArray(products.id, pids)));
      if (ok.length !== pids.length) throw err.badRequest('bad_product', 'Có sản phẩm không thuộc shop này');
    }
  }

  async function writeItems(templateId: number, items: z.infer<typeof itemSchema>[]) {
    await db.delete(templateItems).where(eq(templateItems.templateId, templateId));
    if (items.length)
      await db.insert(templateItems).values(items.map((it, i) => ({ templateId, position: i + 1, videoId: it.videoId, pins: [...it.pins].sort((a, b) => a.atSec - b.atSec) })));
  }

  app.get('/api/shops/:id/templates', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const rows = await db.select().from(templates).where(eq(templates.shopId, shop.id)).orderBy(asc(templates.number), asc(templates.id));
    const used = await db.select({ templateId: schedules.templateId }).from(schedules).where(and(eq(schedules.shopId, shop.id), eq(schedules.state, 'active')));
    const usedSet = new Set(used.map((u) => u.templateId));
    const items = [];
    for (const t of rows) {
      const full = await loadTemplateFull(t.id);
      items.push({
        ...t,
        videoCount: full?.items.length ?? 0,
        productCount: full?.productCount ?? 0,
        durationSec: full?.durationSec ?? 0,
        issueCount: full?.issues.length ?? 0,
        issues: full?.issues.slice(0, 5) ?? [],
        usedBySchedule: usedSet.has(t.id),
        thumbVideoId: full?.items[0]?.videoId ?? null,
      });
    }
    return { items, counts: { all: items.length, warn: items.filter((i) => i.issueCount > 0).length } };
  });

  app.get('/api/shops/:id/templates/:tid', async (req) => {
    const { shop } = await requireShop(req, idOf(req.params));
    const full = await loadTemplateFull(idOf(req.params, 'tid'));
    if (!full || full.template.shopId !== shop.id) throw err.notFound('Không tìm thấy mẫu phát');
    return full;
  });

  app.post('/api/shops/:id/templates', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'template.manage', 'write');
    const body = parse(templateSchema, req.body);
    await assertTemplateName(shop.id, body.name);
    await assertItemsBelong(shop.id, body.items);
    const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${templates.number}),0)` }).from(templates).where(eq(templates.shopId, shop.id))) as [{ n: number }];
    const [t] = await db
      .insert(templates)
      .values({ shopId: shop.id, number: Number(n) + 1, name: body.name, note: body.note, liveTitle: body.liveTitle ?? null, liveDescription: body.liveDescription ?? null, coverKey: body.coverKey ?? null, loop: body.loop, expectedDurationMin: body.expectedDurationMin ?? null, replyMode: body.replyMode })
      .returning();
    await writeItems(t!.id, body.items);
    await audit(actorRef(actor), 'template_created', { shopId: shop.id, params: { name: body.name } });
    return { id: t!.id };
  });

  app.put('/api/shops/:id/templates/:tid', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'template.manage', 'write');
    const tid = idOf(req.params, 'tid');
    const [t] = await db.select().from(templates).where(and(eq(templates.id, tid), eq(templates.shopId, shop.id)));
    if (!t) throw err.notFound();
    const body = parse(templateSchema, req.body);
    await assertTemplateName(shop.id, body.name, tid);
    await assertItemsBelong(shop.id, body.items);
    await db
      .update(templates)
      .set({ name: body.name, note: body.note, liveTitle: body.liveTitle ?? null, liveDescription: body.liveDescription ?? null, coverKey: body.coverKey ?? null, loop: body.loop, expectedDurationMin: body.expectedDurationMin ?? null, replyMode: body.replyMode, legacyNeedsReview: false, updatedAt: new Date() })
      .where(eq(templates.id, tid));
    await writeItems(tid, body.items);
    await audit(actorRef(actor), 'template_updated', { shopId: shop.id, params: { name: body.name } });
    return { ok: true };
  });

  app.post('/api/shops/:id/templates/:tid/duplicate', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'template.manage', 'write');
    const full = await loadTemplateFull(idOf(req.params, 'tid'));
    if (!full || full.template.shopId !== shop.id) throw err.notFound();
    const all = await db.select({ name: templates.name }).from(templates).where(eq(templates.shopId, shop.id));
    const names = new Set(all.map((x) => foldVi(x.name)));
    let name = `${full.template.name} (bản sao)`;
    for (let i = 2; names.has(foldVi(name)); i++) name = `${full.template.name} (bản sao ${i})`;
    const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${templates.number}),0)` }).from(templates).where(eq(templates.shopId, shop.id))) as [{ n: number }];
    const { id: _id, number: _num, createdAt: _c, updatedAt: _u, legacyId: _l, ...rest } = full.template;
    const [t] = await db.insert(templates).values({ ...rest, number: Number(n) + 1, name, legacyId: null }).returning();
    await writeItems(t!.id, full.items.map((i) => ({ videoId: i.videoId, pins: i.pins.map((p) => ({ productId: p.productId, atSec: p.atSec })) })));
    await audit(actorRef(actor), 'template_created', { shopId: shop.id, params: { name, from: full.template.name } });
    return { id: t!.id };
  });

  // Sao chép mẫu sang shop khác: khớp video theo tên, sản phẩm theo item ID hoặc SKU
  app.post('/api/shops/:id/templates/:tid/copy', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'template.manage', 'read');
    const body = parse(z.object({ shopIds: z.array(z.number().int()).min(1).max(200) }), req.body);
    const full = await loadTemplateFull(idOf(req.params, 'tid'));
    if (!full || full.template.shopId !== shop.id) throw err.notFound();
    const results: { shopId: number; ok: boolean; templateId?: number; unmatchedVideos?: number; unmatchedProducts?: number; message?: string }[] = [];
    for (const targetId of body.shopIds) {
      try {
        const { shop: target } = await requireShop(req, targetId, 'template.manage', 'write');
        const tv = await db.select().from(videos).where(eq(videos.shopId, target.id));
        const tp = await db.select().from(products).where(eq(products.shopId, target.id));
        const vByName = new Map(tv.map((v) => [foldVi(v.name), v]));
        const pByItem = new Map(tp.map((p) => [p.itemId, p]));
        const pBySku = new Map(tp.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
        let uv = 0;
        let up = 0;
        const items: z.infer<typeof itemSchema>[] = [];
        for (const it of full.items) {
          const v = it.video ? vByName.get(foldVi(it.video.name)) : undefined;
          if (!v) {
            uv++;
            continue;
          }
          const pins = it.pins
            .map((p) => {
              const m = p.product ? (pByItem.get(p.product.itemId) ?? (p.product.sku ? pBySku.get(p.product.sku.toLowerCase()) : undefined)) : undefined;
              if (!m) up++;
              return m ? { productId: m.id, atSec: p.atSec } : null;
            })
            .filter((x): x is { productId: number; atSec: number } => Boolean(x));
          items.push({ videoId: v.id, pins });
        }
        const existing = await db.select({ name: templates.name }).from(templates).where(eq(templates.shopId, target.id));
        const names = new Set(existing.map((x) => foldVi(x.name)));
        let name = full.template.name;
        for (let i = 2; names.has(foldVi(name)); i++) name = `${full.template.name} (${i})`;
        const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${templates.number}),0)` }).from(templates).where(eq(templates.shopId, target.id))) as [{ n: number }];
        const [t] = await db
          .insert(templates)
          .values({ shopId: target.id, number: Number(n) + 1, name, note: full.template.note, liveTitle: full.template.liveTitle, liveDescription: full.template.liveDescription, coverKey: full.template.coverKey, loop: full.template.loop, expectedDurationMin: full.template.expectedDurationMin, replyMode: full.template.replyMode })
          .returning();
        await writeItems(t!.id, items);
        await audit(actorRef(actor), 'template_created', { shopId: target.id, params: { name, copiedFrom: shop.id } });
        results.push({ shopId: target.id, ok: true, templateId: t!.id, unmatchedVideos: uv, unmatchedProducts: up });
      } catch (e) {
        results.push({ shopId: targetId, ok: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { results };
  });

  app.delete('/api/shops/:id/templates/:tid', async (req) => {
    const { actor, shop } = await requireShop(req, idOf(req.params), 'template.manage', 'write');
    const tid = idOf(req.params, 'tid');
    const [t] = await db.select().from(templates).where(and(eq(templates.id, tid), eq(templates.shopId, shop.id)));
    if (!t) throw err.notFound();
    const [used] = await db.select({ id: schedules.id, title: schedules.title }).from(schedules).where(and(eq(schedules.templateId, tid), inArray(schedules.state, ['active', 'paused'])));
    if (used) throw err.conflict('template_in_use', `Không xóa được: mẫu đang được lịch phát "${used.title}" sử dụng`);
    await db.delete(templateItems).where(eq(templateItems.templateId, tid));
    await db.delete(templates).where(eq(templates.id, tid));
    await audit(actorRef(actor), 'template_deleted', { shopId: shop.id, params: { name: t.name } });
    return { ok: true };
  });
}
