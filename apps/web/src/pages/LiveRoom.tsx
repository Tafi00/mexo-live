import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Eye, Heart, Pin, Radio, RefreshCw, Server, ShoppingBag, Square, Timer, X, XOctagon } from 'lucide-react';
import { toast } from 'sonner';
import { foldVi, OPEN_SESSION_STATES, SESSION_STATE_LABELS } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtClock, fmtNumber } from '@/lib/format';
import { useAction, useLocalState, useNow } from '@/lib/hooks';
import { ProductThumb } from '@/components/domain/ProductPicker';
import { SessionStateBadge, Signals, StreamStateBadge } from '@/components/domain/status';
import { liveSeconds } from '@/components/live/helpers';
import type { BulkResult, LiveRoomItem } from '@/components/live/types';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Checkbox, SearchInput, Select, Switch } from '@/components/ui/form';
import { Callout, Card, EmptyState, ErrorState, PageHeader, Progress, Skeleton, StatCard } from '@/components/ui/misc';

type Sort = 'problem' | 'viewers' | 'newest' | 'shop';

/** Phiên có vấn đề: treo, mất hình, lỗi tín hiệu, trạng thái bất thường, shop có cảnh báo */
function problemsOf(it: LiveRoomItem): string[] {
  const s = it.session;
  const out: string[] = [];
  if (s.stuck) out.push('Phiên có vẻ treo');
  if (s.state === 'disconnected') out.push('Mất kết nối');
  if (s.state === 'sync_error') out.push('Lỗi đồng bộ với Shopee');
  if (s.state === 'unknown') out.push('Chưa xác minh trạng thái');
  if (s.streamState === 'lost') out.push('Máy chủ mất kết nối');
  else if (s.streamState === 'error') out.push('Lỗi đẩy hình');
  if (s.signals.pin === 'attn') out.push('Ghim lỗi');
  if (s.signals.reply === 'attn') out.push('Trả lời lỗi');
  for (const i of it.shop.issues) if (i.level !== 'info') out.push(i.text);
  return out;
}

