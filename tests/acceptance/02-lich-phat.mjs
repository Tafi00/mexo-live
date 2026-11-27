// Chạy thử lịch phát: bật sau ~1-2 phút, tắt sau ~3-4 phút, kiểm tra tự bật/tự tắt đúng giờ
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
const log = (...a) => console.log(new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 19), ...a);
const [user, pass, shopId] = process.argv.slice(2);
await call('POST', '/api/auth/login', { username: user, password: pass });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 'cover.png');
const cover = await call('POST', '/api/files/cover', undefined, fd);
const tpl = (await call('GET', `/api/shops/${shopId}/templates`)).items[0];
const vn = new Date(Date.now() + 7 * 3600e3);
const hhmm = (d) => d.toISOString().slice(11, 16);
const date = vn.toISOString().slice(0, 10);
const start = new Date(vn.getTime() + 120e3);
start.setUTCSeconds(0);
const end = new Date(start.getTime() + 120e3);
const sch = await call('POST', `/api/shops/${shopId}/schedules`, { title: 'E2E - Lịch thử', templateId: tpl.id, coverKey: cover.key, repeat: 'once', weekdays: [], startDate: date, endDate: null, startTime: hhmm(start), endTime: hhmm(end) });
log(`Tạo lịch #${sch.id} ${hhmm(start)}–${hhmm(end)}`);
// Lịch chồng giờ phải bị chặn
try {
  await call('POST', `/api/shops/${shopId}/schedules`, { title: 'Trùng', templateId: tpl.id, coverKey: cover.key, repeat: 'daily', weekdays: [], startDate: date, endDate: null, startTime: hhmm(start), endTime: hhmm(end) });
  log('LỖI: lịch trùng không bị chặn');
} catch (e) {
  log('Chặn lịch trùng OK:', e.message.slice(60, 200));
}
let last = '';
for (let i = 0; i < 70; i++) {
  const r = await call('GET', `/api/shops/${shopId}/schedules`);
  const run = r.runs.find((x) => x.scheduleId === sch.id);
  let line = `run=${run?.status} issue=${run?.issue ?? '-'} session=${run?.sessionId ?? '-'}`;
  if (run?.sessionId) {
    const s = (await call('GET', `/api/sessions/${run.sessionId}`)).session;
    line += ` | phiên ${s.state}/${s.streamState} started=${s.startedAt ? new Date(new Date(s.startedAt).getTime() + 7 * 3600e3).toISOString().slice(11, 19) : '-'} ended=${s.endedAt ? new Date(new Date(s.endedAt).getTime() + 7 * 3600e3).toISOString().slice(11, 19) : '-'} reason=${s.endedReason ?? '-'}`;
  }
  if (line !== last) log(line);
  last = line;
  if (run?.status === 'done' || run?.status === 'missed') break;
  await sleep(5000);
}
