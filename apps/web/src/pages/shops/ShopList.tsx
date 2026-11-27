import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  Copy,
  Eye,
  MoreHorizontal,
  Plug,
  Plus,
  RefreshCw,
  Square,
  Store,
  Tag,
  Tags,
  UserPlus,
  X,
  MessageSquareOff,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  PencilLine,
  PackageSearch,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDate, fmtRelative, fmtTime, todayVn, addDaysStr } from '@/lib/format';
import { useCopy, useDebounced, useLocalState, useNow } from '@/lib/hooks';
import type { ShopView } from '@/lib/types';
import { BulkStartDialog } from '@/components/domain/BulkStartDialog';
import { ConnectShopDialog } from '@/components/domain/ConnectShopDialog';
import { GoLiveDialog } from '@/components/live/GoLiveDialog';
import { ShopStatusBadge, ServiceBadge, Signals, ConnectionBadge, RoleBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import { Checkbox, SearchInput, Select } from '@/components/ui/form';
import { Avatar, Badge, Card, EmptyState, ErrorState, Menu, PageHeader, Pagination, Skeleton, Tooltip } from '@/components/ui/misc';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';

const TABS = [
  { value: 'all', label: 'Tất cả shop' },
  { value: 'needs', label: 'Cần xử lý', tone: 'text-amber-600 dark:text-amber-400' },
  { value: 'live', label: 'Đang live', tone: 'text-brand-600 dark:text-brand-400' },
  { value: 'scheduled', label: 'Có lịch hôm nay' },
  { value: 'expiring', label: 'Hạn dùng sắp hết' },
  { value: 'disconnected', label: 'Chưa kết nối' },
  { value: 'suspended', label: 'Đã ngưng' },
] as const;

const SORTS = [
  { value: 'attention', label: 'Cần xử lý trước' },
  { value: 'number', label: 'Số thứ tự' },
  { value: 'name', label: 'Tên A–Z' },
  { value: 'viewers', label: 'Nhiều người xem nhất' },
  { value: 'expiry', label: 'Hạn dùng gần nhất' },
  { value: 'auth', label: 'Hạn uỷ quyền gần nhất' },
];

function LiveDuration({ since }: { since: string }) {
  const now = useNow(1000);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return <span className="tabular">{h ? `${h} giờ ${m} phút` : `${m} phút`}</span>;
}

export default function ShopList() {
  const { isStaff, role, can } = useAuth();
  const nav = useNavigate();
  const copy = useCopy();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'all';
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q, 250);
  const [assignee, setAssignee] = useState('');
  const [owner, setOwner] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useLocalState('mexo-shop-sort', 'attention');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [connectOpen, setConnectOpen] = useState(false);
  const [reauth, setReauth] = useState<ShopView | null>(null);
  const [goLiveShop, setGoLiveShop] = useState<ShopView | null>(null);
  const [bulkStart, setBulkStart] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const pageSize = 50;

  useEffect(() => setPage(1), [tab, dq, assignee, owner, tag, sort]);

  const list = useQuery({
    queryKey: ['shops', { tab, dq, assignee, owner, tag, sort, page }],
    queryFn: () => api.get('/api/shops', { tab, q: dq, assignee, owner, tag, sort, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const items: ShopView[] = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};
  const allSelected = items.length > 0 && items.every((s) => selected.has(s.id));

  const setTab = (t: string) => {
    const p = new URLSearchParams(params);
    if (t === 'all') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
    setSelected(new Set());
  };

  async function bulk(action: string, value?: unknown, label = 'Đã thực hiện') {
    try {
      const r = await api.post('/api/shops/bulk', { ids: [...selected], action, value });
      if (r.failed) toast.warning(`${label}: ${r.ok} shop thành công, ${r.failed} shop lỗi`, { description: r.results.filter((x: any) => !x.ok).slice(0, 3).map((x: any) => x.message).join('; ') });
      else toast.success(`${label} cho ${r.ok} shop`);
      setSelected(new Set());
      void list.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function rowAction(s: ShopView, action: string) {
    try {
      if (action === 'stop') {
        const r = await confirm({ title: `Dừng đẩy hình — ${s.name}?`, description: 'Người xem sẽ thấy hình đứng, phiên vẫn mở trên Shopee. Bấm "Kết thúc live" trong phiên để đóng hẳn.', danger: true, confirmText: 'Dừng đẩy hình' });
        if (!r.ok) return;
        await api.post(`/api/sessions/${s.session!.id}/stream/stop`);
        toast.success('Đã dừng đẩy hình');
      } else if (action === 'expiry') {
        const r = await confirm({ title: `Đặt hạn dùng — ${s.name}`, description: 'Hạn dùng theo hợp đồng, tính theo giờ Việt Nam.', input: { label: 'Hạn dùng mới', type: 'date', required: true, defaultValue: s.service.expiresOn ?? addDaysStr(todayVn(), 365) }, confirmText: 'Lưu hạn dùng' });
        if (!r.ok) return;
        await api.post(`/api/shops/${s.id}/service-expiry`, { date: r.value });
        toast.success('Đã đặt hạn dùng');
      } else if (action === 'alias') {
        const r = await confirm({ title: 'Tên gợi nhớ', description: 'Chỉ nhân viên nội bộ thấy. Để trống để xóa.', input: { label: 'Tên gợi nhớ', defaultValue: s.alias ?? '', placeholder: s.shopeeName } });
        if (!r.ok) return;
        await api.patch(`/api/shops/${s.id}`, { alias: r.value.trim() || null });
        toast.success('Đã lưu tên gợi nhớ');
      } else if (action === 'suspend') {
        const r = await confirm({
          title: `Ngưng dịch vụ — ${s.name}?`,
          description: 'Dùng khi chấm dứt hợp đồng. Shop chuyển sang ô "Đã ngưng", chủ shop không vào được nữa. Video đang phát sẽ dừng.',
          danger: true,
          input: { label: 'Lý do', required: true, multiline: true },
          confirmText: 'Ngưng dịch vụ',
        });
        if (!r.ok) return;
        await api.post(`/api/shops/${s.id}/suspend`, { reason: r.value });
        toast.success('Đã ngưng dịch vụ');
      } else if (action === 'reopen') {
        const r = await confirm({ title: `Mở lại dịch vụ — ${s.name}`, description: 'Dùng lại token cũ, không cần cấp quyền lại (nếu token còn hiệu lực).', input: { label: 'Hạn dùng mới', type: 'date', required: true, defaultValue: addDaysStr(todayVn(), 365) }, confirmText: 'Mở lại' });
        if (!r.ok) return;
        await api.post(`/api/shops/${s.id}/reopen`, { serviceExpiresOn: r.value });
        toast.success('Đã mở lại dịch vụ');
      }
      void list.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const tagOptions: string[] = list.data?.tags ?? [];
  const assignees: { id: number; name: string }[] = list.data?.assignees ?? [];
  const owners: { id: number; name: string }[] = list.data?.owners ?? [];

  return (
    <div>
      <PageHeader
        title="Gian hàng"
        description="Theo dõi trạng thái kết nối, phiên live và hạn dùng của tất cả shop"
        actions={
          (role !== 'member' || can('shop.connect')) && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setConnectOpen(true)}>
              Kết nối shop
            </Button>
          )
        }
      />

      <div className="scrollbar-none -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const n = counts[t.value] ?? 0;
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors',
                active ? 'border-brand-400 bg-surface text-fg shadow-card ring-1 ring-brand-400' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg',
              )}
            >
              {t.label}
              <span className={cn('rounded-md px-1.5 py-px text-xs tabular', active ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300' : 'bg-surface-2', n > 0 && 'tone' in t ? t.tone : '')}>{n}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tên shop, tên cũ, Shop ID, nhóm…" className="w-full sm:w-72" />
          {assignees.length > 0 && (
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-44">
              <option value="">Mọi người phụ trách</option>
              <option value="none">Chưa giao</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
          {isStaff && owners.length > 0 && (
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-44">
              <option value="">Mọi chủ shop</option>
              <option value="none">MEXO vận hành</option>
              {owners.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
          {tagOptions.length > 0 && (
            <Select value={tag} onChange={(e) => setTag(e.target.value)} className="w-40">
              <option value="">Mọi nhóm</option>
              {tagOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-48 sm:ml-auto">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button iconOnly variant="ghost" icon={<RefreshCw className={cn('size-4', list.isFetching && 'animate-spin')} />} onClick={() => list.refetch()} aria-label="Làm mới" />
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-50/60 px-3 py-2 dark:bg-brand-950/20">
            <span className="text-sm font-medium">Đã chọn {selected.size} shop</span>
            <button onClick={() => setSelected(new Set())} className="rounded p-0.5 text-muted hover:text-fg" aria-label="Bỏ chọn">
              <X className="size-4" />
            </button>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {can('session.control') && can('session.create') && (
                <Button size="sm" variant="primary" icon={<PlayCircle className="size-3.5" />} onClick={() => setBulkStart(true)}>
                  Bắt đầu phát
                </Button>
              )}
              {role !== 'member' && (
                <Button
                  size="sm"
                  icon={<Tags className="size-3.5" />}
                  onClick={async () => {
                    const r = await confirm({ title: 'Thêm vào nhóm', input: { label: 'Tên nhóm', required: true, placeholder: 'vd: Mỹ phẩm, Khách VIP…' } });
                    if (r.ok) void bulk('tags_add', r.value.trim(), 'Đã thêm nhóm');
                  }}
                >
                  Thêm nhóm
                </Button>
              )}
              {role !== 'member' && (
                <Button
                  size="sm"
                  icon={<UserPlus className="size-3.5" />}
                  onClick={() => setAssignOpen(true)}
                >
                  Giao phụ trách
                </Button>
              )}
              {isStaff && (
                <Button
                  size="sm"
                  icon={<CalendarPlus className="size-3.5" />}
                  onClick={async () => {
                    const r = await confirm({ title: `Đặt hạn dùng cho ${selected.size} shop`, input: { label: 'Hạn dùng mới', type: 'date', required: true, defaultValue: addDaysStr(todayVn(), 365) } });
                    if (r.ok) void bulk('expiry', r.value, 'Đã đặt hạn dùng');
                  }}
                >
                  Đặt hạn dùng
                </Button>
              )}
              <Menu
                trigger={({ toggle }) => (
                  <Button size="sm" onClick={toggle} icon={<MoreHorizontal className="size-3.5" />}>
                    Khác
                  </Button>
                )}
                items={[
                  { label: 'Đồng bộ sản phẩm', icon: <PackageSearch />, onClick: () => void bulk('sync_products', undefined, 'Đã bắt đầu đồng bộ') },
                  { label: 'Bật trả lời tự động', icon: <MessageSquare />, onClick: () => void bulk('reply_on', undefined, 'Đã bật trả lời tự động') },
                  { label: 'Tắt trả lời tự động', icon: <MessageSquareOff />, onClick: () => void bulk('reply_off', undefined, 'Đã tắt trả lời tự động') },
                  {
                    label: 'Gỡ khỏi nhóm',
                    icon: <Tag />,
                    hidden: role === 'member',
                    onClick: async () => {
                      const r = await confirm({ title: 'Gỡ khỏi nhóm', input: { label: 'Tên nhóm', required: true } });
                      if (r.ok) void bulk('tags_remove', r.value.trim(), 'Đã gỡ nhóm');
                    },
                  },
                  { divider: true, label: '' },
                  {
                    label: 'Dừng đẩy hình',
                    icon: <Square />,
                    danger: true,
                    onClick: async () => {
                      const r = await confirm({ title: `Dừng đẩy hình ${selected.size} shop?`, description: 'Người xem thấy hình đứng, phiên vẫn mở.', danger: true, requireText: 'DUNG' });
                      if (r.ok) void bulk('stop_feed', undefined, 'Đã dừng đẩy hình');
                    },
                  },
                ]}
              />
            </div>
          </div>
        )}

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Store}
            title={dq ? 'Không có shop phù hợp' : 'Chưa có shop nào trong mục này'}
            description={dq ? 'Thử tìm theo tên khác, tên cũ hoặc Shop ID.' : tab === 'all' ? 'Kết nối shop Shopee đầu tiên để bắt đầu livestream tự động.' : undefined}
            action={tab === 'all' && !dq && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setConnectOpen(true)}>Kết nối shop</Button>}
          />
        ) : (
          <Table minWidth={1040}>
            <THead>
              <tr>
                <Th className="w-10">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={!allSelected && items.some((s) => selected.has(s.id))}
                    onChange={(v) => {
                      const n = new Set(selected);
                      items.forEach((s) => (v ? n.add(s.id) : n.delete(s.id)));
                      setSelected(n);
                    }}
                  />
                </Th>
                <Th className="w-10">#</Th>
                <Th>Shop</Th>
                <Th className="w-[200px]">Tình trạng</Th>
                <Th>Phiên hiện tại</Th>
                <Th className="w-[150px]">Lịch tiếp theo</Th>
                <Th className="w-[150px]">Hạn dùng · Shopee</Th>
                <Th className="w-10" />
              </tr>
            </THead>
            <tbody>
              {items.map((s) => {
                const problems = s.issues.filter((i) => i.level !== 'info' && i.code !== 'reauth' && i.code !== 'revoked' && i.code !== 'auth_expired' && i.code !== 'expired' && i.code !== 'expiring' && i.code !== 'auth_expiring');
                const legacyUnverified = s.session?.origin === 'legacy' && s.session.state === 'unknown';
                return (
                <Tr key={s.id} selected={selected.has(s.id)} onClick={() => nav(`/shops/${s.id}`)}>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(s.id)}
                      onChange={(v) => {
                        const n = new Set(selected);
                        if (v) n.add(s.id);
                        else n.delete(s.id);
                        setSelected(n);
                      }}
                    />
                  </Td>
                  <Td className="text-xs tabular text-subtle">{s.number}</Td>
                  <Td className="max-w-[280px]">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Link to={`/shops/${s.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium hover:text-brand-600">
                        {s.name}
                      </Link>
                      {s.tags.slice(0, 2).map((t) => (
                        <Badge key={t} tone="muted" size="sm" className="shrink-0">
                          {t}
                        </Badge>
                      ))}
                      {s.tags.length > 2 && <span className="shrink-0 text-2xs text-subtle">+{s.tags.length - 2}</span>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {s.alias && s.shopeeName ? `${s.shopeeName} · ` : ''}
                      <span className="font-mono text-2xs text-subtle">{s.shopeeShopId}</span>
                      {(s.assignee || s.owner) && <span> · {s.assignee ? `PT: ${s.assignee.name}` : s.owner!.name}</span>}
                    </p>
                  </Td>
                  <Td>
                    <ShopStatusBadge status={s.status} size="sm" />
                    {problems.length > 0 && (
                      <p className={cn('mt-0.5 flex items-center gap-1 text-2xs', problems[0]!.level === 'critical' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400')}>
                        <AlertTriangle className="size-3 shrink-0" />
                        <span className="truncate">{problems[0]!.text}</span>
                        {problems.length > 1 && <span className="shrink-0 text-subtle">+{problems.length - 1}</span>}
                      </p>
                    )}
                  </Td>
                  <Td className="max-w-[320px]">
                    {s.session ? (
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.session.title}</p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                          {legacyUnverified ? (
                            <span className="text-amber-700 dark:text-amber-400">Hệ thống cũ · chưa xác minh</span>
                          ) : s.session.startedAt ? (
                            <span className="tabular">
                              {fmtTime(s.session.startedAt)} · <LiveDuration since={s.session.startedAt} />
                            </span>
                          ) : (
                            <span>Chưa lên sóng</span>
                          )}
                          <span className="inline-flex items-center gap-0.5 tabular">
                            <Eye className="size-3" />
                            {s.session.viewers}
                          </span>
                          {s.session.videoCount ? <span className="tabular">V{(s.session.videoIndex ?? 0) + 1}/{s.session.videoCount}</span> : null}
                          {s.session.origin !== 'legacy' && <Signals signals={s.session.signals} compact />}
                          {s.session.shareUrl && (
                            <button
                              className="ml-auto inline-flex shrink-0 items-center gap-0.5 hover:text-brand-600"
                              title="Chép link xem live"
                              onClick={(e) => {
                                e.stopPropagation();
                                void copy(s.session!.shareUrl!, 'Đã chép link xem live');
                              }}
                            >
                              <Copy className="size-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-subtle">—</span>
                    )}
                  </Td>
                  <Td>
                    {s.nextRun ? (
                      <div className="min-w-0 text-xs">
                        <p className={cn('inline-flex items-center gap-1 font-medium tabular', s.nextRun.today && 'text-sky-700 dark:text-sky-400')}>
                          <CalendarClock className="size-3.5" />
                          {s.nextRun.today ? `Hôm nay ${fmtTime(s.nextRun.startAt)}` : `${fmtDate(s.nextRun.startAt).slice(0, 5)} ${fmtTime(s.nextRun.startAt)}`}
                        </p>
                        <p className="mt-0.5 max-w-[140px] truncate text-muted">{s.nextRun.title}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-subtle">—</span>
                    )}
                  </Td>
                  <Td>
                    <div className="text-xs">
                      <ServiceBadge state={s.service.state} daysLeft={s.service.daysLeft} expiresOn={s.service.expiresOn} size="sm" />
                    </div>
                    <div className="mt-0.5">
                      {s.connection === 'ok' ? (
                        <Tooltip content={s.authExpiresAt ? `Uỷ quyền Shopee tới ${fmtDate(s.authExpiresAt)}` : 'Đang kết nối Shopee'}>
                          <span className="text-2xs text-muted">Shopee {s.authExpiresAt ? fmtRelative(s.authExpiresAt).replace('sau ', 'còn ') : 'đang kết nối'}</span>
                        </Tooltip>
                      ) : (
                        <ConnectionBadge state={s.connection} size="sm" />
                      )}
                    </div>
                  </Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={({ toggle }) => <Button iconOnly variant="ghost" size="sm" icon={<MoreHorizontal className="size-4" />} onClick={toggle} aria-label="Thao tác" />}
                      items={[
                        { label: 'Mở shop', icon: <Store />, onClick: () => nav(`/shops/${s.id}`) },
                        { label: 'Phát ngay', icon: <Zap />, hidden: Boolean(s.session) || !can('session.create') || !can('session.control') || !['ready', 'scheduled', 'attention'].includes(s.status) || !['ok', 'expiring'].includes(s.connection), onClick: () => setGoLiveShop(s) },
                        { label: 'Mở phiên', icon: <PlayCircle />, hidden: !s.session, onClick: () => nav(`/sessions/${s.session!.id}`) },
                        { label: 'Dừng đẩy hình', icon: <Square />, hidden: !s.session || s.session.signals.feed === 'off', onClick: () => void rowAction(s, 'stop') },
                        { divider: true, label: '' },
                        { label: s.connection === 'ok' ? 'Cấp quyền lại' : 'Kết nối lại', icon: <Plug />, onClick: () => setReauth(s), hidden: s.status === 'suspended' },
                        { label: 'Tên gợi nhớ', icon: <PencilLine />, onClick: () => void rowAction(s, 'alias'), hidden: role === 'member' },
                        { label: 'Đặt hạn dùng', icon: <CalendarPlus />, onClick: () => void rowAction(s, 'expiry'), hidden: !isStaff },
                        { divider: true, label: '', hidden: !isStaff },
                        { label: 'Ngưng dịch vụ', icon: <PauseCircle />, danger: true, onClick: () => void rowAction(s, 'suspend'), hidden: !isStaff || s.status === 'suspended' },
                        { label: 'Mở lại dịch vụ', icon: <PlayCircle />, onClick: () => void rowAction(s, 'reopen'), hidden: !isStaff || s.status !== 'suspended' },
                      ]}
                    />
                  </Td>
                </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4 py-2.5">
            <Pagination page={page} pageSize={pageSize} total={list.data.total} onChange={setPage} />
          </div>
        )}
      </Card>

      <AssignDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        count={selected.size}
        staff={isStaff}
        onPick={(id) => {
          setAssignOpen(false);
          void bulk('assign', id, id ? 'Đã giao phụ trách' : 'Đã bỏ giao phụ trách');
        }}
      />
      <BulkStartDialog
        open={bulkStart}
        onClose={() => {
          setBulkStart(false);
          setSelected(new Set());
        }}
        shops={items.filter((s) => selected.has(s.id)).map((s) => ({ id: s.id, name: s.name }))}
      />
      <ConnectShopDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      {goLiveShop && <GoLiveDialog open onClose={() => setGoLiveShop(null)} shopId={goLiveShop.id} shopName={goLiveShop.name} />}
      <ConnectShopDialog open={Boolean(reauth)} onClose={() => setReauth(null)} reauthShopId={reauth?.id} reauthName={reauth?.name} />
    </div>
  );
}

/** Chọn người phụ trách cho các shop đã chọn (quản trị: nhân viên vận hành; chủ shop: nhân viên của mình) */
function AssignDialog({ open, onClose, onPick, count, staff }: { open: boolean; onClose: () => void; onPick: (id: number | null) => void; count: number; staff: boolean }) {
  const [q, setQ] = useState('');
  const accs = useQuery({
    queryKey: ['accounts', 'assignable'],
    queryFn: async () => (await api.get('/api/accounts')).items as { id: number; username: string; name: string; role: string; status: string; isSelf: boolean }[],
    enabled: open,
  });
  const list = (accs.data ?? [])
    .filter((a) => a.status === 'active' && ((staff ? a.role === 'admin' || a.role === 'sysadmin' : a.role === 'member') || a.isSelf))
    .filter((a) => !q || `${a.name} ${a.username}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={`Giao người phụ trách — ${count} shop`} description={staff ? 'Nhân viên vận hành phụ trách các shop này' : 'Nhân viên của bạn phụ trách các shop này (cấp quyền xem shop trong trang Nhân viên)'}>
      <div className="space-y-3">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm theo tên hoặc tên đăng nhập…" autoFocus />
        <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {list.map((a) => (
            <button key={a.id} onClick={() => onPick(a.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
              <Avatar name={a.name} className="size-7 text-2xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{a.name}</span>
                <span className="block text-xs text-muted">@{a.username}</span>
              </span>
              <RoleBadge role={a.role} size="sm" />
            </button>
          ))}
          {!accs.isLoading && !list.length && <p className="px-3 py-6 text-center text-xs text-muted">Không có tài khoản phù hợp</p>}
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => onPick(null)}>
          Bỏ giao phụ trách
        </Button>
      </div>
    </Dialog>
  );
}
