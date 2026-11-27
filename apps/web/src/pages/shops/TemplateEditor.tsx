import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, CircleAlert, Clock, History, ImageOff, Info, ListVideo, Package, Plus, Radio, Save, ShieldCheck, Undo2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { foldVi } from '@mexo/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtClock, fmtDateTime, fmtDuration } from '@/lib/format';
import { useAction, useLocalState } from '@/lib/hooks';
import type { TemplateSummary, Video } from '@/lib/types';
import { CoverUpload } from '@/components/domain/CoverUpload';
import { ProductPicker } from '@/components/domain/ProductPicker';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, EmptyState, ErrorState, Kbd, PageLoading } from '@/components/ui/misc';
import { AddVideosDialog } from '@/components/catalog/AddVideosDialog';
import { PlaylistItemRow } from '@/components/catalog/PlaylistItemRow';
import { QuickAssignDialog, type QuickAssignTarget } from '@/components/catalog/QuickAssignDialog';
import {
  analyze,
  draftFromFull,
  emptyDraft,
  fmtAt,
  LIVE_DESC_MAX,
  LIVE_TITLE_MAX,
  NAME_MAX,
  newKey,
  NOTE_MAX,
  primaryPin,
  serialize,
  setPrimary,
  sortPins,
  suggestAt,
  toPayload,
  toPinProduct,
  videoRefOf,
  type Draft,
  type DraftItem,
  type ReplyMode,
  type TemplateFull,
} from '@/components/catalog/templateDraft';
import { useUnsavedGuard } from '@/components/catalog/useUnsavedGuard';
import { useShop } from './ShopLayout';

type TplListItem = TemplateSummary & { thumbVideoId: number | null };

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className={cn('text-2xs tabular', n > max ? 'font-medium text-rose-600' : 'text-subtle')}>
      {n}/{max}
    </span>
  );
}

function SummaryCell({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'error' | 'ok' }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5">
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-md',
          tone === 'error'
            ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
            : tone === 'warn'
              ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400'
              : tone === 'ok'
                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                : 'bg-surface-2 text-muted',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xs text-muted">{label}</p>
        <p className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-lg font-semibold leading-tight tabular">{value}</span>
          {hint && <span className="truncate text-2xs text-muted">{hint}</span>}
        </p>
      </div>
    </div>
  );
}

export default function TemplateEditorPage() {
  const { templateId } = useParams();
  const id = templateId ? Number(templateId) : null;
  return <TemplateEditor key={templateId ?? 'new'} templateId={id && Number.isFinite(id) ? id : null} />;
}

