import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Copy, CopyPlus, History, ImageOff, ListVideo, MessageSquare, MessageSquareOff, MoreHorizontal, PencilLine, Plus, RefreshCw, Repeat, Trash2, Wand2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtDuration, fmtNumber, fmtRelative } from '@/lib/format';
import { useAction, useLocalState } from '@/lib/hooks';
import type { TemplateSummary } from '@/lib/types';
import { GoLiveDialog } from '@/components/live/GoLiveDialog';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { SearchInput, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, ErrorState, Menu, Skeleton, Tabs, Tooltip, type MenuItem } from '@/components/ui/misc';
import { CopyTemplateDialog } from '@/components/catalog/CopyTemplateDialog';
import { matchText, REPLY_MODE_LABELS } from '@/components/catalog/labels';
import { useShop } from './ShopLayout';

type Tpl = TemplateSummary & { thumbVideoId: number | null; expectedDurationMin: number | null };
type TabKey = 'all' | 'warn' | 'legacy';
type SortKey = 'number' | 'name' | 'updated' | 'issues';

function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 px-2 py-2 text-center">
      <p className="text-2xs text-muted">{label}</p>
      <p className="flex items-center justify-center gap-1 whitespace-nowrap text-sm font-semibold tabular">
        {icon}
        {value}
      </p>
    </div>
  );
}

function CoverThumb({ coverKey }: { coverKey: string | null }) {
  const [err, setErr] = useState(false);
  if (!coverKey || err)
    return (
      <span className={cn('grid aspect-[3/4] w-14 place-items-center rounded-md border border-dashed text-center', coverKey ? 'border-line-strong text-subtle' : 'border-amber-300 bg-amber-50/60 text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400')}>
        <span className="flex flex-col items-center gap-0.5 px-1 text-2xs leading-tight">
          <ImageOff className="size-4" />
          {!coverKey && 'Chưa có bìa'}
        </span>
      </span>
    );
  return <img src={`/api/files/cover?key=${encodeURIComponent(coverKey)}`} alt="Ảnh bìa" loading="lazy" onError={() => setErr(true)} className="aspect-[3/4] w-14 rounded-md object-cover ring-1 ring-line" />;
}

