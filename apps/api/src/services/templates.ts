import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { products, templateItems, templates, videos, type PinPoint, type PlaylistEntry } from '../db/schema.js';

export interface TemplateIssue {
  position: number | null;
  code: 'video_missing' | 'video_not_ready' | 'no_pin' | 'product_missing' | 'product_removed' | 'product_out' | 'empty' | 'legacy_review';
  message: string;
}

export async function loadTemplateFull(templateId: number) {
  const [tpl] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!tpl) return null;
  const items = await db.select().from(templateItems).where(eq(templateItems.templateId, templateId)).orderBy(asc(templateItems.position));
  const videoIds = [...new Set(items.map((i) => i.videoId))];
  const productIds = [...new Set(items.flatMap((i) => (i.pins ?? []).map((p) => p.productId)))];
  const vrows = videoIds.length ? await db.select().from(videos).where(inArray(videos.id, videoIds)) : [];
  const prows = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const vmap = new Map(vrows.map((v) => [v.id, v]));
  const pmap = new Map(prows.map((p) => [p.id, p]));
  const issues: TemplateIssue[] = [];
  if (!items.length) issues.push({ position: null, code: 'empty', message: 'Mẫu chưa có video nào' });
  if (tpl.legacyNeedsReview) issues.push({ position: null, code: 'legacy_review', message: 'Mẫu nhập từ hệ thống cũ: cần kiểm tra thứ tự video và gán lại sản phẩm ghim' });
  const detailed = items.map((it) => {
    const v = vmap.get(it.videoId) ?? null;
    const pins = (it.pins ?? []).map((p: PinPoint) => ({ ...p, product: pmap.get(p.productId) ?? null }));
    if (!v) issues.push({ position: it.position, code: 'video_missing', message: `Vị trí ${it.position}: video đã bị xóa` });
    else if (v.status !== 'ready') issues.push({ position: it.position, code: 'video_not_ready', message: `Vị trí ${it.position}: video "${v.name}" chưa sẵn sàng` });
    if (!pins.length) issues.push({ position: it.position, code: 'no_pin', message: `Vị trí ${it.position}: chưa gán sản phẩm ghim` });
    for (const p of pins) {
      if (!p.product) issues.push({ position: it.position, code: 'product_missing', message: `Vị trí ${it.position}: sản phẩm ghim không còn trong danh mục` });
      else if (p.product.removed) issues.push({ position: it.position, code: 'product_removed', message: `Vị trí ${it.position}: "${p.product.name}" đã bị gỡ khỏi Shopee` });
      else if ((p.product.stock ?? 0) <= 0) issues.push({ position: it.position, code: 'product_out', message: `Vị trí ${it.position}: "${p.product.name}" đã hết hàng` });
    }
    return {
      id: it.id,
      position: it.position,
      videoId: it.videoId,
      video: v ? { id: v.id, name: v.name, durationSec: v.durationSec, status: v.status, sizeBytes: v.sizeBytes } : null,
      pins: pins.map((p) => ({
        productId: p.productId,
        atSec: p.atSec,
        product: p.product
          ? { id: p.product.id, itemId: p.product.itemId, name: p.product.name, sku: p.product.sku, imageUrl: p.product.imageUrl, stock: p.product.stock, removed: p.product.removed }
          : null,
      })),
    };
  });
  const durationSec = detailed.reduce((s, i) => s + (i.video?.durationSec ?? 0), 0);
  return { template: tpl, items: detailed, issues, durationSec, productCount: new Set(productIds).size };
}

export function buildPlaylist(full: NonNullable<Awaited<ReturnType<typeof loadTemplateFull>>>): PlaylistEntry[] {
  return full.items
    .filter((i) => i.video && i.video.status === 'ready')
    .map((i) => ({
      videoId: i.videoId,
      name: i.video!.name,
      durationSec: i.video!.durationSec ?? 0,
      pins: i.pins
        .filter((p) => p.product && !p.product.removed)
        .map((p) => ({ itemId: p.product!.itemId, productId: p.productId, atSec: p.atSec }))
        .sort((a, b) => a.atSec - b.atSec),
    }));
}

/** Sản phẩm cần ghim tại thời điểm (videoIndex, positionSec) */
export function desiredPin(playlist: PlaylistEntry[] | null, videoIndex: number | null, positionSec: number | null): number | null {
  if (!playlist || videoIndex === null || videoIndex === undefined) return null;
  const entry = playlist[videoIndex];
  if (!entry || !entry.pins.length) return null;
  const pos = positionSec ?? 0;
  let chosen = entry.pins[0]!;
  for (const p of entry.pins) if (p.atSec <= pos) chosen = p;
  return chosen.itemId;
}