function TemplateEditor({ templateId }: { templateId: number | null }) {
  const { shop } = useShop();
  const { can } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const readOnly = !can('template.manage');
  const isNew = templateId === null;
  const listPath = `/shops/${shop.id}/templates`;

  const tq = useQuery({
    queryKey: ['shop', shop.id, 'templates', templateId],
    queryFn: () => api.get<TemplateFull>(`/api/shops/${shop.id}/templates/${templateId}`),
    enabled: !isNew,
  });
  const lib = useQuery({
    queryKey: ['shop', shop.id, 'videos', 'library'],
    queryFn: () => api.get<{ items: Video[] }>(`/api/shops/${shop.id}/videos`),
  });
  const tlist = useQuery({
    queryKey: ['shop', shop.id, 'templates'],
    queryFn: () => api.get<{ items: TplListItem[] }>(`/api/shops/${shop.id}/templates`),
  });

  const [draft, setDraft] = useState<Draft | null>(() => (isNew ? emptyDraft() : null));
  const [baseline, setBaseline] = useState<string>(() => (isNew ? serialize(emptyDraft()) : ''));
  const [touchedName, setTouchedName] = useState(false);
  const [videoDialog, setVideoDialog] = useState<null | { mode: 'add' } | { mode: 'replace'; key: string }>(null);
  const [pinFor, setPinFor] = useState<{ key: string; mode: 'primary' | 'timed' } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [preferInStock, setPreferInStock] = useLocalState<boolean>('mexo-pin-instock', true);

  const dirty = draft ? serialize(draft) !== baseline : false;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const { guardedNavigate, release } = useUnsavedGuard(dirty && !readOnly);

  // Nạp dữ liệu từ máy chủ (lần đầu, và sau khi lưu nếu không có chỉnh sửa dở)
  const loadedAt = useRef<string | null>(null);
  useEffect(() => {
    if (isNew || !tq.data) return;
    const stamp = tq.data.template.updatedAt;
    if (loadedAt.current === stamp) return;
    if (loadedAt.current !== null && dirtyRef.current) return;
    loadedAt.current = stamp;
    const d = draftFromFull(tq.data);
    setDraft(d);
    setBaseline(serialize(d));
  }, [tq.data, isNew]);

  const libItems = lib.data?.items;
  const libMap = useMemo(() => (libItems ? new Map(libItems.map((v) => [v.id, v])) : null), [libItems]);
  const an = useMemo(() => (draft ? analyze(draft, libMap) : null), [draft, libMap]);
  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (const it of draft?.items ?? []) m.set(it.videoId, (m.get(it.videoId) ?? 0) + 1);
    return m;
  }, [draft?.items]);
  const quickTargets: QuickAssignTarget[] = useMemo(
    () =>
      (draft?.items ?? []).map((it, i) => {
        const p = primaryPin(it.pins);
        const v = libMap?.get(it.videoId) ?? it.video;
        return { key: it.key, position: i + 1, videoName: v?.name ?? `Video #${it.videoId} (đã xóa)`, current: p ? { id: p.productId, name: p.product?.name ?? `Sản phẩm #${p.productId}` } : null };
      }),
    [draft?.items, libMap],
  );

  // ───────────── Kiểm tra trường thông tin ─────────────
  const nameErr = (() => {
    if (!draft) return null;
    const n = draft.name.trim();
    if (!n) return 'Cần nhập tên mẫu';
    if (n.length > NAME_MAX) return `Tên tối đa ${NAME_MAX} ký tự`;
    if (tlist.data?.items.some((t) => t.id !== templateId && foldVi(t.name) === foldVi(n))) return 'Tên mẫu đã tồn tại trong shop (không phân biệt hoa thường và dấu)';
    return null;
  })();
  const fieldErrs = draft ? [draft.note.length > NOTE_MAX, draft.liveTitle.trim().length > LIVE_TITLE_MAX, draft.liveDescription.length > LIVE_DESC_MAX].filter(Boolean).length : 0;
  const totalErrors = (an?.errors ?? 0) + (nameErr ? 1 : 0) + fieldErrs;
  const warnings = an?.warnings ?? 0;
  const summary = tlist.data?.items.find((t) => t.id === templateId);

  // ───────────── Cập nhật bản nháp ─────────────
  const update = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setItems = (fn: (items: DraftItem[]) => DraftItem[]) => setDraft((d) => (d ? { ...d, items: fn(d.items) } : d));
  const updateItem = (key: string, fn: (it: DraftItem) => DraftItem) => setItems((items) => items.map((i) => (i.key === key ? fn(i) : i)));
  const durationOf = (it: DraftItem) => libMap?.get(it.videoId)?.durationSec ?? it.video?.durationSec ?? null;

  const moveItem = (key: string, dir: -1 | 1) =>
    setItems((items) => {
      const i = items.findIndex((x) => x.key === key);
      const j = i + dir;
      return i < 0 || j < 0 || j >= items.length ? items : arrayMove(items, i, j);
    });

  async function removeItem(it: DraftItem, index: number) {
    if (it.pins.length) {
      const r = await confirm({
        title: `Xóa video ở vị trí ${index + 1} khỏi mẫu?`,
        description: `Sản phẩm ghim của dòng này cũng bị bỏ. Video vẫn còn trong thư viện.`,
        danger: true,
        confirmText: 'Xóa khỏi mẫu',
      });
      if (!r.ok) return;
    }
    setItems((items) => items.filter((x) => x.key !== it.key));
  }

  // ───────────── Kéo thả ─────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const posOf = (id: UniqueIdentifier) => (draft?.items.findIndex((i) => i.key === id) ?? -1) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Đã nhấc video ở vị trí ${posOf(active.id)}.`,
    onDragOver: ({ over }) => (over ? `Video đang ở vị trí ${posOf(over.id)}.` : 'Video đang nằm ngoài danh sách.'),
    onDragEnd: ({ over }) => (over ? `Đã thả video vào vị trí ${posOf(over.id)}.` : 'Đã thả video.'),
    onDragCancel: () => 'Đã hủy kéo thả, video giữ nguyên vị trí.',
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((items) => {
      const from = items.findIndex((i) => i.key === active.id);
      const to = items.findIndex((i) => i.key === over.id);
      return from < 0 || to < 0 ? items : arrayMove(items, from, to);
    });
  };

  // ───────────── Lưu ─────────────
  const save = useAction(
    async (d: Draft) => {
      const body = toPayload(d);
      if (isNew) return api.post<{ id: number }>(`/api/shops/${shop.id}/templates`, body);
      await api.put(`/api/shops/${shop.id}/templates/${templateId}`, body);
      return { id: templateId! };
    },
    {
      success: isNew ? 'Đã tạo mẫu phát' : 'Đã lưu mẫu phát',
      invalidate: [
        ['shop', shop.id, 'templates'],
        ['shop', shop.id, 'videos'],
      ],
      onSuccess: (r, d) => {
        setBaseline(serialize(d));
        release();
        if (isNew) navigate(`${listPath}/${r.id}`, { replace: true });
      },
      onError: (e) => {
        if (e instanceof ApiError && e.code === 'duplicate_name') setTouchedName(true);
      },
    },
  );
  const canSave = !readOnly && Boolean(draft) && totalErrors === 0 && (dirty || isNew) && !save.isPending;
  const doSave = () => {
    setTouchedName(true);
    if (draft && canSave) save.mutate(draft);
  };
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSaveRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  async function revert() {
    if (!tq.data) return;
    const r = await confirm({ title: 'Hoàn tác mọi thay đổi?', description: 'Mẫu quay về nội dung đã lưu gần nhất.', confirmText: 'Hoàn tác', danger: true });
    if (!r.ok) return;
    const d = draftFromFull(tq.data);
    setDraft(d);
    setBaseline(serialize(d));
  }

  // ───────────── Hiển thị ─────────────
  if (!isNew && tq.isLoading) return <PageLoading label="Đang tải mẫu phát…" />;
  if (!isNew && (tq.isError || !tq.data))
    return (
      <Card>
        {tq.error instanceof ApiError && tq.error.status === 404 ? (
          <EmptyState
            icon={ListVideo}
            title="Không tìm thấy mẫu phát"
            description="Mẫu có thể đã bị xóa."
            action={
              <Link to={listPath} className="text-sm font-medium text-brand-600 hover:underline">
                Về danh sách mẫu phát
              </Link>
            }
          />
        ) : (
          <ErrorState error={tq.error} onRetry={() => tq.refetch()} />
        )}
      </Card>
    );
  if (!draft || !an) return <PageLoading />;

  const legacy = Boolean(tq.data?.template.legacyNeedsReview);
  const serverIssues = tq.data?.issues ?? [];
  const pinItem = pinFor ? draft.items.find((i) => i.key === pinFor.key) : undefined;
  const pinIndex = pinItem ? draft.items.indexOf(pinItem) + 1 : 0;
  const pinPrimary = pinItem ? primaryPin(pinItem.pins) : null;

  return (
    <div>
      {/* Tiêu đề */}
      <div className="mb-4">
        <button type="button" onClick={() => void guardedNavigate(listPath)} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> Mẫu phát
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-xl font-semibold tracking-tight">{isNew ? 'Tạo mẫu phát' : draft.name.trim() || tq.data?.template.name}</h2>
          {!isNew && tq.data && <span className="text-xs tabular text-subtle">#{tq.data.template.number}</span>}
          {legacy && (
            <Badge tone="violet" icon={<History className="size-3" />}>
              Nhập từ hệ thống cũ — cần gán lại sản phẩm ghim
            </Badge>
          )}
          {summary?.usedBySchedule && (
            <Badge tone="info" icon={<CalendarClock className="size-3" />}>
              Đang dùng trong lịch phát
            </Badge>
          )}
          {readOnly && <Badge tone="muted">Chỉ xem</Badge>}
        </div>
        {!isNew && tq.data && <p className="mt-0.5 text-xs text-muted">Cập nhật lần cuối {fmtDateTime(tq.data.template.updatedAt)}</p>}
      </div>

      {(readOnly || legacy || (summary?.usedBySchedule && !readOnly)) && (
        <div className="mb-4 space-y-3">
          {readOnly && <Callout tone="neutral">Bạn chỉ có quyền xem mẫu phát. Cần quyền “Quản lý mẫu phát” để chỉnh sửa.</Callout>}
          {legacy && (
            <Callout
              tone="info"
              icon={<History className="size-4" />}
              title="Mẫu nhập từ hệ thống cũ — cần gán lại sản phẩm ghim"
              action={
                !readOnly &&
                an.noPin > 0 && (
                  <Button size="sm" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={() => setQuickOpen(true)}>
                    Gán sản phẩm nhanh
                  </Button>
                )
              }
            >
              Hệ thống cũ chỉ chuyển sang danh sách video, chưa có sản phẩm ghim. Kiểm tra thứ tự video, gán sản phẩm cho từng video (dán danh sách mã theo thứ tự để gán một lần) rồi bấm <b>Lưu</b> để xác nhận.
            </Callout>
          )}
          {summary?.usedBySchedule && !readOnly && (
            <Callout tone="neutral" icon={<CalendarClock className="size-4" />}>
              Mẫu đang được lịch phát sử dụng. Thay đổi sau khi lưu áp dụng cho các lần phát tiếp theo.
            </Callout>
          )}
        </div>
      )}

      {/* Thông tin khi phát + thông tin mẫu */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className={cn(an.noCover && !readOnly && 'border-amber-200 dark:border-amber-900/60')}>
          <CardHeader
            icon={<Radio className="size-4" />}
            title="Thông tin khi phát"
            description="Phát ngay và lịch phát dùng tiêu đề, mô tả và ảnh bìa này khi không đặt riêng."
            actions={
              an.noCover ? (
                <Badge tone="warning" size="sm" icon={<ImageOff className="size-3" />}>
                  Thiếu ảnh bìa
                </Badge>
              ) : (
                <Badge tone="success" size="sm" icon={<CheckCircle2 className="size-3" />}>
                  Đủ thông tin
                </Badge>
              )
            }
          />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-3">
              <Field label="Tiêu đề live" hint={draft.liveTitle.trim() ? undefined : 'Để trống sẽ dùng tên mẫu làm tiêu đề.'} aside={<Counter n={draft.liveTitle.trim().length} max={LIVE_TITLE_MAX} />}>
                <Input value={draft.liveTitle} disabled={readOnly} onChange={(e) => update({ liveTitle: e.target.value })} placeholder={draft.name.trim() || 'Tiêu đề hiển thị trên Shopee Live'} />
              </Field>
              <Field label="Mô tả live" aside={<Counter n={draft.liveDescription.length} max={LIVE_DESC_MAX} />}>
                <Textarea rows={3} value={draft.liveDescription} disabled={readOnly} onChange={(e) => update({ liveDescription: e.target.value })} placeholder="Nội dung giới thiệu trong phòng live (không bắt buộc)" className="min-h-[72px]" />
              </Field>
            </div>
            <Field label="Ảnh bìa" required>
              {readOnly ? (
                draft.coverKey ? (
                  <img src={`/api/files/cover?key=${encodeURIComponent(draft.coverKey)}`} alt="Ảnh bìa" className="aspect-[3/4] w-28 rounded-lg object-cover ring-1 ring-line" />
                ) : (
                  <p className="text-xs text-muted">Chưa có ảnh bìa</p>
                )
              ) : (
                <CoverUpload value={draft.coverKey} onChange={(k) => update({ coverKey: k })} required />
              )}
            </Field>
          </div>
          {an.noCover && (
            <p className="flex items-start gap-1.5 border-t border-amber-200 bg-amber-50/70 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Mẫu chưa có ảnh bìa — cần khi Phát ngay hoặc khi lịch phát không có ảnh riêng.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Thông tin mẫu" />
          <div className="space-y-3 p-4">
            <Field label="Tên mẫu" required error={touchedName || draft.name.trim() ? nameErr : null} aside={<Counter n={draft.name.trim().length} max={NAME_MAX} />}>
              <Input
                value={draft.name}
                disabled={readOnly}
                invalid={Boolean(nameErr) && (touchedName || Boolean(draft.name.trim()))}
                placeholder="vd: Son môi buổi tối"
                onChange={(e) => update({ name: e.target.value })}
                onBlur={() => setTouchedName(true)}
                autoFocus={isNew}
              />
            </Field>
            <Field label="Ghi chú nội bộ" aside={<Counter n={draft.note.length} max={NOTE_MAX} />}>
              <Textarea rows={2} value={draft.note} disabled={readOnly} onChange={(e) => update({ note: e.target.value })} placeholder="Chỉ hiển thị trong hệ thống" className="min-h-[52px]" />
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Phát lặp danh sách</p>
                <p className="text-xs text-muted">{draft.loop ? 'Hết video cuối quay lại video đầu đến khi kết thúc phiên.' : 'Phát một lượt rồi dừng.'}</p>
              </div>
              <Switch size="sm" checked={draft.loop} disabled={readOnly} onChange={(v) => update({ loop: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Thời lượng dự kiến" hint={draft.expectedDurationMin && Number(draft.expectedDurationMin) > 0 ? `≈ ${fmtDuration(Number(draft.expectedDurationMin) * 60)}` : 'Phút, không bắt buộc'}>
                <Input type="number" min={1} max={1440} inputMode="numeric" value={draft.expectedDurationMin} disabled={readOnly} onChange={(e) => update({ expectedDurationMin: e.target.value })} placeholder="vd: 120" />
              </Field>
              <Field label="Trả lời bình luận" hint={draft.replyMode === 'inherit' ? `Shop đang ${shop.replyEnabled ? 'bật' : 'tắt'}` : undefined}>
                <Select value={draft.replyMode} disabled={readOnly} onChange={(e) => update({ replyMode: e.target.value as ReplyMode })}>
                  <option value="inherit">Theo cài đặt shop</option>
                  <option value="on">Luôn bật</option>
                  <option value="off">Tắt</option>
                </Select>
              </Field>
            </div>
          </div>
        </Card>
      </div>

      {/* Danh sách phát */}
      <Card className="mt-4">
        <CardHeader
          icon={<ListVideo className="size-4" />}
          title="Danh sách phát & sản phẩm ghim"
          description="Video phát lần lượt từ trên xuống, mỗi video ghim một sản phẩm chính."
          actions={
            !readOnly && (
              <>
                <Button size="sm" icon={<Wand2 className="size-3.5" />} disabled={!draft.items.length} onClick={() => setQuickOpen(true)}>
                  Gán sản phẩm nhanh
                </Button>
                <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setVideoDialog({ mode: 'add' })}>
                  Thêm video
                </Button>
              </>
            )
          }
        />
        <div className="grid grid-cols-2 border-b border-line md:grid-cols-4 md:divide-x md:divide-line">
          <SummaryCell icon={<ListVideo className="size-4" />} label="Video" value={draft.items.length} hint={draft.loop ? 'phát lặp' : 'một lượt'} />
          <SummaryCell icon={<Clock className="size-4" />} label="Tổng thời lượng" value={fmtClock(an.totalSec)} hint={an.unknownDuration ? `${an.unknownDuration} chưa rõ` : undefined} />
          <SummaryCell icon={<Package className="size-4" />} label="Sản phẩm" value={an.productCount} hint={an.noPin ? `${an.noPin} video chưa có` : undefined} tone={an.noPin ? 'warn' : undefined} />
          <SummaryCell
            icon={totalErrors ? <CircleAlert className="size-4" /> : warnings ? <AlertTriangle className="size-4" /> : <ShieldCheck className="size-4" />}
            label="Cảnh báo"
            value={warnings}
            tone={totalErrors ? 'error' : warnings ? 'warn' : 'ok'}
            hint={totalErrors ? `${totalErrors} lỗi` : warnings ? 'vẫn lưu được' : 'ổn'}
          />
        </div>

        {(an.noPin > 0 || an.notReady > 0 || an.global.length > 0) && draft.items.length > 0 && (
          <div className="space-y-1.5 border-b border-line bg-amber-50/50 px-4 py-2.5 dark:bg-amber-950/20">
            {an.noPin > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>
                    <b>{an.noPin}</b>/{draft.items.length} video chưa có sản phẩm ghim.
                  </span>
                </p>
                {!readOnly && (
                  <Button size="xs" variant="primary" icon={<Wand2 className="size-3.5" />} onClick={() => setQuickOpen(true)}>
                    Gán sản phẩm nhanh
                  </Button>
                )}
              </div>
            )}
            {an.notReady > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-3.5 shrink-0" />
                {an.notReady} video chưa sẵn sàng hoặc đã bị xóa — sẽ bị bỏ qua khi phát.
                <Link to={`/shops/${shop.id}/videos`} className="font-medium underline-offset-2 hover:underline">
                  Mở Thư viện video
                </Link>
              </p>
            )}
            {an.global.map((g, i) => (
              <p key={i} className={cn('flex items-start gap-1.5 text-xs', g.level === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-800 dark:text-amber-300')}>
                {g.level === 'error' ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                {g.text}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-2 p-3 sm:p-4">
          {draft.items.length === 0 ? (
            <EmptyState
              compact
              icon={ListVideo}
              title="Chưa có video trong mẫu"
              description="Chọn các video đã sẵn sàng trong thư viện, sau đó chọn sản phẩm ghim cho từng video."
              action={
                !readOnly && (
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setVideoDialog({ mode: 'add' })}>
                    Thêm video từ thư viện
                  </Button>
                )
              }
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
              accessibility={{
                announcements,
                screenReaderInstructions: { draggable: 'Nhấn phím cách hoặc Enter để nhấc video, dùng phím mũi tên lên/xuống để di chuyển, nhấn lại phím cách hoặc Enter để thả, Esc để hủy.' },
              }}
            >
              <SortableContext items={draft.items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
                {draft.items.map((it, idx) => (
                  <PlaylistItemRow
                    key={it.key}
                    shopId={shop.id}
                    item={it}
                    index={idx}
                    count={draft.items.length}
                    info={an.items.get(it.key)}
                    readOnly={readOnly}
                    onMove={(dir) => moveItem(it.key, dir)}
                    onRemove={() => void removeItem(it, idx)}
                    onReplace={() => setVideoDialog({ mode: 'replace', key: it.key })}
                    onDuplicate={() =>
                      setItems((items) => {
                        const i = items.findIndex((x) => x.key === it.key);
                        const copy: DraftItem = { ...it, key: newKey(), pins: it.pins.map((p) => ({ ...p, key: newKey() })) };
                        return [...items.slice(0, i + 1), copy, ...items.slice(i + 1)];
                      })
                    }
                    onPickPrimary={() => setPinFor({ key: it.key, mode: 'primary' })}
                    onAddTimedPin={() => setPinFor({ key: it.key, mode: 'timed' })}
                    onRemovePin={(pk) => updateItem(it.key, (x) => ({ ...x, pins: x.pins.filter((p) => p.key !== pk) }))}
                    onPinAt={(pk, text) => updateItem(it.key, (x) => ({ ...x, pins: x.pins.map((p) => (p.key === pk ? { ...p, at: text } : p)) }))}
                    onSortPins={() => updateItem(it.key, (x) => ({ ...x, pins: sortPins(x.pins) }))}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
          {draft.items.length > 0 && !readOnly && (
            <button
              type="button"
              onClick={() => setVideoDialog({ mode: 'add' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2 text-sm font-medium text-muted transition-colors hover:border-brand-400 hover:text-brand-600"
            >
              <Plus className="size-4" /> Thêm video
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2.5">
          <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>Khi phát tự động, hệ thống tự ghim sản phẩm khớp với video đang phát. Cần đổi sản phẩm giữa video? Bấm nút đồng hồ ở dòng video để thêm mốc “từ giây thứ…”.</span>
          </p>
          {!readOnly && <Checkbox checked={preferInStock} onChange={setPreferInStock} label={<span className="text-xs">Chỉ gợi ý sản phẩm còn hàng</span>} />}
        </div>
      </Card>

      {!isNew && (
        <Card className="mt-4">
          <CardHeader
            icon={serverIssues.length ? <AlertTriangle className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
            title={`Kiểm tra từ hệ thống${serverIssues.length ? ` (${serverIssues.length})` : ''}`}
            description={dirty ? 'Theo bản đã lưu — có thể khác bản đang sửa. Cảnh báo không chặn việc lưu.' : 'Theo bản đã lưu gần nhất. Cảnh báo không chặn việc lưu.'}
          />
          {serverIssues.length ? (
            <ul className="grid max-h-60 grid-cols-1 gap-x-6 overflow-y-auto px-4 py-2.5 md:grid-cols-2">
              {serverIssues.map((i, k) => (
                <li key={k} className="flex items-start gap-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-2.5 text-sm text-muted">Không có vấn đề. Mẫu sẵn sàng để phát.</p>
          )}
        </Card>
      )}

      {/* Thanh lưu */}
      {!readOnly && (
        <div className="sticky bottom-3 z-20 mt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface/95 px-4 py-2.5 shadow-pop backdrop-blur">
            <div className="min-w-0 flex-1 text-xs sm:text-sm">
              {totalErrors > 0 ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-400">
                  <CircleAlert className="size-4" /> Còn {totalErrors} lỗi cần sửa trước khi lưu
                </span>
              ) : dirty || isNew ? (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span className="size-2 rounded-full bg-amber-500" /> {isNew ? 'Mẫu mới chưa được lưu' : 'Có thay đổi chưa lưu'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <CheckCircle2 className="size-4 text-emerald-500" /> Đã lưu mọi thay đổi
                </span>
              )}
              {warnings > 0 && totalErrors === 0 && <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">· {warnings} cảnh báo (vẫn lưu được)</span>}
            </div>
            <span className="hidden items-center gap-1 text-2xs text-subtle md:inline-flex">
              <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd>
            </span>
            {!isNew && dirty && (
              <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => void revert()}>
                Hoàn tác
              </Button>
            )}
            <Button variant="ghost" className="hidden sm:inline-flex" onClick={() => void guardedNavigate(listPath)}>
              Đóng
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!canSave} onClick={doSave}>
              {isNew ? 'Tạo mẫu phát' : 'Lưu mẫu phát'}
            </Button>
          </div>
        </div>
      )}

      <AddVideosDialog
        shopId={shop.id}
        open={Boolean(videoDialog)}
        onClose={() => setVideoDialog(null)}
        videos={libItems ?? []}
        loading={lib.isLoading}
        usage={usage}
        multiple={videoDialog?.mode !== 'replace'}
        title={videoDialog?.mode === 'replace' ? 'Đổi video (giữ nguyên sản phẩm ghim)' : undefined}
        onPick={(vs) => {
          if (!videoDialog) return;
          if (videoDialog.mode === 'replace') {
            const v = vs[0];
            if (v) updateItem(videoDialog.key, (it) => ({ ...it, videoId: v.id, video: videoRefOf(v) }));
          } else setItems((items) => [...items, ...vs.map((v) => ({ key: newKey(), videoId: v.id, video: videoRefOf(v), pins: [] }))]);
        }}
      />
      <ProductPicker
        shopId={shop.id}
        open={Boolean(pinFor)}
        onClose={() => setPinFor(null)}
        title={
          pinFor?.mode === 'timed'
            ? `Đổi sang sản phẩm khác giữa video ${pinIndex}`
            : pinPrimary
              ? `Đổi sản phẩm cho video ${pinIndex}`
              : `Chọn sản phẩm cho video ${pinIndex}`
        }
        inStockOnly={preferInStock}
        excludeIds={pinFor?.mode === 'timed' ? (pinItem?.pins.map((p) => p.productId) ?? []) : pinPrimary ? [pinPrimary.productId] : []}
        onPick={(ps) => {
          const p = ps[0];
          const target = pinFor;
          if (!p || !target) return;
          if (target.mode === 'primary') updateItem(target.key, (it) => setPrimary(it, toPinProduct(p)));
          else
            updateItem(target.key, (it) => ({
              ...it,
              pins: sortPins([...it.pins, { key: newKey(), productId: p.id, at: fmtAt(suggestAt(it.pins, durationOf(it))), product: toPinProduct(p) }]),
            }));
        }}
      />
      <QuickAssignDialog
        shopId={shop.id}
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        targets={quickTargets}
        preferInStock={preferInStock}
        onApply={(list) => {
          const m = new Map(list.map((a) => [a.key, a.product]));
          setItems((items) => items.map((it) => (m.has(it.key) ? setPrimary(it, m.get(it.key)!) : it)));
          toast.success(`Đã gán sản phẩm cho ${list.length} video`, { description: 'Bấm “Lưu mẫu phát” để lưu thay đổi.' });
        }}
      />
    </div>
  );
}
