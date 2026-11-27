const VN = 'vi-VN';
const TZ = 'Asia/Ho_Chi_Minh';

type D = string | number | Date | null | undefined;
const toDate = (d: D) => (d === null || d === undefined || d === '' ? null : d instanceof Date ? d : new Date(d));

export function fmtDateTime(d: D, opts: { seconds?: boolean } = {}): string {
  const x = toDate(d);
  if (!x || isNaN(x.getTime())) return '—';
  return x.toLocaleString(VN, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(opts.seconds ? { second: '2-digit' } : {}), hour12: false });
}

export function fmtDate(d: D): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, dd] = d.split('-');
    return `${dd}/${m}/${y}`;
  }
  const x = toDate(d);
  if (!x || isNaN(x.getTime())) return '—';
  return x.toLocaleDateString(VN, { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtTime(d: D, seconds = false): string {
  const x = toDate(d);
  if (!x || isNaN(x.getTime())) return '—';
  return x.toLocaleTimeString(VN, { timeZone: TZ, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false });
}

/** "3 phút trước", "sau 2 giờ" */
export function fmtRelative(d: D): string {
  const x = toDate(d);
  if (!x) return '—';
  const diff = (x.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const suffix = diff < 0 ? ' trước' : '';
  const prefix = diff > 0 ? 'sau ' : '';
  if (abs < 45) return diff < 0 ? 'vừa xong' : 'sắp tới';
  if (abs < 3600) return `${prefix}${Math.round(abs / 60)} phút${suffix}`;
  if (abs < 86400) return `${prefix}${Math.round(abs / 3600)} giờ${suffix}`;
  if (abs < 86400 * 30) return `${prefix}${Math.round(abs / 86400)} ngày${suffix}`;
  return fmtDate(x);
}

/** 3725 → "1:02:05" */
export function fmtClock(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

/** 3725 → "1 giờ 2 phút" */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} ngày ${h} giờ`;
  if (h) return `${h} giờ ${m} phút`;
  if (m) return `${m} phút`;
  return `${s} giây`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return n.toLocaleString(VN, { maximumFractionDigits: digits });
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Intl.NumberFormat(VN, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtMoney(n: number | null | undefined, currency = 'VND'): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString(VN, { style: 'currency', currency, maximumFractionDigits: 0 });
}

export function fmtPercent(r: number | null | undefined, digits = 1): string {
  if (r === null || r === undefined || !isFinite(r)) return '—';
  return `${(r * 100).toFixed(digits)}%`;
}

export function todayVn(): string {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
}

export function addDaysStr(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayVn() + 'T00:00:00Z')) / 86400000);
}