function LiveCard({ it, selected, onSelect, selectable, now, fetchedAt }: { it: LiveRoomItem; selected: boolean; onSelect: (v: boolean) => void; selectable: boolean; now: number; fetchedAt: number }) {
  const s = it.session;
  const problems = problemsOf(it);
  const dur = liveSeconds(s.startedAt, null, now);
  const pushing = s.streamState === 'pushing';
  const pos = s.positionSec !== null ? Math.min(s.videoDuration ?? Infinity, s.positionSec + (pushing ? Math.max(0, (now - fetchedAt) / 1000) : 0)) : null;
  const external = s.origin === 'external';
  return (
    <Card className={cn('flex flex-col transition-colors', selected && 'border-brand-400 ring-1 ring-brand-400', !selected && problems.length > 0 && 'border-amber-300 dark:border-amber-900/70')}>
      <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
        {selectable && (
          <div className="pt-0.5">
            <Checkbox checked={selected} onChange={onSelect} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link to={`/shops/${it.shop.id}`} className="block truncate text-[13px] font-semibold hover:text-brand-600">
            {it.shop.name}
          </Link>
          <p className="font-mono text-[11px] text-subtle">{it.shop.shopeeShopId}</p>
        </div>
        {dur !== null && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular text-muted">
            <Timer className="size-3.5" />
            {fmtClock(dur)}
          </span>
        )}
      </div>

      <Link to={`/sessions/${s.id}`} className="group block flex-1 space-y-3 px-4 py-3 hover:bg-surface-2/40">
        <div className="flex flex-wrap items-center gap-1.5">
          <SessionStateBadge state={s.state} stuck={s.stuck} size="sm" />
          {!external && <StreamStateBadge state={s.streamState} size="sm" />}
          {external && <span className="text-[11px] text-violet-700 dark:text-violet-300">App Shopee</span>}
        </div>
        <p className="line-clamp-2 text-[13px] font-medium leading-snug group-hover:text-brand-600">{s.title}</p>

        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: Eye, label: 'Đang xem', value: s.viewers },
            { icon: Heart, label: 'Thích', value: s.likes },
            { icon: ShoppingBag, label: 'Đơn', value: s.orders },
          ].map((x) => (
            <div key={x.label} className="rounded-md bg-surface-2 px-2 py-1.5">
              <p className="flex items-center gap-1 text-[11px] text-muted">
                <x.icon className="size-3" />
                {x.label}
              </p>
              <p className="text-[15px] font-semibold tabular">{fmtNumber(x.value)}</p>
            </div>
          ))}
        </div>

        {s.videoCount ? (
          <div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-muted">
                Video <b className="font-semibold text-fg tabular">{(s.videoIndex ?? 0) + 1}/{s.videoCount}</b>
                {s.videoName ? ` · ${s.videoName}` : ''}
              </span>
              {pos !== null && s.videoDuration ? (
                <span className="shrink-0 tabular text-subtle">
                  {fmtClock(pos)}/{fmtClock(s.videoDuration)}
                </span>
              ) : null}
            </div>
            <Progress className="mt-1.5" size="sm" value={pos ?? 0} max={s.videoDuration || 1} tone={pushing ? 'brand' : 'muted'} />
          </div>
        ) : (
          !external && <p className="text-xs text-subtle">Chưa phát tự động</p>
        )}

        {s.pinned ? (
          <div className="flex items-center gap-2">
            <ProductThumb url={s.pinned.imageUrl} className="size-8" />
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-[11px] text-muted">
                <Pin className="size-3" /> Đang ghim
              </p>
              <p className="truncate text-xs font-medium">{s.pinned.name}</p>
            </div>
          </div>
        ) : null}
      </Link>

      <div className="space-y-2 border-t border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!external ? <Signals signals={s.signals} /> : <span />}
          {s.serverName && (
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted">
              <Server className="size-3 shrink-0" />
              <span className="truncate">{s.serverName}</span>
            </span>
          )}
        </div>
        {problems.length > 0 && (
          <ul className="space-y-0.5">
            {problems.slice(0, 3).map((p, i) => (
              <li key={i} className="flex items-start gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px size-3 shrink-0" />
                <span className="line-clamp-1">{p}</span>
              </li>
            ))}
            {problems.length > 3 && <li className="pl-4 text-[11px] text-muted">+{problems.length - 3} vấn đề khác</li>}
          </ul>
        )}
        {s.lastError && !problems.length && <p className="line-clamp-2 text-[11px] text-amber-700 dark:text-amber-400">{s.lastError}</p>}
      </div>
    </Card>
  );
}