export default function ShopTemplates() {
  const { shop } = useShop();
  const { can } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const canManage = can('template.manage');
  const [tab, setTab] = useState<TabKey>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useLocalState<SortKey>('mexo-template-sort', 'number');
  const [copying, setCopying] = useState<Tpl | null>(null);
  const [goLiveTpl, setGoLiveTpl] = useState<number | null>(null);

  // Phát ngay: cần quyền tạo + điều khiển phiên, shop đang kết nối, không có phiên đang chạy
  const canGoLive = can('session.create') && can('session.control');
  const goLiveBlocked = shop.session
    ? 'Shop đang có phiên live — mở phiên đang chạy để điều khiển'
    : shop.connection !== 'ok' && shop.connection !== 'expiring'
      ? 'Shop chưa kết nối Shopee — cần cấp quyền lại'
      : shop.status === 'expired' || shop.status === 'suspended'
        ? 'Shop đã hết hạn hoặc ngưng dịch vụ'
        : null;

  const list = useQuery({
    queryKey: ['shop', shop.id, 'templates'],
    queryFn: () => api.get<{ items: Tpl[]; counts: { all: number; warn: number } }>(`/api/shops/${shop.id}/templates`),
  });
  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const legacyCount = all.filter((t) => t.legacyNeedsReview).length;

  const items = useMemo(() => {
    const f = all.filter((t) => (tab === 'all' ? true : tab === 'warn' ? t.issueCount > 0 : t.legacyNeedsReview) && matchText(q, t.name, t.note, t.liveTitle, `#${t.number}`));
    const s = [...f];
    if (sort === 'name') s.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    else if (sort === 'updated') s.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    else if (sort === 'issues') s.sort((a, b) => b.issueCount - a.issueCount || a.number - b.number);
    else s.sort((a, b) => a.number - b.number);
    return s;
  }, [all, tab, q, sort]);

  const duplicate = useAction((t: Tpl) => api.post<{ id: number }>(`/api/shops/${shop.id}/templates/${t.id}/duplicate`), {
    invalidate: [['shop', shop.id, 'templates']],
    onSuccess: (r, t) => toast.success(`Đã nhân bản “${t.name}”`, { action: { label: 'Mở bản sao', onClick: () => nav(`/shops/${shop.id}/templates/${r.id}`) } }),
  });
  const remove = useAction((t: Tpl) => api.del(`/api/shops/${shop.id}/templates/${t.id}`), {
    success: 'Đã xóa mẫu phát',
    invalidate: [
      ['shop', shop.id, 'templates'],
      ['shop', shop.id, 'videos'],
    ],
  });

  async function askDelete(t: Tpl) {
    const r = await confirm({
      title: `Xóa mẫu phát “${t.name}”?`,
      description: t.usedBySchedule
        ? 'Mẫu đang được lịch phát sử dụng nên hệ thống sẽ không cho xóa. Hãy đổi sang mẫu khác hoặc hủy lịch phát trước.'
        : 'Mẫu bị xóa vĩnh viễn. Video và sản phẩm trong thư viện không bị ảnh hưởng.',
      danger: true,
      confirmText: t.usedBySchedule ? 'Vẫn thử xóa' : 'Xóa mẫu',
    });
    if (r.ok) remove.mutate(t);
  }

  const menu = (t: Tpl): MenuItem[] => [
    { label: canManage ? 'Sửa mẫu' : 'Xem chi tiết', icon: <PencilLine />, onClick: () => nav(`${t.id}`) },
    { label: 'Phát ngay', icon: <Zap />, hidden: !canGoLive || !t.legacyNeedsReview, disabled: Boolean(goLiveBlocked), hint: goLiveBlocked ? 'Không khả dụng' : undefined, onClick: () => setGoLiveTpl(t.id) },
    { label: 'Nhân bản', icon: <CopyPlus />, hidden: !canManage, onClick: () => duplicate.mutate(t) },
    { label: 'Sao chép sang shop khác', icon: <Copy />, hidden: !canManage, onClick: () => setCopying(t) },
    { divider: true, label: '', hidden: !canManage },
    { label: 'Xóa mẫu', icon: <Trash2 />, danger: true, hidden: !canManage, onClick: () => void askDelete(t) },
  ];

  function primaryAction(t: Tpl) {
    if (t.legacyNeedsReview && canManage)
      return (
        <ButtonLink to={`${t.id}`} size="sm" variant="primary" icon={<Wand2 className="size-3.5" />}>
          Gán lại sản phẩm
        </ButtonLink>
      );
    if (!canGoLive) return null;
    const btn = (
      <Button size="sm" variant="primary" icon={<Zap className="size-3.5" />} disabled={Boolean(goLiveBlocked)} onClick={() => setGoLiveTpl(t.id)}>
        Phát ngay
      </Button>
    );
    return goLiveBlocked ? <Tooltip content={goLiveBlocked}>{btn}</Tooltip> : btn;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-base font-semibold">Mẫu phát</h2>
          <p className="mt-0.5 text-sm text-muted">Mỗi mẫu là danh sách video phát lần lượt, mỗi video ghim một sản phẩm. Tiêu đề và ảnh bìa của mẫu được dùng khi Phát ngay hoặc lịch phát không đặt riêng.</p>
        </div>
        {canManage && (
          <ButtonLink to="new" variant="primary" icon={<Plus className="size-4" />}>
            Tạo mẫu phát
          </ButtonLink>
        )}
      </div>

      <Card>
        <div className="px-4 pt-1">
          <Tabs<TabKey>
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'Tất cả', count: list.data?.counts.all ?? null },
              { value: 'warn', label: 'Cần kiểm tra', count: list.data?.counts.warn ?? null, tone: 'warning' },
              ...(legacyCount ? [{ value: 'legacy' as const, label: 'Nhập từ hệ thống cũ', count: legacyCount, tone: 'violet' as const }] : []),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <SearchInput value={q} onChange={setQ} placeholder="Tên mẫu, ghi chú, tiêu đề live…" className="w-full sm:w-80" />
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="min-w-0 flex-1 sm:ml-auto sm:w-48 sm:flex-none" aria-label="Sắp xếp">
            <option value="number">Thứ tự tạo</option>
            <option value="name">Tên A–Z</option>
            <option value="updated">Cập nhật gần nhất</option>
            <option value="issues">Nhiều cảnh báo nhất</option>
          </Select>
          <Button iconOnly variant="ghost" icon={<RefreshCw className={cn('size-4', list.isFetching && 'animate-spin')} />} onClick={() => list.refetch()} aria-label="Làm mới" />
        </div>
      </Card>

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListVideo}
            title="Shop chưa có mẫu phát"
            description="Tạo mẫu đầu tiên: chọn video trong thư viện, sắp xếp thứ tự phát và chọn sản phẩm ghim cho từng video. Mẫu phát dùng để Phát ngay hoặc đặt lịch phát tự động."
            action={
              canManage && (
                <ButtonLink to="new" variant="primary" icon={<Plus className="size-4" />}>
                  Tạo mẫu phát
                </ButtonLink>
              )
            }
          />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState compact icon={ListVideo} title="Không có mẫu phù hợp" description={q ? 'Thử từ khóa khác.' : 'Không có mẫu nào trong mục này.'} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((t) => {
            const shown = t.issues.slice(0, 3);
            const more = t.issueCount - shown.length;
            const noPins = t.videoCount > 0 && t.productCount === 0;
            return (
              <Card key={t.id} className={cn('flex flex-col', t.legacyNeedsReview && 'border-violet-200 dark:border-violet-900/60')}>
                <div className="flex gap-3 p-4">
                  <Link to={`${t.id}`} className="shrink-0" aria-label={`Mở mẫu ${t.name}`}>
                    <CoverThumb coverKey={t.coverKey} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1">
                      <Link to={`${t.id}`} className="line-clamp-2 min-w-0 flex-1 text-base font-semibold leading-snug hover:text-brand-600" title={t.name}>
                        {t.name}
                      </Link>
                      <Menu
                        width="w-56"
                        trigger={({ toggle }) => (
                          <button type="button" onClick={toggle} className="-mr-1 rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Thao tác">
                            <MoreHorizontal className="size-4" />
                          </button>
                        )}
                        items={menu(t)}
                      />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted" title={t.liveTitle ?? undefined}>
                      <span className="text-subtle">Tiêu đề live:</span> {t.liveTitle || <i className="text-subtle">dùng tên mẫu</i>}
                    </p>
                    {t.note && (
                      <p className="truncate text-xs text-subtle" title={t.note}>
                        {t.note}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {t.legacyNeedsReview && (
                        <span className="inline-flex items-start gap-1 rounded-xl bg-violet-50 px-1.5 py-px text-2xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900">
                          <History className="mt-0.5 size-3 shrink-0" />
                          Nhập từ hệ thống cũ — cần gán lại sản phẩm ghim
                        </span>
                      )}
                      {t.usedBySchedule && (
                        <Badge tone="info" size="sm" icon={<CalendarClock className="size-3" />}>
                          Dùng trong lịch phát
                        </Badge>
                      )}
                      {t.issueCount > 0 ? (
                        <Badge tone="warning" size="sm" icon={<AlertTriangle className="size-3" />}>
                          {t.issueCount} cảnh báo
                        </Badge>
                      ) : (
                        <Badge tone="success" size="sm" icon={<CheckCircle2 className="size-3" />}>
                          Sẵn sàng phát
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 divide-x divide-line border-y border-line bg-surface-2/40">
                  <Stat label="Video" value={fmtNumber(t.videoCount)} />
                  <Stat label="Sản phẩm" value={fmtNumber(t.productCount)} icon={noPins ? <AlertTriangle className="size-3 text-amber-500" /> : undefined} />
                  <Stat label="Thời lượng" value={t.durationSec ? fmtDuration(t.durationSec) : '—'} />
                  <Stat label="Phát lặp" value={t.loop ? 'Có' : 'Không'} icon={t.loop ? <Repeat className="size-3 text-emerald-500" /> : undefined} />
                </div>

                {shown.length > 0 && (
                  <ul className="space-y-1 px-4 py-2.5">
                    {shown.map((i, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span className="line-clamp-1">{i.message}</span>
                      </li>
                    ))}
                    {more > 0 && (
                      <li className="pl-5 text-xs text-muted">
                        <Link to={`${t.id}`} className="hover:text-fg hover:underline">
                          và {more} cảnh báo khác…
                        </Link>
                      </li>
                    )}
                  </ul>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    {t.replyMode === 'off' ? <MessageSquareOff className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                    {REPLY_MODE_LABELS[t.replyMode]}
                  </span>
                  <Tooltip content={fmtDateTime(t.updatedAt)}>
                    <span>Cập nhật {fmtRelative(t.updatedAt)}</span>
                  </Tooltip>
                  <div className="ml-auto flex items-center gap-1.5">
                    {!(t.legacyNeedsReview && canManage) && (
                      <ButtonLink to={`${t.id}`} size="sm" variant="outline">
                        {canManage ? 'Sửa' : 'Xem'}
                      </ButtonLink>
                    )}
                    {primaryAction(t)}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CopyTemplateDialog shopId={shop.id} template={copying} onClose={() => setCopying(null)} />
      <GoLiveDialog open={goLiveTpl !== null} onClose={() => setGoLiveTpl(null)} shopId={shop.id} shopName={shop.name} defaultTemplateId={goLiveTpl} />
    </div>
  );
}
