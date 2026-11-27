import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileUp, MinusCircle, RotateCcw, Scale } from 'lucide-react';
import { foldVi } from '@mexo/shared';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDaysStr, fmtDate, fmtNumber, fmtPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { SearchInput, Segmented } from '@/components/ui/form';
import { Badge, Callout, Pagination, Spinner, StatCard } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { daysInclusive } from './common';

// ───────────── Đọc CSV ─────────────
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = ([',', ';', '\t'] as const).map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x));
}

const norm = (h: string) => foldVi(h).replace(/[^a-z0-9%]/g, '');
const pad = (s: string) => s.padStart(2, '0');

type Col = 'date' | 'api' | 'total' | 'success' | 'failed' | 'rate';
function detectColumns(header: string[]): Partial<Record<Col, number>> {
  const cols: Partial<Record<Col, number>> = {};
  header.forEach((raw, i) => {
    const h = norm(raw);
    if (!h) return;
    const isRate = /rate|ratio|tyle|percent|%/.test(h);
    const isSuccess = /success|succeed|thanhcong|^ok/.test(h);
    const isFail = /fail|error|loi|thatbai/.test(h);
    const isCount = /call|count|total|tong|request|solan|luot/.test(h);
    if (cols.date === undefined && /^(date|day|ngay|time|thoigian|statdate)/.test(h)) cols.date = i;
    else if (isRate) cols.rate ??= i;
    else if (isSuccess) cols.success ??= i;
    else if (isFail) cols.failed ??= i;
    else if (isCount && !/api(name|path)?$/.test(h)) cols.total ??= i;
    else if (/api|path|endpoint|interface|method|name/.test(h)) cols.api ??= i;
  });
  return cols;
}

