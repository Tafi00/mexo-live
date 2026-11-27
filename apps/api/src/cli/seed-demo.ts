/**
 * DỮ LIỆU DEMO cho môi trường giả lập (SHOPEE_MODE=mock):
 *  - 1 shop demo đã kết nối (token giả lập), danh mục 20 sản phẩm
 *  - 6 video "sẵn sàng" (không có file — dùng với MexoStreamer chế độ mô phỏng)
 *  - 1 mẫu phát đã gán sản phẩm ghim, 3 kịch bản trả lời
 *  - 1 máy chủ phát với khóa in ra màn hình
 *   pnpm seed:demo
 */
import { eq } from 'drizzle-orm';
import { addDays, foldVi, vnDate } from '@mexo/shared';
import { env } from '../env.js';
import { closeDb, db, initDb } from '../db/client.js';
import { products, replyRules, servers, shops, templateItems, templates, videos } from '../db/schema.js';
import { encrypt } from '../lib/crypto.js';
import { newServerKey } from '../services/streamers.js';
import { ensureBootstrapAdmin } from './bootstrap.js';

const DEMO_SHOP_ID = 990000001;
const NAMES = ['Áo thun cotton basic', 'Quần jean ống suông', 'Váy hoa nhí vintage', 'Áo sơ mi linen', 'Túi tote canvas', 'Giày sneaker trắng', 'Mũ bucket', 'Kính mát thời trang', 'Đồng hồ dây da', 'Son kem lì', 'Kem chống nắng SPF50', 'Serum vitamin C', 'Bình giữ nhiệt 500ml', 'Tai nghe bluetooth', 'Sạc dự phòng 10000mAh', 'Ốp lưng điện thoại', 'Bàn phím cơ mini', 'Chuột không dây', 'Đèn ngủ cảm ứng', 'Gối tựa lưng'];

