import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, CircleAlert, CopyPlus, GripVertical, Info, MoreHorizontal, Plus, Replace, Timer, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtClock } from '@/lib/format';
import { ProductThumb, StockBadge } from '@/components/domain/ProductPicker';
import { VideoStatusBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, Menu } from '@/components/ui/misc';
import { parseAt, sortPins, type DraftItem, type DraftPin, type Issue, type ItemAnalysis } from './templateDraft';
import { VideoThumb } from './VideoThumb';

const PIN_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-400', 'bg-teal-500', 'bg-indigo-500'];

function IssueLine({ i }: { i: Issue }) {
  const Icon = i.level === 'error' ? CircleAlert : i.level === 'warn' ? AlertTriangle : Info;
  return (
    <p className={cn('flex items-start gap-1.5 text-xs', i.level === 'error' ? 'text-rose-600 dark:text-rose-400' : i.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}>
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span>{i.text}</span>
    </p>
  );
}

function ProductCell({ pin, compact }: { pin: DraftPin; compact?: boolean }) {
  const p = pin.product;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ProductThumb url={p?.imageUrl} className={compact ? 'size-7' : 'size-8'} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm', !p && 'text-rose-600 dark:text-rose-400')} title={p?.name}>
          {p?.name ?? `Sản phẩm #${pin.productId} không còn trong danh mục`}
        </p>
        {p && (
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <span className="truncate font-mono">{p.sku || p.itemId}</span>
            {p.removed ? (
              <Badge tone="danger" size="sm">
                Đã gỡ khỏi Shopee
              </Badge>
            ) : (
              <StockBadge stock={p.stock} />
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Một dòng video trong danh sách phát.
 * Mặc định gọn 1 dòng: video ↔ sản phẩm chính (ghim suốt video).
 * "Chuyển ghim theo thời gian" (thêm sản phẩm tại giây thứ X) là tùy chọn nâng cao, thu gọn sẵn.
 */
export function PlaylistItemRow({
  shopId,
  item,
  index,
  count,
  info,
  readOnly,
  onMove,
  onRemove,
  onReplace,
  onDuplicate,
  onPickPrimary,
  onAddTimedPin,
  onRemovePin,
  onPinAt,
  onSortPins,
}: {
  shopId: number;
  item: DraftItem;
  index: number;
  count: number;
  info: ItemAnalysis | undefined;
  readOnly: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReplace: () => void;
  onDuplicate: () => void;
  onPickPrimary: () => void;
  onAddTimedPin: () => void;
  onRemovePin: (key: string) => void;
  onPinAt: (key: string, text: string) => void;
  onSortPins: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, disabled: readOnly });
  const [open, setOpen] = useState(false);
  const video = info?.video ?? null;
  const dur = video?.durationSec ?? null;
  const sorted = sortPins(item.pins);
  const primary = sorted[0] ?? null;
  const extras = sorted.slice(1);
  const pinErrors = [...(info?.pins.values() ?? [])].some((a) => a.some((i) => i.level === 'error'));
  const expanded = open || pinErrors;
  const rowIssues = (info?.issues ?? []).filter((i) => i.level !== 'info');
  const videoTitle = rowIssues.map((i) => i.text).join('\n') || undefined;

  // Dải thời gian: mỗi đoạn = sản phẩm được ghim trong khoảng đó
  const valid = sorted.map((p) => ({ p, at: parseAt(p.at) })).filter((x) => Number.isFinite(x.at) && x.at >= 0);
  const colorOf = new Map(valid.map((x, i) => [x.p.key, PIN_COLORS[i % PIN_COLORS.length]!]));
  const segments =
    dur && valid.length > 1
      ? valid.map((x, i) => {
          const start = i === 0 ? 0 : Math.min(x.at, dur);
          const end = Math.min(valid[i + 1]?.at ?? dur, dur);
          return { key: x.p.key, start, end, name: x.p.product?.name ?? `Sản phẩm #${x.p.productId}`, color: colorOf.get(x.p.key)! };
        })
      : [];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative rounded-lg border bg-surface', isDragging ? 'z-20 shadow-pop ring-2 ring-brand-400' : '', pinErrors ? 'border-rose-300 dark:border-rose-900/70' : 'border-line')}
    >
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2 md:grid md:px-3', readOnly ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem]' : 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]')}>
        {/* Video */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              className="-ml-0.5 cursor-grab touch-none rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
              aria-label={`Kéo để đổi vị trí video ${index + 1}`}
            >
              <GripVertical className="size-4" />
            </button>
          )}
          <span className="w-6 shrink-0 text-center text-xs font-semibold tabular text-muted">{index + 1}</span>
          <VideoThumb shopId={shopId} videoId={video?.id} ready={video?.status === 'ready'} className="hidden h-9 w-16 shrink-0 rounded sm:block" iconClassName="size-4" />
          <div className="min-w-0 flex-1" title={videoTitle}>
            <p className={cn('truncate text-sm font-medium', !video && 'text-rose-600 dark:text-rose-400')}>{video?.name ?? `Video #${item.videoId} đã bị xóa`}</p>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="tabular">{fmtClock(dur)}</span>
              {video && video.status !== 'ready' && <VideoStatusBadge status={video.status} size="sm" />}
              {!video && <span className="text-rose-600 dark:text-rose-400">Đổi video khác hoặc xóa dòng</span>}
            </p>
          </div>
        </div>

        {/* Sản phẩm chính (màn nhỏ: xuống dòng dưới video) */}
        <div className="order-last flex min-w-0 basis-full items-center gap-2 pl-7 md:order-none md:basis-auto md:pl-0">
          {primary ? (
            <>
              <ProductCell pin={primary} />
              {!readOnly && (
                <Button size="xs" variant="ghost" onClick={onPickPrimary}>
                  Đổi
                </Button>
              )}
            </>
          ) : (
            <>
              <span className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-dashed border-amber-300 px-2 text-xs text-amber-700 dark:border-amber-800 dark:text-amber-400">Chưa chọn sản phẩm ghim</span>
              {!readOnly && (
                <Button size="xs" variant="outline" onClick={onPickPrimary}>
                  Chọn sản phẩm
                </Button>
              )}
            </>
          )}
        </div>

        {/* Thao tác */}
        <div className="ml-auto flex shrink-0 items-center justify-end md:ml-0 md:w-full">
          {(primary || extras.length > 0) && (
            <Button
              size="xs"
              variant="ghost"
              className={cn('mr-auto', extras.length > 0 && 'text-sky-700 dark:text-sky-300')}
              icon={<Timer className="size-3.5" />}
              iconRight={<ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />}
              onClick={() => setOpen((o) => !o)}
              title="Đổi sang sản phẩm khác tại giây thứ…"
              aria-expanded={expanded}
            >
              {extras.length ? (
                <span>
                  {extras.length}
                  <span className="hidden sm:inline"> mốc</span>
                </span>
              ) : (
                <span className="sr-only">Chuyển ghim theo thời gian</span>
              )}
            </Button>
          )}
          {!readOnly && (
            <>
              <Button size="xs" variant="ghost" iconOnly icon={<ArrowUp className="size-3.5" />} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Chuyển lên" title="Chuyển lên" />
              <Button size="xs" variant="ghost" iconOnly icon={<ArrowDown className="size-3.5" />} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Chuyển xuống" title="Chuyển xuống" />
              <Menu
                width="w-52"
                trigger={({ toggle }) => <Button size="xs" variant="ghost" iconOnly icon={<MoreHorizontal className="size-3.5" />} onClick={toggle} aria-label="Thao tác khác" />}
                items={[
                  { label: 'Chuyển ghim theo thời gian', icon: <Timer />, onClick: () => setOpen(true), hidden: !primary },
                  { label: 'Đổi video khác', icon: <Replace />, onClick: onReplace },
                  { label: 'Nhân đôi dòng này', icon: <CopyPlus />, onClick: onDuplicate },
                  { divider: true, label: '' },
                  { label: 'Xóa khỏi mẫu', icon: <Trash2 />, danger: true, onClick: onRemove },
                ]}
              />
            </>
          )}
        </div>
      </div>

      {/* Nâng cao: chuyển ghim theo thời gian */}
      {expanded && primary && (
        <div className="space-y-2 rounded-b-lg border-t border-line bg-surface-2/50 px-3 py-2.5 sm:pl-[68px]">
          <p className="text-xs text-muted">
            Đổi sang sản phẩm khác tại giây thứ X của video. Sản phẩm chính được ghim từ đầu video đến mốc đầu tiên.
          </p>
          {segments.length > 0 && dur && (
            <div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                {segments.map((s) => (
                  <span key={s.key} title={`${fmtClock(s.start)}–${fmtClock(s.end)}: ${s.name}`} className={cn('block h-1.5 border-r border-surface last:border-0', s.color)} style={{ width: `${Math.max(0, ((s.end - s.start) / dur) * 100)}%` }} />
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-2xs tabular text-subtle">
                <span>0:00</span>
                <span>{fmtClock(dur)}</span>
              </div>
            </div>
          )}
          {sorted.map((p, i) => {
            const isPrimary = i === 0;
            const at = parseAt(p.at);
            const pi = (info?.pins.get(p.key) ?? []).filter((x) => x.level === 'error');
            return (
              <div key={p.key}>
                <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-surface px-2 py-1.5 ring-1', pi.length ? 'ring-rose-300 dark:ring-rose-900/70' : 'ring-line')}>
                  <span className={cn('size-2 shrink-0 rounded-full', colorOf.get(p.key) ?? 'bg-slate-300 dark:bg-slate-600')} />
                  <div className="flex min-w-0 flex-[1_1_200px]">
                    <ProductCell pin={p} compact />
                  </div>
                  {isPrimary ? (
                    <span className="text-xs text-muted">Từ đầu video (sản phẩm chính)</span>
                  ) : (
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="whitespace-nowrap">Từ giây thứ</span>
                      <Input inputSize="sm" inputMode="decimal" className={cn('w-16 text-right tabular', pi.length && 'border-rose-400')} value={p.at} disabled={readOnly} placeholder="30" onChange={(e) => onPinAt(p.key, e.target.value)} onBlur={onSortPins} aria-label="Đổi sản phẩm từ giây thứ" />
                      <span className="w-11 tabular text-subtle">{Number.isFinite(at) ? fmtClock(at) : ''}</span>
                    </label>
                  )}
                  {!readOnly && !isPrimary && (
                    <button type="button" onClick={() => onRemovePin(p.key)} className="rounded p-1 text-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" aria-label="Bỏ mốc chuyển ghim">
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                {pi.length > 0 && (
                  <div className="mt-1 space-y-0.5 pl-4">
                    {pi.map((x, k) => (
                      <IssueLine key={k} i={x} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onAddTimedPin} disabled={item.pins.length >= 50} className="text-brand-600 dark:text-brand-400">
              Thêm mốc đổi sản phẩm
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