function parseCount(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.replace(/\s/g, '');
  if (!t) return null;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  if (/^-?\d+([.,]\d+)?$/.test(t)) return Math.round(Number(t.replace(',', '.')));
  const digits = t.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function parseRate(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(t.replace('%', ''));
  if (!isFinite(n)) return null;
  return t.includes('%') || n > 1 ? n / 100 : n;
}

/** Chuẩn hóa tên API: bỏ domain, bỏ tiền tố /api/v2/ */
export function normApi(s: string): string {
  return s
    .trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/?api\/v2\//i, '')
    .replace(/^\/+/, '')
    .replace(/\?.*$/, '')
    .toLowerCase();
}

function normDates(values: string[]): (string | null)[] {
  // Xác định thứ tự ngày/tháng cho dạng có dấu "/" : nếu có phần thứ hai > 12 thì là MM/DD
  let monthFirst = false;
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v.trim());
    if (m && Number(m[2]) > 12) monthFirst = true;
  }
  return values.map((v) => {
    const t = v.trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
    if (m) return `${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
    if (m) return monthFirst ? `${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}` : `${m[3]}-${pad(m[2]!)}-${pad(m[1]!)}`;
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  });
}

interface Stat {
  total: number;
  success: number;
}

export interface ParsedStats {
  map: Map<string, Stat>;
  rows: number;
  skipped: number;
  minDate: string | null;
  maxDate: string | null;
  columns: Partial<Record<Col, number>>;
  header: string[];
}

/** Đọc file thống kê (Shopee Console hoặc file xuất của MEXO) → map "ngày|api" */
export function parseStats(text: string): ParsedStats {
  const all = parseCsv(text);
  let hIdx = -1;
  let cols: Partial<Record<Col, number>> = {};
  for (let i = 0; i < Math.min(all.length, 15); i++) {
    const c = detectColumns(all[i]!);
    if (c.date !== undefined && c.api !== undefined && (c.total !== undefined || (c.success !== undefined && c.failed !== undefined))) {
      hIdx = i;
      cols = c;
      break;
    }
  }
  if (hIdx < 0) throw new Error('Không nhận ra cột trong file. Cần có cột Ngày (Date), API và Tổng lệnh gọi (Total Calls) hoặc Thành công + Thất bại.');
  const body = all.slice(hIdx + 1);
  const dates = normDates(body.map((r) => r[cols.date!] ?? ''));
  const map = new Map<string, Stat>();
  let skipped = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  body.forEach((r, i) => {
    const date = dates[i];
    const apiName = normApi(r[cols.api!] ?? '');
    if (!date || !apiName || /^(total|tong|sum)/.test(norm(apiName))) {
      skipped++;
      return;
    }
    let total = parseCount(cols.total !== undefined ? r[cols.total] : undefined);
    let success = parseCount(cols.success !== undefined ? r[cols.success] : undefined);
    const failed = parseCount(cols.failed !== undefined ? r[cols.failed] : undefined);
    const rate = parseRate(cols.rate !== undefined ? r[cols.rate] : undefined);
    if (total === null && success !== null && failed !== null) total = success + failed;
    if (success === null && total !== null && failed !== null) success = total - failed;
    if (success === null && total !== null && rate !== null) success = Math.round(total * rate);
    if (total === null || success === null) {
      skipped++;
      return;
    }
    const key = `${date}|${apiName}`;
    const prev = map.get(key) ?? { total: 0, success: 0 };
    map.set(key, { total: prev.total + total, success: prev.success + success });
    if (!minDate || date < minDate) minDate = date;
    if (!maxDate || date > maxDate) maxDate = date;
  });
  return { map, rows: body.length - skipped, skipped, minDate, maxDate, columns: cols, header: all[hIdx]! };
}

// ───────────── So sánh ─────────────
type Verdict = 'match' | 'diff' | 'only_ours' | 'only_shopee';
interface DiffRow {
  key: string;
  date: string;
  api: string;
  ours: Stat | null;
  theirs: Stat | null;
  diff: number;
  diffPct: number;
  ratePp: number | null;
  verdict: Verdict;
}

const rate = (s: Stat | null) => (s && s.total ? s.success / s.total : null);

function compare(ours: Map<string, Stat>, theirs: Map<string, Stat>, byDay: boolean): DiffRow[] {
  const fold = (m: Map<string, Stat>) => {
    if (!byDay) return m;
    const o = new Map<string, Stat>();
    for (const [k, v] of m) {
      const d = k.split('|')[0]! + '|*';
      const p = o.get(d) ?? { total: 0, success: 0 };
      o.set(d, { total: p.total + v.total, success: p.success + v.success });
    }
    return o;
  };
  const a = fold(ours);
  const b = fold(theirs);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const [date, apiName] = key.split('|') as [string, string];
    const o = a.get(key) ?? null;
    const t = b.get(key) ?? null;
    const diff = (o?.total ?? 0) - (t?.total ?? 0);
    const base = Math.max(o?.total ?? 0, t?.total ?? 0, 1);
    const ro = rate(o);
    const rt = rate(t);
    const ratePp = ro !== null && rt !== null ? (ro - rt) * 100 : null;
    const verdict: Verdict = !t ? 'only_ours' : !o ? 'only_shopee' : Math.abs(diff) / base > 0.01 || (ratePp !== null && Math.abs(ratePp) > 1) ? 'diff' : 'match';
    rows.push({ key, date, api: apiName, ours: o, theirs: t, diff, diffPct: diff / base, ratePp, verdict });
  }
  return rows.sort((x, y) => y.date.localeCompare(x.date) || x.api.localeCompare(y.api));
}

const VERDICT: Record<Verdict, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  match: { label: 'Khớp', cls: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle2 },
  diff: { label: 'Lệch > 1%', cls: 'text-rose-600 dark:text-rose-400', icon: AlertTriangle },
  only_ours: { label: 'Không có ở Shopee', cls: 'text-amber-700 dark:text-amber-400', icon: MinusCircle },
  only_shopee: { label: 'Không có ở MEXO', cls: 'text-amber-700 dark:text-amber-400', icon: MinusCircle },
};

export function ConsoleReconcile() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [shopee, setShopee] = useState<ParsedStats | null>(null);
  const [ours, setOurs] = useState<ParsedStats | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; clamped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'mismatch' | 'all'>('mismatch');
  const [group, setGroup] = useState<'api' | 'day'>('api');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  async function onFile(file: File) {
    setError(null);
    setShopee(null);
    setOurs(null);
    setRange(null);
    setFileName(file.name);
    setPage(1);
    if (file.size > 20 * 1024 * 1024) {
      setError('File quá lớn (tối đa 20 MB).');
      return;
    }
    setLoading(true);
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ''));
        fr.onerror = () => reject(new Error('Không đọc được file'));
        fr.readAsText(file);
      });
      const parsed = parseStats(text);
      if (!parsed.map.size || !parsed.minDate || !parsed.maxDate) throw new Error('File không có dòng dữ liệu hợp lệ.');
      let from = parsed.minDate;
      const to = parsed.maxDate;
      const clamped = daysInclusive(from, to) > 90;
      if (clamped) from = addDaysStr(to, -89);
      const csv = await api.get<string>('/api/monitor/export', { from, to });
      const mine = parseStats(typeof csv === 'string' ? csv : '');
      if (clamped) for (const k of [...parsed.map.keys()]) if (k.split('|')[0]! < from) parsed.map.delete(k);
      setShopee(parsed);
      setOurs(mine);
      setRange({ from, to, clamped });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const rows = useMemo(() => (shopee && ours ? compare(ours.map, shopee.map, group === 'day') : []), [shopee, ours, group]);
  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { match: 0, diff: 0, only_ours: 0, only_shopee: 0 };
    rows.forEach((r) => c[r.verdict]++);
    return c;
  }, [rows]);
  const totals = useMemo(() => {
    const sum = (m: Map<string, Stat> | undefined) => [...(m?.values() ?? [])].reduce((s, v) => ({ total: s.total + v.total, success: s.success + v.success }), { total: 0, success: 0 });
    return { ours: sum(ours?.map), theirs: sum(shopee?.map) };
  }, [ours, shopee]);
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return rows.filter((r) => (view === 'all' || r.verdict !== 'match') && (!f || r.api.includes(f) || r.date.includes(f)));
  }, [rows, view, q]);
  const pageSize = 100;
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalDiffPct = totals.theirs.total ? (totals.ours.total - totals.theirs.total) / totals.theirs.total : null;

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-2 text-sm text-muted lg:col-span-3">
          <p className="font-medium text-fg">Đối chiếu số liệu MEXO với Shopee Open Platform Console</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Trên Console Shopee, mở thống kê lệnh gọi API của App và xuất file CSV theo ngày và API.</li>
            <li>Tải file lên đây — file được đọc ngay trên trình duyệt, không gửi lên máy chủ.</li>
            <li>Hệ thống so từng cặp ngày + API với số liệu MEXO ghi nhận và tô đỏ chênh lệch &gt; 1%.</li>
          </ol>
          <p className="text-xs">
            Chấp nhận tiêu đề cột như <span className="font-mono">Date, API, Total Calls, Success Calls, Failed Calls, Success Rate</span> (hoặc tiếng Việt tương đương); tiền tố <span className="font-mono">/api/v2/</span> tự được bỏ.
          </p>
        </div>
        <div className="lg:col-span-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
            className="flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface-2/40 p-4 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:hover:bg-brand-950/20"
          >
            {loading ? <Spinner className="size-5" /> : <FileUp className="size-6 text-muted" />}
            <span className="text-sm font-medium">{loading ? 'Đang đọc và đối chiếu…' : fileName ? 'Chọn file khác' : 'Chọn hoặc kéo thả file CSV từ Console Shopee'}</span>
            {fileName && !loading && (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <FileSpreadsheet className="size-3.5" />
                {fileName}
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </div>
      </div>

      {error && <Callout tone="danger" title="Không đối chiếu được">{error}</Callout>}

      {shopee && ours && range && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Scale className="size-4" />
            Khoảng so sánh: <b className="text-fg">{fmtDate(range.from)} – {fmtDate(range.to)}</b> · {shopee.rows} dòng hợp lệ từ file{shopee.skipped ? `, bỏ qua ${shopee.skipped} dòng không đọc được` : ''}
            <Button
              size="xs"
              variant="ghost"
              icon={<RotateCcw className="size-3" />}
              onClick={() => {
                setShopee(null);
                setOurs(null);
                setFileName(null);
                setRange(null);
              }}
            >
              Làm lại
            </Button>
          </div>
          {range.clamped && <Callout tone="warning">File dài hơn 90 ngày — chỉ so sánh 90 ngày cuối.</Callout>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Khớp" value={counts.match} icon={<CheckCircle2 className="size-4" />} tone="success" hint={`trên ${rows.length} dòng`} />
            <StatCard label="Lệch > 1%" value={counts.diff} icon={<AlertTriangle className="size-4" />} tone={counts.diff ? 'danger' : 'neutral'} />
            <StatCard label="Chỉ một bên có" value={counts.only_ours + counts.only_shopee} icon={<MinusCircle className="size-4" />} tone={counts.only_ours + counts.only_shopee ? 'warning' : 'neutral'} hint={`${counts.only_ours} chỉ MEXO · ${counts.only_shopee} chỉ Shopee`} />
            <StatCard
              label="Tổng lệnh gọi MEXO / Shopee"
              value={<span className="text-lg">{fmtNumber(totals.ours.total)} / {fmtNumber(totals.theirs.total)}</span>}
              hint={totalDiffPct !== null ? `Chênh ${totalDiffPct >= 0 ? '+' : ''}${(totalDiffPct * 100).toFixed(2)}% · tỷ lệ ${fmtPercent(rate(totals.ours), 2)} vs ${fmtPercent(rate(totals.theirs), 2)}` : undefined}
              icon={<Scale className="size-4" />}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented<'mismatch' | 'all'> value={view} onChange={(v) => (setView(v), setPage(1))} options={[{ value: 'mismatch', label: 'Chỉ dòng chênh lệch', count: rows.length - counts.match }, { value: 'all', label: 'Tất cả', count: rows.length }]} />
            <Segmented<'api' | 'day'> value={group} onChange={(v) => (setGroup(v), setPage(1))} options={[{ value: 'api', label: 'Theo ngày + API' }, { value: 'day', label: 'Tổng theo ngày' }]} />
            {group === 'api' && <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Lọc theo API hoặc ngày…" className="w-full sm:w-64" />}
          </div>

          <div className="overflow-hidden rounded-lg border border-line">
            {visible.length ? (
              <Table minWidth={960}>
                <THead>
                  <tr>
                    <Th>Ngày</Th>
                    {group === 'api' && <Th>API</Th>}
                    <Th align="right">Tổng MEXO</Th>
                    <Th align="right">Tổng Shopee</Th>
                    <Th align="right">Chênh lệch</Th>
                    <Th align="right">Tỷ lệ MEXO</Th>
                    <Th align="right">Tỷ lệ Shopee</Th>
                    <Th align="right">Lệch tỷ lệ</Th>
                    <Th>Kết quả</Th>
                  </tr>
                </THead>
                <tbody>
                  {visible.map((r) => {
                    const V = VERDICT[r.verdict];
                    const Icon = V.icon;
                    const bad = r.verdict !== 'match';
                    return (
                      <Tr key={r.key} className={cn(r.verdict === 'diff' && 'bg-rose-50/60 dark:bg-rose-950/20')}>
                        <Td className="whitespace-nowrap tabular">{fmtDate(r.date)}</Td>
                        {group === 'api' && <Td className="font-mono text-xs">{r.api}</Td>}
                        <Td align="right" className="tabular">{r.ours ? fmtNumber(r.ours.total) : '—'}</Td>
                        <Td align="right" className="tabular">{r.theirs ? fmtNumber(r.theirs.total) : '—'}</Td>
                        <Td align="right" className={cn('tabular', bad && Math.abs(r.diffPct) > 0.01 && 'font-semibold text-rose-600 dark:text-rose-400')}>
                          {r.diff > 0 ? '+' : ''}
                          {fmtNumber(r.diff)}
                          <span className="ml-1 text-2xs font-normal text-muted">({(r.diffPct * 100).toFixed(1)}%)</span>
                        </Td>
                        <Td align="right" className="tabular">{fmtPercent(rate(r.ours), 2)}</Td>
                        <Td align="right" className="tabular">{fmtPercent(rate(r.theirs), 2)}</Td>
                        <Td align="right" className={cn('tabular', r.ratePp !== null && Math.abs(r.ratePp) > 1 && 'font-semibold text-rose-600 dark:text-rose-400')}>
                          {r.ratePp === null ? '—' : `${r.ratePp > 0 ? '+' : ''}${r.ratePp.toFixed(2)} đ%`}
                        </Td>
                        <Td>
                          <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium', V.cls)}>
                            <Icon className="size-3.5" />
                            {V.label}
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
                <CheckCircle2 className="size-4 text-emerald-500" />
                {view === 'mismatch' ? 'Không có dòng chênh lệch — số liệu khớp với Console Shopee.' : 'Không có dòng phù hợp.'}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="border-t border-line px-4 py-2.5">
                <Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} />
              </div>
            )}
          </div>
          <Callout tone="neutral">
            MEXO tính theo ngày giờ Việt Nam (UTC+7). Nếu Console Shopee dùng múi giờ khác (ví dụ UTC+8), số liệu từng ngày có thể lệch nhẹ ở ranh giới ngày trong khi tổng cả kỳ vẫn khớp — xem chế độ <Badge size="sm" tone="neutral">Tổng theo ngày</Badge> và tổng ở trên để phân biệt.
          </Callout>
        </>
      )}
    </div>
  );
}
