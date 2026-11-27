import { and, eq, notInArray, sql } from 'drizzle-orm';
import { foldVi } from '@mexo/shared';
import { db } from '../db/client.js';
import { products, shops } from '../db/schema.js';
import { audit, type ActorRef } from './audit.js';
import { getItemBaseInfo, getItemExtraInfo, getItemIdPage, ShopeeError } from './shopee/index.js';
import { publish } from './events.js';

type ShopRow = typeof shops.$inferSelect;
const running = new Set<number>();

export function isSyncing(shopId: number): boolean {
  return running.has(shopId);
}

async function setSync(shopId: number, patch: Partial<ShopRow['productSync']>) {
  const [s] = await db.select({ ps: shops.productSync }).from(shops).where(eq(shops.id, shopId));
  await db
    .update(shops)
    .set({ productSync: { ...(s?.ps ?? { status: 'never', loaded: 0, total: 0, syncedAt: null, errorCode: null }), ...patch } })
    .where(eq(shops.id, shopId));
}

/**
 * Sao chép danh mục sản phẩm từ Shopee về hệ thống (chạy nền, có tiến độ x/y).
 * Tìm/lọc/sắp xếp sau đó chạy trên bản sao → không tốn lệnh gọi Shopee.
 */
export async function startProductSync(shop: ShopRow, actor: ActorRef): Promise<void> {
  if (running.has(shop.id)) return;
  running.add(shop.id);
  void (async () => {
    try {
      await setSync(shop.id, { status: 'running', loaded: 0, total: 0, errorCode: null });
      const ids: number[] = [];
      let offset = 0;
      let total = 0;
      for (let guard = 0; guard < 500; guard++) {
        const page = await getItemIdPage(shop, offset, 100);
        ids.push(...page.itemIds);
        total = page.total;
        await setSync(shop.id, { total });
        if (!page.hasNext || page.itemIds.length === 0) break;
        offset = page.nextOffset;
      }
      const now = new Date();
      let loaded = 0;
      let number = 0;
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const [base, extra] = await Promise.all([getItemBaseInfo(shop, chunk), getItemExtraInfo(shop, chunk).catch(() => [])]);
        const extraMap = new Map(extra.map((x) => [x.itemId, x]));
        for (const b of base) {
          const x = extraMap.get(b.itemId);
          number++;
          const values = {
            shopId: shop.id,
            itemId: b.itemId,
            number,
            name: b.name,
            searchText: foldVi(`${b.name} ${b.sku ?? ''} ${b.itemId}`),
            sku: b.sku,
            imageUrl: b.imageUrl,
            price: b.price,
            originalPrice: b.originalPrice,
            currency: b.currency,
            stock: b.stock,
            sold: x?.sold ?? null,
            rating: x?.rating ?? null,
            likes: x?.likes ?? null,
            itemStatus: b.status,
            removed: false,
            syncedAt: now,
          };
          await db
            .insert(products)
            .values(values)
            .onConflictDoUpdate({ target: [products.shopId, products.itemId], set: values });
        }
        loaded += chunk.length;
        await setSync(shop.id, { loaded });
      }
      // Sản phẩm không còn trên Shopee → đánh dấu đã gỡ (giữ lại để mẫu phát cảnh báo)
      if (ids.length) {
        await db
          .update(products)
          .set({ removed: true })
          .where(and(eq(products.shopId, shop.id), notInArray(products.itemId, ids)));
      }
      await setSync(shop.id, { status: 'done', loaded, total: ids.length, syncedAt: now.toISOString(), errorCode: null });
      await audit(actor, 'products_synced', { shopId: shop.id, params: { count: ids.length } });
    } catch (e) {
      const code = e instanceof ShopeeError ? e.kind : 'internal';
      await setSync(shop.id, { status: 'failed', errorCode: code });
    } finally {
      running.delete(shop.id);
      publish({ type: 'shop', shopId: shop.id });
    }
  })();
}

export async function productCounts(shopId: number) {
  const [r] = await db
    .select({
      all: sql<number>`count(*) filter (where not ${products.removed})`,
      low: sql<number>`count(*) filter (where not ${products.removed} and ${products.stock} > 0 and ${products.stock} <= 10)`,
      out: sql<number>`count(*) filter (where not ${products.removed} and coalesce(${products.stock},0) <= 0)`,
      removed: sql<number>`count(*) filter (where ${products.removed})`,
    })
    .from(products)
    .where(eq(products.shopId, shopId));
  return { all: Number(r?.all ?? 0), low: Number(r?.low ?? 0), out: Number(r?.out ?? 0), removed: Number(r?.removed ?? 0) };
}

/** Tách danh sách mã/link sản phẩm (mỗi dòng 1 sản phẩm), giữ thứ tự */
export function parseItemRefs(text: string, max = 1000): number[] {
  const out: number[] = [];
  for (const line of text.split(/[\r\n,;]+/)) {
    const s = line.trim();
    if (!s) continue;
    let id: number | null = null;
    const m1 = /-i\.\d+\.(\d+)/.exec(s); // link dạng ...-i.<shop>.<item>
    const m2 = /\/product\/\d+\/(\d+)/.exec(s); // link dạng /product/<shop>/<item>
    if (m1) id = Number(m1[1]);
    else if (m2) id = Number(m2[1]);
    else if (/^\d{5,}$/.test(s)) id = Number(s);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
