import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Copy, CopyPlus, History, ListVideo, MessageSquare, MessageSquareOff, MoreHorizontal, PencilLine, Pin, Plus, RefreshCw, Repeat, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtDuration, fmtNumber, fmtRelative } from '@/lib/format';
import { useAction, useLocalState } from '@/lib/hooks';
import type { TemplateSummary } from '@/lib/types';
import { Button, ButtonLink } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { SearchInput, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, ErrorState, Menu, Skeleton, Tabs, Tooltip, type MenuItem } from '@/components/ui/misc';
import { CopyTemplateDialog } from '@/components/catalog/CopyTemplateDialog';
import { matchText, REPLY_MODE_LABELS } from '@/components/catalog/labels';
import { VideoThumb } from '@/components/catalog/VideoThumb';
import { useShop } from './ShopLayout';

type Tpl = TemplateSummary & { thumbVideoId: number | null; expectedDurationMin: number | null };
type TabKey = 'all' | 'warn' | 'legacy';
type SortKey = 'number' | 'name' | 'updated' | 'issues';

function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 px-2 py-2">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 flex items-center justify-center gap-1 truncate text-[13px] font-semibold tabular">
        {icon}
        {value}
      </p>
    </div>
  );
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
    invalidate: [['shop', shop.id, 'templates'], ['shop', shop.id, 'videos']],
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
    { label: 'Nhân bản', icon: <CopyPlus />, hidden: !canManage, onClick: () => duplicate.mutate(t) },
    { label: 'Sao chép sang shop khác', icon: <Copy />, hidden: !canManage, onClick: () => setCopying(t) },
    { divider: true, label: '', hidden: !canManage },
    { label: 'Xóa mẫu', icon: <Trash2 />, danger: true, hidden: !canManage, onClick: () => void askDelete(t) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-[15px] font-semibold">Mẫu phát</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Mỗi mẫu là danh sách video phát lần lượt, mỗi video gắn sản phẩm ghim. Khi phát tự động, hệ thống tự ghim sản phẩm khớp với video và mốc thời gian đang phát. Cảnh báo không chặn việc lưu mẫu, nhưng nên xử lý trước khi lên lịch.
          </p>
        </div>
        {canManage && (
          <ButtonLink to="new" variant="primary" icon={<Plus className="size-4" />}>
            Tạo mẫu phát
          </ButtonLink>
        )}
      </div>

      <Card>
        <div className="px-4 pt-2">
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
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tên mẫu, ghi chú, tiêu đề live…" className="w-full sm:w-80" />
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-full sm:ml-auto sm:w-48" aria-label="Sắp xếp">
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
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            icon={ListVideo}
            title="Shop chưa có mẫu phát"
            description="Tạo mẫu đầu tiên: chọn các video trong thư viện, sắp xếp thứ tự phát và gán sản phẩm ghim cho từng video. Mẫu phát dùng để tạo phiên live hoặc lịch phát tự động."
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
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((t) => {
            const extraIssues = t.issueCount - t.issues.length;
            return (
              <Card key={t.id} className={cn('flex flex-col overflow-hidden', t.legacyNeedsReview && 'border-violet-200 dark:border-violet-900/60')}>
                <div className="flex gap-3 p-4">
                  <Link to={`${t.id}`} className="shrink-0" aria-label={`Mở mẫu ${t.name}`}>
                    <VideoThumb shopId={shop.id} videoId={t.thumbVideoId} ready={Boolean(t.thumbVideoId)} className="h-[72px] w-[116px] rounded-lg">
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-px text-[10px] font-medium text-white">{t.videoCount} video</span>
                    </VideoThumb>
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5">
                      <Link to={`${t.id}`} className="line-clamp-2 min-w-0 flex-1 text-[14px] font-semibold leading-snug hover:text-brand-600" title={t.name}>
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
                    <p className={cn('mt-0.5 line-clamp-2 text-xs', t.note || t.liveTitle ? 'text-muted' : 'italic text-subtle')}>{t.note || (t.liveTitle ? `Tiêu đề live: ${t.liveTitle}` : 'Chưa có ghi chú')}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.legacyNeedsReview && (
                        <Tooltip content="Nhập từ hệ thống cũ — cần gán lại sản phẩm ghim và kiểm tra thứ tự video. Lưu mẫu một lần để xác nhận.">
                          <Badge tone="violet" size="sm" icon={<History className="size-3" />}>
                            Nhập từ hệ thống cũ — cần gán lại sản phẩm ghim
                          </Badge>
                        </Tooltip>
                      )}
                      {t.usedBySchedule && (
                        <Badge tone="info" size="sm" icon={<CalendarClock className="size-3" />}>
                          Đang dùng trong lịch phát
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

                <div className="grid grid-cols-4 divide-x divide-line border-y border-line bg-surface-2/40 text-center">
                  <Stat label="Video" value={fmtNumber(t.videoCount)} />
                  <Stat label="Sản phẩm" value={fmtNumber(t.productCount)} icon={<Pin className="size-3 text-muted" />} />
                  <Stat label="Thời lượng" value={t.durationSec ? fmtDuration(t.durationSec) : '—'} />
                  <Stat label="Phát lặp" value={t.loop ? 'Có' : 'Không'} icon={t.loop ? <Repeat className="size-3 text-emerald-500" /> : undefined} />
                </div>

                {t.issues.length > 0 && (
                  <ul className="space-y-1 px-4 py-2.5">
                    {t.issues.slice(0, 3).map((i, idx) => (
                      <li key={idx} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" />
                        <span className="line-clamp-1">{i.message}</span>
                      </li>
                    ))}
                    {(extraIssues > 0 || t.issues.length > 3) && (
                      <li className="pl-5 text-xs text-muted">
                        <Link to={`${t.id}`} className="hover:text-fg hover:underline">
                          và {t.issueCount - Math.min(3, t.issues.length)} cảnh báo khác…
                        </Link>
                      </li>
                    )}
                  </ul>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    {t.replyMode === 'off' ? <MessageSquareOff className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                    {REPLY_MODE_LABELS[t.replyMode]}
                  </span>
                  {t.expectedDurationMin ? <span>Dự kiến {fmtDuration(t.expectedDurationMin * 60)}</span> : null}
                  <Tooltip content={fmtDateTime(t.updatedAt)}>
                    <span>Cập nhật {fmtRelative(t.updatedAt)}</span>
                  </Tooltip>
                  <ButtonLink to={`${t.id}`} size="sm" variant={t.legacyNeedsReview || t.issueCount ? 'primary' : 'outline'} className="ml-auto">
                    {canManage ? (t.legacyNeedsReview ? 'Gán lại sản phẩm' : 'Sửa mẫu') : 'Xem'}
                  </ButtonLink>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CopyTemplateDialog shopId={shop.id} template={copying} onClose={() => setCopying(null)} />
    </div>
  );
}
