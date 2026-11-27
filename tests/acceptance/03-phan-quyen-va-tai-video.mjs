// Kiểm thử phân quyền, tách dữ liệu giữa khách hàng, và tải video tiếp được
const API = process.env.MEXO_API_URL || 'http://localhost:4000';
function client() {
  let cookie = '';
  return async function call(method, path, body, raw) {
    const headers = { cookie };
    let payload;
    if (raw) {
      payload = raw;
      headers['content-type'] = 'application/octet-stream';
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(API + path, { method, headers, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
const ok = (cond, msg) => console.log(cond ? '  ✔' : '  ✘ LỖI:', msg);
const [user, pass] = process.argv.slice(2);
const admin = client();
await admin('POST', '/api/auth/login', { username: user, password: pass });
const suffix = Date.now().toString(36).slice(-5);
// Dọn tài khoản thử nghiệm của lần chạy trước
for (const a of (await admin("GET", "/api/accounts")).data.items.filter((x) => /^(member|ownera|ownerb)_/.test(x.username)).sort((x, y) => (x.role === "member" ? -1 : 1))) {
  if (a.role === "owner") await admin("PUT", "/api/accounts/" + a.id + "/shops", { shopIds: [] });
  await admin("DELETE", "/api/accounts/" + a.id);
}

console.log('1) Tạo chủ shop A, B và gắn shop');
const A = (await admin('POST', '/api/accounts', { username: `ownera_${suffix}`, name: 'Chủ shop A', role: 'owner', serviceExpiresOn: '2027-12-31', shopLimit: 5 })).data;
const B = (await admin('POST', '/api/accounts', { username: `ownerb_${suffix}`, name: 'Chủ shop B', role: 'owner', serviceExpiresOn: '2027-12-31', shopLimit: 5 })).data;
ok(A.tempPassword && B.tempPassword, 'Tạo tài khoản trả mật khẩu tạm 1 lần');
let r = await admin('PUT', `/api/accounts/${A.id}/shops`, { shopIds: [2, 3] });
ok(r.status === 400, `Gắn shop thủ công thiếu cách xác minh bị chặn (${r.status})`);
r = await admin('PUT', `/api/accounts/${A.id}/shops`, { shopIds: [2, 3], verification: 'Gọi đúng SĐT đăng ký Shopee' });
ok(r.status === 200, 'Gắn 2 shop cho chủ shop A');
r = await admin('PUT', `/api/accounts/${B.id}/shops`, { shopIds: [3], verification: 'test' });
ok(r.status === 409, `Shop đã thuộc chủ A không gắn được cho B (${r.status} ${r.data?.error?.code})`);
await admin('PUT', `/api/accounts/${B.id}/shops`, { shopIds: [4], verification: 'Gọi đúng SĐT' });

async function loginFirst(username, temp) {
  const c = client();
  await c('POST', '/api/auth/login', { username, password: temp });
  const blocked = await c('GET', '/api/shops');
  ok(blocked.status === 403, `Chưa đổi mật khẩu thì bị chặn (${blocked.status})`);
  const ch = await c('POST', '/api/auth/change-password', { currentPassword: temp, newPassword: 'Test#Pass2026zz' });
  ok(ch.status === 200, 'Đổi mật khẩu lần đầu');
  return c;
}
console.log('2) Chủ shop A đăng nhập');
const ca = await loginFirst(`ownera_${suffix}`, A.tempPassword);
r = await ca('GET', '/api/shops?pageSize=500');
ok(r.data.total === 2 && r.data.items.every((s) => [2, 3].includes(s.id)), `A chỉ thấy 2 shop của mình (thấy ${r.data.total})`);
r = await ca('GET', '/api/shops/4');
ok(r.status === 404, `A không xem được shop của B (${r.status})`);
r = await ca('GET', '/api/shops/4/products');
ok(r.status === 404, `A không xem được sản phẩm shop của B (${r.status})`);
r = await ca('GET', '/api/servers');
ok(r.status === 403, `Chủ shop không vào được trang máy chủ (${r.status})`);
r = await ca('GET', '/api/monitor/summary');
ok(r.status === 403, `Chủ shop không xem được giám sát API (${r.status})`);
r = await ca('POST', '/api/shops/2/service-expiry', { date: '2099-01-01' });
ok(r.status === 403, `Chủ shop không tự gia hạn (${r.status})`);
r = await ca('GET', '/api/sessions/1500');
ok(r.status === 404, `A không mở được phiên của shop khác (${r.status})`);

console.log('3) Chủ shop A tạo nhân viên chỉ xem, giao 1 shop');
const M = (await ca('POST', '/api/accounts', { username: `member_${suffix}`, name: 'Nhân viên A1', role: 'member', permissions: ['shop.view', 'report.view'], shopIds: [2] })).data;
ok(M.tempPassword, 'Chủ shop tạo được nhân viên');
r = await ca('POST', '/api/accounts', { username: `admin_${suffix}`, name: 'X', role: 'admin' });
ok(r.status === 403, `Chủ shop không tạo được quản trị viên (${r.status})`);
const cm = await loginFirst(`member_${suffix}`, M.tempPassword);
r = await cm('GET', '/api/shops?pageSize=500');
ok(r.data.total === 1 && r.data.items[0].id === 2, `Nhân viên chỉ thấy shop được giao (thấy ${r.data.total})`);
r = await cm('GET', '/api/shops/3');
ok(r.status === 404, `Nhân viên không thấy shop chưa giao (${r.status})`);
r = await cm('POST', '/api/shops/2/products/sync');
ok(r.status === 403, `Nhân viên thiếu quyền quản lý sản phẩm bị chặn (${r.status})`);
r = await cm('POST', '/api/shops/2/schedules', { title: 'x', templateId: 1, coverKey: 'x', repeat: 'once', startDate: '2026-12-01', startTime: '10:00', endTime: '11:00' });
ok(r.status === 403, `Nhân viên thiếu quyền tạo lịch bị chặn (${r.status})`);
r = await cm('GET', '/api/accounts');
ok(r.status === 403, `Nhân viên không quản lý tài khoản (${r.status})`);
console.log('4) Chủ shop A cấp thêm quyền video cho nhân viên → hiệu lực');
await ca('PATCH', `/api/accounts/${M.id}`, { permissions: ['shop.view', 'report.view', 'video.manage'] });
const cm2 = client();
await cm2('POST', '/api/auth/login', { username: `member_${suffix}`, password: 'Test#Pass2026zz' });

console.log('5) Tải video tiếp được (resumable)');
const size = 3 * 1024 * 1024 + 12345;
const file = Buffer.alloc(size, 7);
Buffer.from([0, 0, 0, 0x18]).copy(file, 0);
Buffer.from('ftypmp42').copy(file, 4);
const init = (await cm2('POST', '/api/shops/2/videos/uploads', { fileName: `e2e-${suffix}.mp4`, sizeBytes: size, lastModified: 123, durationSec: 33.5, mime: 'video/mp4' })).data;
ok(init.videoId && init.uploadedBytes === 0, `Bắt đầu tải (video #${init.videoId})`);
const chunk = 1024 * 1024;
r = await cm2('PUT', `/api/shops/2/videos/${init.videoId}/chunk?offset=0`, undefined, file.subarray(0, chunk));
ok(r.data.uploadedBytes === chunk, 'Đoạn 1 lên xong');
// Giả lập rớt mạng: client khởi tạo lại với cùng file → phải tiếp tục từ đoạn đã có
const again = (await cm2('POST', '/api/shops/2/videos/uploads', { fileName: `e2e-${suffix}.mp4`, sizeBytes: size, lastModified: 123, durationSec: 33.5 })).data;
ok(again.videoId === init.videoId && again.resumed && again.uploadedBytes === chunk, `Chọn lại file → tiếp tục từ ${again.uploadedBytes} byte`);
r = await cm2('PUT', `/api/shops/2/videos/${init.videoId}/chunk?offset=0`, undefined, file.subarray(0, chunk));
ok(r.data.mismatch && r.data.uploadedBytes === chunk, 'Gửi lệch offset → máy chủ báo vị trí đúng, không ghi trùng');
let off = chunk;
while (off < size) {
  r = await cm2('PUT', `/api/shops/2/videos/${init.videoId}/chunk?offset=${off}`, undefined, file.subarray(off, off + chunk));
  off = r.data.uploadedBytes;
}
ok(r.data.status === 'ready', `Tải xong → trạng thái ${r.data.status}`);
r = await cm('DELETE', `/api/shops/2/videos/${init.videoId}`);
ok(r.status === 403, `Nhân viên chưa đăng nhập lại vẫn dùng quyền cũ? (${r.status}) — quyền được nạp lại mỗi request`);
r = await cm2('DELETE', `/api/shops/2/videos/${init.videoId}`);
ok(r.status === 200, 'Nhân viên có quyền video xóa được video');

console.log('6) Dọn dẹp');
await admin('PUT', `/api/accounts/${A.id}/shops`, { shopIds: [] });
await admin('PUT', `/api/accounts/${B.id}/shops`, { shopIds: [] });
await ca('DELETE', `/api/accounts/${M.id}`);
await admin('DELETE', `/api/accounts/${A.id}`);
await admin('DELETE', `/api/accounts/${B.id}`);
console.log('Xong.');