async function main() {
  if (env.shopee.mode !== 'mock') {
    console.error('seed:demo chỉ dùng cho SHOPEE_MODE=mock');
    process.exit(1);
  }
  await initDb();
  await ensureBootstrapAdmin();
  const [exists] = await db.select().from(shops).where(eq(shops.shopeeShopId, DEMO_SHOP_ID));
  if (exists) {
    console.log('Shop demo đã tồn tại — bỏ qua.');
    await closeDb();
    return;
  }
  const all = await db.select({ n: shops.number }).from(shops);
  const number = all.reduce((m, r) => Math.max(m, r.n), 0) + 1;
  const [shop] = await db
    .insert(shops)
    .values({
      number,
      shopeeShopId: DEMO_SHOP_ID,
      shopeeName: 'MEXO Demo Store',
      alias: 'DEMO — Shop giả lập',
      searchText: foldVi('DEMO Shop giả lập MEXO Demo Store ' + DEMO_SHOP_ID),
      serviceExpiresOn: addDays(vnDate(), 365),
      connection: 'ok',
      accessTokenEnc: encrypt(`mock_at_${DEMO_SHOP_ID}_seed`),
      refreshTokenEnc: encrypt(`mock_rt_${DEMO_SHOP_ID}_seed`),
      accessExpiresAt: new Date(Date.now() + 3600 * 1000),
      authExpiresAt: new Date(Date.now() + 365 * 86400000),
      replyEnabled: true,
      replyUnmatched: 'none',
      replyContext: 'Shop bán thời trang và phụ kiện. Đổi trả trong 7 ngày nếu lỗi do nhà sản xuất. Giao hàng toàn quốc 2–4 ngày.',
      tags: ['demo'],
      productSync: { status: 'done', loaded: NAMES.length, total: NAMES.length, syncedAt: new Date().toISOString(), errorCode: null },
    })
    .returning();
  const shopId = shop!.id;
  const prodRows = await db
    .insert(products)
    .values(
      NAMES.map((n, i) => {
        const price = (Math.floor(((DEMO_SHOP_ID % 97) * 7 + i * 13) % 50) + 5) * 10000;
        const name = `${n} ${['cao cấp', 'hàng chính hãng', 'phong cách Hàn Quốc', 'mẫu mới 2026'][i % 4]}`;
        const sku = `SKU-${(DEMO_SHOP_ID % 10000).toString().padStart(4, '0')}-${(i + 1).toString().padStart(3, '0')}`;
        return {
          shopId,
          itemId: DEMO_SHOP_ID * 100 + i + 1,
          number: i + 1,
          name,
          searchText: foldVi(`${name} ${sku} ${DEMO_SHOP_ID * 100 + i + 1}`),
          sku,
          imageUrl: `https://picsum.photos/seed/${DEMO_SHOP_ID}-${i}/300/300`,
          price,
          originalPrice: Math.round(price * 1.2),
          stock: i % 9 === 0 ? 0 : (i * 37) % 200,
          sold: (i * 53) % 1000,
          likes: (i * 11) % 300,
          rating: 4 + (i % 10) / 10,
          syncedAt: new Date(),
        };
      }),
    )
    .returning();
  const inStock = prodRows.filter((p) => (p.stock ?? 0) > 0);
  const vids = await db
    .insert(videos)
    .values(
      Array.from({ length: 6 }, (_, i) => ({
        shopId,
        number: i + 1,
        name: `Demo video ${i + 1}`,
        sourceFileName: `demo-${i + 1}.mp4`,
        durationSec: 45 + i * 10,
        sizeBytes: 10_000_000 + i * 1_000_000,
        uploadedBytes: 10_000_000 + i * 1_000_000,
        status: 'ready',
        mime: 'video/mp4',
      })),
    )
    .returning();
  const [tpl] = await db.insert(templates).values({ shopId, number: 1, name: 'Demo — Săn deal cuối tuần', note: 'Mẫu demo: 6 video, mỗi video ghim 1–2 sản phẩm', liveTitle: 'LIVE DEMO - SĂN DEAL', loop: true }).returning();
  await db.insert(templateItems).values(
    vids.map((v, i) => ({
      templateId: tpl!.id,
      position: i + 1,
      videoId: v.id,
      pins: i % 2 === 0 ? [{ productId: inStock[i]!.id, atSec: 0 }, { productId: inStock[i + 6]!.id, atSec: 20 }] : [{ productId: inStock[i]!.id, atSec: 0 }],
    })),
  );
  await db.insert(replyRules).values([
    { shopId, topic: 'Còn hàng', keywords: ['còn hàng', 'còn không', 'hết hàng', 'còn size'], sample: 'Shop ơi còn hàng không ạ?', answer: 'Dạ sản phẩm vẫn còn hàng ạ, bạn bấm vào giỏ hàng trên live để chọn phân loại nhé!' },
    { shopId, topic: 'Giao hàng', keywords: ['ship', 'giao hàng', 'mấy ngày', 'vận chuyển'], sample: 'Ship về Hà Nội mất mấy ngày?', answer: 'Dạ shop giao toàn quốc từ 2–4 ngày ạ, bạn đặt ngay trên giỏ live để được xử lý sớm nhé!' },
    { shopId, topic: 'Đổi trả', keywords: ['đổi trả', 'bảo hành', 'đổi hàng', 'lỗi'], sample: 'Đổi trả được không shop?', answer: 'Dạ shop hỗ trợ đổi trả trong 7 ngày nếu sản phẩm lỗi do nhà sản xuất ạ.' },
  ]);
  const k = newServerKey();
  await db.insert(servers).values({ name: 'DEMO-STREAMER', keyHash: k.hash, keyHint: k.hint, keyExpiresAt: new Date(Date.now() + 180 * 86400000), note: 'Máy phát demo (chế độ mô phỏng)' });
  console.log('\nĐã tạo dữ liệu demo:');
  console.log(`  Shop: DEMO — Shop giả lập (id nội bộ ${shopId})`);
  console.log(`  Máy chủ phát: DEMO-STREAMER`);
  console.log(`\n  Chạy máy phát mô phỏng (terminal khác):`);
  console.log(`    MEXO_API_URL=${env.apiPublicUrl} MEXO_SERVER_KEY=${k.key} STREAMER_MODE=simulate pnpm dev:streamer\n`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
