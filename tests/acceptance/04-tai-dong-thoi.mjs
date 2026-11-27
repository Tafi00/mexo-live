// Kiểm thử tải: N shop kết nối qua OAuth giả lập → tải video → mẫu phát → N phiên phát đồng thời
// Chạy trên một API RIÊNG (dữ liệu tách biệt) để không làm bẩn dữ liệu thật, ví dụ:
//   PORT=4100 DATA_DIR=./data-loadtest STORAGE_DIR=./storage-loadtest API_PUBLIC_URL=http://localhost:4100 PUBLIC_URL=http://localhost:4100 \
//   BOOTSTRAP_ADMIN_PASSWORD='LoadTest#2026' pnpm --filter @mexo/api exec tsx src/index.ts
//   MEXO_API_URL=http://localhost:4100 node tests/acceptance/04-tai-dong-thoi.mjs 60
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const API = process.env.MEXO_API_URL || 'http://localhost:4000';
const N = Number(process.argv[2] ?? 60);
let cookie = '';
async function call(method, path, body, raw, ct) {
  const headers = { cookie };
  let payload;
  if (raw) { payload = raw; if (ct) headers['content-type'] = ct; }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(API + path, { method, headers, body: payload, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return { data, res };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// Đăng nhập + đổi mật khẩu bootstrap
try { await call('POST', '/api/auth/login', { username: 'admin', password: 'LoadTest#2026-new' }); } catch { await call('POST', '/api/auth/login', { username: 'admin', password: 'LoadTest#2026' }); await call('POST', '/api/auth/change-password', { currentPassword: 'LoadTest#2026', newPassword: 'LoadTest#2026-new' }); cookie = ''; await call('POST', '/api/auth/login', { username: 'admin', password: 'LoadTest#2026-new' }); }
log('Đăng nhập OK');

// Máy phát mô phỏng
const srv = (await call('POST', '/api/servers', { name: 'LOAD-STREAMER' })).data;
const streamer = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: fileURLToPath(new URL('../../apps/streamer/', import.meta.url)),
  env: { ...process.env, MEXO_API_URL: API, MEXO_SERVER_KEY: srv.key, STREAMER_MODE: 'simulate', MAX_STREAMS: '500' },
  stdio: 'ignore',
});
log('Máy phát mô phỏng chạy, pid', streamer.pid);

// Ảnh bìa
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'cover.png');
const cover = (await call('POST', '/api/files/cover', undefined, fd)).data;

// 1) Kết nối N shop qua OAuth giả lập
const shopIds = [];
await pool(Array.from({ length: N }, (_, i) => 700000000 + i), 8, async (sid) => {
  const link = (await call('POST', '/api/connect/link', { serviceExpiresOn: '2027-12-31' })).data;
  const redirect = new URL(link.url).searchParams.get('redirect');
  const r = await call('GET', `/api/mock-shopee/authorize/confirm?shop_id=${sid}&redirect=${encodeURIComponent(redirect)}`);
  const loc = new URL(r.res.headers.get('location'));
  const done = (await call('POST', '/api/connect/paste', { url: loc.toString() })).data;
  shopIds.push(done.shopId);
});
log(`Đã kết nối ${shopIds.length} shop qua OAuth`);

// 2) Chờ đồng bộ sản phẩm
for (let k = 0; k < 60; k++) {
  const counts = await Promise.all(shopIds.map(async (id) => (await call('GET', `/api/shops/${id}/products?pageSize=1`)).data.counts.all));
  const done = counts.filter((c) => c >= 20).length;
  if (done === shopIds.length) break;
  await sleep(2000);
}
log('Đã đồng bộ danh mục sản phẩm cho mọi shop');

// 3) Video + mẫu phát
const fake = Buffer.alloc(64 * 1024, 1);
Buffer.from([0, 0, 0, 0x18]).copy(fake, 0);
Buffer.from('ftypmp42').copy(fake, 4);
const tplOf = new Map();
await pool(shopIds, 8, async (id) => {
  const vids = [];
  for (let v = 0; v < 3; v++) {
    const init = (await call('POST', `/api/shops/${id}/videos/uploads`, { fileName: `load-${v}.mp4`, sizeBytes: fake.length, lastModified: v, durationSec: 20 + v * 5, mime: 'video/mp4' })).data;
    await call('PUT', `/api/shops/${id}/videos/${init.videoId}/chunk?offset=0`, undefined, fake, 'application/octet-stream');
    vids.push(init.videoId);
  }
  const prods = (await call('GET', `/api/shops/${id}/products?filter=instock&pageSize=10`)).data.items;
  const t = (await call('POST', `/api/shops/${id}/templates`, { name: 'Mẫu tải', items: vids.map((vid, i) => ({ videoId: vid, pins: [{ productId: prods[i].id, atSec: 0 }, { productId: prods[i + 3].id, atSec: 10 }] })), loop: true, replyMode: 'inherit', note: '' })).data;
  tplOf.set(id, t.id);
});
log('Đã tải 3 video + tạo mẫu phát cho mọi shop');

// 4) Tạo phiên + phát tự động
let started = 0;
const sessionOf = new Map();
await pool(shopIds, 8, async (id) => {
  const s = (await call('POST', `/api/shops/${id}/sessions`, { title: `LOAD ${id}`, coverKey: cover.key, templateId: tplOf.get(id) })).data;
  sessionOf.set(id, s.id);
  await call('POST', `/api/sessions/${s.id}/stream`, { templateId: tplOf.get(id) });
  started++;
});
log(`Đã giao ${started} việc phát`);

// 5) Theo dõi
for (let k = 0; k < 18; k++) {
  await sleep(5000);
  const live = (await call('GET', '/api/live')).data.items;
  const st = {};
  for (const x of live) { const key = `${x.session.state}/${x.session.streamState}`; st[key] = (st[key] ?? 0) + 1; }
  const pinned = live.filter((x) => x.session.signals.pin === 'ok').length;
  const sys = (await call('GET', '/api/settings/system')).data;
  const jobs = Object.fromEntries(sys.jobs.filter((j) => ['session-engine', 'reconcile', 'comments', 'api-log-flush'].includes(j.name)).map((j) => [j.name, `${j.lastDurationMs}ms${j.failures ? ' F' + j.failures : ''}`]));
  log(`phiên: ${JSON.stringify(st)} | ghim OK: ${pinned}/${live.length} | job: ${JSON.stringify(jobs)}`);
}
const mon = (await call('GET', '/api/monitor/summary')).data;
log(`API Shopee: ${mon.lastHour.total} lệnh/giờ, thành công ${(mon.lastHour.rate * 100).toFixed(2)}% (giả lập lỗi ngẫu nhiên 2%)`);
const errs = (await call('GET', '/api/monitor/errors')).data.items.slice(0, 5);
log('Nhóm lỗi:', errs.map((e) => `${e.errorClass}/${e.errorCode}/${e.httpStatus}×${e.n}`).join(', '));

// 6) Kết thúc hàng loạt
const ids = [...sessionOf.values()];
const bulk = (await call('POST', '/api/sessions/bulk', { ids, action: 'end' })).data;
log(`Kết thúc hàng loạt: ${bulk.ok} OK, ${bulk.failed} lỗi`, bulk.results.filter((r) => !r.ok).slice(0, 3));
await sleep(3000);
const remain = (await call('GET', '/api/live')).data.items.length;
log('Phiên còn mở:', remain);
streamer.kill();
