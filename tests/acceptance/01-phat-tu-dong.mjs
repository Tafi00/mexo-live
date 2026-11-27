// Kịch bản chạy thử end-to-end luồng phát tự động trên shop demo (Shopee giả lập + máy phát mô phỏng)
const API = process.env.MEXO_API_URL || 'http://localhost:4000';
let cookie = '';
async function call(method, path, body, raw) {
  const headers = { cookie };
  let payload;
  if (raw) payload = raw;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const [user, pass, shopId] = process.argv.slice(2);
await call('POST', '/api/auth/login', { username: user, password: pass });
log('Đăng nhập OK');

// Ảnh bìa PNG 1x1
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'cover.png');
const cover = await call('POST', '/api/files/cover', undefined, fd);
log('Ảnh bìa:', cover.key);

const tpls = await call('GET', `/api/shops/${shopId}/templates`);
const tpl = tpls.items[0];
log('Mẫu phát:', tpl.name, `${tpl.videoCount} video, ${tpl.issueCount} cảnh báo`);

const existing = await call('GET', `/api/shops/${shopId}/sessions`);
if (existing.open) {
  log('Có phiên mở cũ → kết thúc', existing.open.id);
  await call('POST', `/api/sessions/${existing.open.id}/end`, {});
}

const s = await call('POST', `/api/shops/${shopId}/sessions`, { title: 'E2E - Phiên thử nghiệm', description: 'Chạy thử tự động', coverKey: cover.key, templateId: tpl.id });
log('Tạo phiên:', s.id, 'Shopee session', s.shopeeSessionId, 'state', s.state);

// Tạo phiên thứ 2 phải bị chặn (1 phiên mở / shop)
try {
  await call('POST', `/api/shops/${shopId}/sessions`, { title: 'Trùng', coverKey: cover.key });
  log('LỖI: tạo phiên trùng không bị chặn!');
} catch (e) {
  log('Chặn phiên trùng OK:', e.message.slice(0, 120));
}

const pf = await call('POST', `/api/sessions/${s.id}/preflight`, { templateId: tpl.id });
log('Kiểm tra trước khi phát:', pf.ok ? 'ĐẠT' : 'CHƯA ĐẠT');
for (const c of pf.checks) log('   ', c.ok ? '✔' : '✘', c.label, c.detail ?? '');
if (!pf.ok) process.exit(1);

await call('POST', `/api/sessions/${s.id}/stream`, { templateId: tpl.id });
log('Đã giao việc phát');

let last = '';
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  const d = await call('GET', `/api/sessions/${s.id}`);
  const x = d.session;
  const line = `state=${x.state} shopee=${x.shopeeStatus} stream=${x.streamState} video=${x.videoIndex} pos=${x.videoPositionSec} pin=${x.pinnedItemId}(${x.pinState}) viewers=${x.metrics.viewers ?? 0}`;
  if (line !== last) log(line);
  last = line;
  if (x.state === 'live' && x.pinnedItemId && i > 12) break;
}

const cm = await call('GET', `/api/sessions/${s.id}/comments`);
log('Bình luận nhận được:', cm.items.length, cm.items.slice(-3).map((c) => `[${c.handled ?? 'chờ'}] ${c.username}: ${c.content}`));
const logs = await call('GET', `/api/shops/${shopId}/reply-logs`);
log('Nhật ký trả lời:', logs.total, logs.items.slice(0, 3).map((l) => `${l.status}/${l.source}: ${l.answer ?? l.reason}`));

// Chuyển video thủ công
await call('POST', `/api/sessions/${s.id}/stream/skip`, { index: 3 });
await sleep(5000);
let d = await call('GET', `/api/sessions/${s.id}`);
log('Sau khi chuyển video:', 'video', d.session.videoIndex, 'pin', d.session.pinnedItemId);

const cart = await call('GET', `/api/sessions/${s.id}/cart`);
log('Giỏ live:', cart.count, '/', cart.limit, 'đang ghim', cart.pinned);

const end = await call('POST', `/api/sessions/${s.id}/end`, {});
log('Kết thúc:', end.result);
await sleep(4000);
d = await call('GET', `/api/sessions/${s.id}`);
log('Trạng thái cuối:', d.session.state, d.session.endedReason, 'stream', d.session.streamState);
log('Sự kiện:', d.events.slice(0, 12).reverse().map((e) => `${e.code}: ${e.message}`).join('\n    '));