export default function LiveRoom() {
  const { can } = useAuth();
  const confirm = useConfirm();
  const now = useNow(1000);
  const [q, setQ] = useState('');
  const [onlyProblems, setOnlyProblems] = useLocalState('mexo-live-problems', false);
  const [state, setState] = useState('');
  const [sort, setSort] = useLocalState<Sort>('mexo-live-sort', 'problem');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkResult, setBulkResult] = useState<{ label: string; r: BulkResult } | null>(null);

  const live = useQuery({ queryKey: ['live'], queryFn: () => api.get<{ items: LiveRoomItem[] }>('/api/live'), refetchInterval: 5000 });
  const items = live.data?.items ?? [];

  // Bỏ chọn các phiên đã không còn mở
  useEffect(() => {
    if (!selected.size) return;
    const ids = new Set(items.map((i) => i.session.id));
    const next = new Set([...selected].filter((x) => ids.has(x)));
    if (next.size !== selected.size) setSelected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data]);

  const stats = useMemo(
    () => ({
      open: items.length,
      live: items.filter((i) => i.session.state === 'live').length,
      problems: items.filter((i) => problemsOf(i).length > 0).length,
      viewers: items.reduce((s, i) => s + (i.session.viewers ?? 0), 0),
      orders: items.reduce((s, i) => s + (i.session.orders ?? 0), 0),
    }),
    [items],
  );

  const stateCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.session.state] = (m[i.session.state] ?? 0) + 1;
    return m;
  }, [items]);

  const list = useMemo(() => {
    const f = foldVi(q);
    const out = items.filter((i) => {
      if (state && i.session.state !== state) return false;
      if (onlyProblems && !problemsOf(i).length) return false;
      if (!f) return true;
      return foldVi(i.shop.name).includes(f) || foldVi(i.session.title).includes(f) || String(i.shop.shopeeShopId).includes(f) || String(i.session.shopeeSessionId ?? '').includes(f);
    });
    const ts = (x: LiveRoomItem) => Date.parse(x.session.startedAt ?? x.session.createdAt);
    out.sort((a, b) => {
      if (sort === 'viewers') return b.session.viewers - a.session.viewers;
      if (sort === 'newest') return ts(b) - ts(a);
      if (sort === 'shop') return a.shop.name.localeCompare(b.shop.name, 'vi');
      return problemsOf(b).length - problemsOf(a).length || b.session.viewers - a.session.viewers;
    });
    return out;
  }, [items, q, state, onlyProblems, sort]);

  const bulk = useAction((v: { action: 'end' | 'stop_feed' | 'sync'; label: string }) => api.post<BulkResult>('/api/sessions/bulk', { ids: [...selected], action: v.action }), {
    invalidate: [['live'], ['shops'], ['dashboard']],
    onSuccess: (r, v) => {
      if (r.failed) toast.warning(`${v.label}: ${r.ok} phiên thành công, ${r.failed} phiên lỗi`);
      else toast.success(`${v.label}: ${r.ok} phiên thành công`);
      setBulkResult({ label: v.label, r });
      setSelected(new Set());
    },
  });

  async function runBulk(action: 'end' | 'stop_feed' | 'sync') {
    const n = selected.size;
    if (action === 'sync') return bulk.mutate({ action, label: 'Đồng bộ trạng thái' });
    if (action === 'stop_feed') {
      const r = await confirm({
        title: `Dừng đẩy hình ${n} phiên?`,
        description: 'Máy chủ ngừng đẩy video. Người xem sẽ thấy hình đứng, các phiên vẫn mở trên Shopee. Phiên không có việc phát nào sẽ báo lỗi và được bỏ qua.',
        danger: true,
        confirmText: 'Dừng đẩy hình',
      });
      if (r.ok) bulk.mutate({ action, label: 'Dừng đẩy hình' });
      return;
    }
    const r = await confirm({
      title: `Kết thúc ${n} phiên live?`,
      description: 'Các phiên sẽ kết thúc trên Shopee và không thể mở lại. Phiên mở từ app Shopee sẽ được bỏ qua.',
      danger: true,
      requireText: 'KETTHUC',
      confirmText: `Kết thúc ${n} phiên`,
    });
    if (r.ok) bulk.mutate({ action, label: 'Kết thúc live' });
  }

  const titleOf = (id: number) => {
    const it = items.find((i) => i.session.id === id);
    return it ? `${it.shop.name} — ${it.session.title}` : `Phiên #${id}`;
  };
  const allSel = list.length > 0 && list.every((i) => selected.has(i.session.id));
  const canControl = can('session.control');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Phòng điều khiển"
        description="Theo dõi mọi phiên đang mở trên các gian hàng — tự cập nhật mỗi 5 giây"
        actions={
          <Button icon={<RefreshCw className={cn('size-4', live.isFetching && 'animate-spin')} />} onClick={() => live.refetch()}>
            Làm mới
          </Button>
        }
      />

      {live.isError ? (
        <Card>
          <ErrorState error={live.error} onRetry={() => live.refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Phiên đang mở" value={live.data ? fmtNumber(stats.open) : '—'} hint={live.data ? `${fmtNumber(stats.live)} đang livestream` : undefined} icon={<Radio className="size-4" />} tone="brand" />
            <StatCard label="Có vấn đề" value={live.data ? fmtNumber(stats.problems) : '—'} hint="Bấm để lọc" icon={<AlertTriangle className="size-4" />} tone={stats.problems ? 'warning' : 'success'} onClick={() => setOnlyProblems(!onlyProblems)} active={onlyProblems} />
            <StatCard label="Tổng người xem" value={live.data ? fmtNumber(stats.viewers) : '—'} icon={<Eye className="size-4" />} tone="info" />
            <StatCard label="Đơn hàng" value={live.data ? fmtNumber(stats.orders) : '—'} icon={<ShoppingBag className="size-4" />} tone="success" />
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2 p-3">
              <SearchInput value={q} onChange={setQ} placeholder="Tên shop, tiêu đề, Shop ID, Session ID…" className="w-full sm:w-72" />
              <Select value={state} onChange={(e) => setState(e.target.value)} className="w-48">
                <option value="">Mọi trạng thái ({items.length})</option>
                {OPEN_SESSION_STATES.map((st) => (
                  <option key={st} value={st}>
                    {SESSION_STATE_LABELS[st]} ({stateCounts[st] ?? 0})
                  </option>
                ))}
              </Select>
              <Switch checked={onlyProblems} onChange={setOnlyProblems} size="sm" label={<span className="text-[13px]">Chỉ phiên có vấn đề</span>} />
              <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-48 sm:ml-auto">
                <option value="problem">Có vấn đề trước</option>
                <option value="viewers">Nhiều người xem nhất</option>
                <option value="newest">Mới lên sóng</option>
                <option value="shop">Theo tên shop</option>
              </Select>
            </div>
            {list.length > 0 && (
              <div className={cn('flex flex-wrap items-center gap-2 border-t border-line px-3 py-2', selected.size > 0 && 'bg-brand-50/60 dark:bg-brand-950/20')}>
                <Checkbox
                  checked={allSel}
                  indeterminate={!allSel && list.some((i) => selected.has(i.session.id))}
                  onChange={(v) => {
                    const n = new Set(selected);
                    list.forEach((i) => (v ? n.add(i.session.id) : n.delete(i.session.id)));
                    setSelected(n);
                  }}
                  label={<span className="text-[13px] font-medium">{selected.size ? `Đã chọn ${selected.size} phiên` : `Chọn tất cả (${list.length})`}</span>}
                />
                {selected.size > 0 && (
                  <>
                    <button onClick={() => setSelected(new Set())} className="rounded p-0.5 text-muted hover:text-fg" aria-label="Bỏ chọn">
                      <X className="size-4" />
                    </button>
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      <Button size="sm" icon={<RefreshCw className="size-3.5" />} disabled={bulk.isPending} onClick={() => void runBulk('sync')}>
                        Đồng bộ
                      </Button>
                      {canControl && (
                        <>
                          <Button size="sm" icon={<Square className="size-3.5" />} disabled={bulk.isPending} onClick={() => void runBulk('stop_feed')}>
                            Dừng đẩy hình
                          </Button>
                          <Button size="sm" variant="danger-outline" icon={<XOctagon className="size-3.5" />} loading={bulk.isPending} onClick={() => void runBulk('end')}>
                            Kết thúc live
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>

          {bulkResult && (
            <Callout
              tone={bulkResult.r.failed ? 'warning' : 'success'}
              title={`${bulkResult.label}: ${bulkResult.r.ok} phiên thành công${bulkResult.r.failed ? `, ${bulkResult.r.failed} phiên lỗi` : ''}`}
              action={
                <button type="button" onClick={() => setBulkResult(null)} className="rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Đóng">
                  <X className="size-4" />
                </button>
              }
            >
              {bulkResult.r.failed > 0 && (
                <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs">
                  {bulkResult.r.results
                    .filter((x) => !x.ok)
                    .map((x) => (
                      <li key={x.id}>
                        <span className="font-medium">{titleOf(x.id)}</span>: {x.message ?? 'Lỗi không xác định'}
                      </li>
                    ))}
                </ul>
              )}
            </Callout>
          )}

          {live.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[340px] rounded-xl" />
              ))}
            </div>
          ) : !items.length ? (
            <Card>
              <EmptyState icon={Radio} title="Không có phiên nào đang mở" description="Khi một gian hàng tạo phiên hoặc lịch phát tự bật, phiên sẽ xuất hiện ở đây." action={<ButtonLink to="/shops">Đến danh sách gian hàng</ButtonLink>} />
            </Card>
          ) : !list.length ? (
            <Card>
              <EmptyState
                icon={Radio}
                title="Không có phiên phù hợp bộ lọc"
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setQ('');
                      setState('');
                      setOnlyProblems(false);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {list.map((it) => (
                <LiveCard
                  key={it.session.id}
                  it={it}
                  now={now}
                  fetchedAt={live.dataUpdatedAt}
                  selectable
                  selected={selected.has(it.session.id)}
                  onSelect={(v) => {
                    const n = new Set(selected);
                    if (v) n.add(it.session.id);
                    else n.delete(it.session.id);
                    setSelected(n);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
