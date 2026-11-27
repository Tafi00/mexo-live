import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowDown, ArrowUp, CircleAlert, CopyPlus, GripVertical, Info, MoreHorizontal, Pin, Replace, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtClock } from '@/lib/format';
import { ProductThumb, StockBadge } from '@/components/domain/ProductPicker';
import { VideoStatusBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, Menu } from '@/components/ui/misc';
import { parseAt, type DraftItem, type Issue, type ItemAnalysis } from './templateDraft';
import { VideoThumb } from './VideoThumb';

const PIN_COLORS = ['bg-brand-500', 'bg-sky-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-400', 'bg-teal-500', 'bg-indigo-500'];

function IssueLine({ i }: { i: Issue }) {
  const Icon = i.level === 'error' ? CircleAlert : i.level === 'warn' ? AlertTriangle : Info;
  return (
    <p className={cn('flex items-start gap-1.5 text-xs leading-snug', i.level === 'error' ? 'text-rose-600 dark:text-rose-400' : i.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>{i.text}</span>
    </p>
  );
}

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
  onAddPin,
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
  onAddPin: () => void;
  onRemovePin: (key: string) => void;
  onPinAt: (key: string, text: string) => void;
  onSortPins: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, disabled: readOnly });
  const video = info?.video ?? null;
  const dur = video?.durationSec ?? null;
  const hasWarn = Boolean(info?.issues.some((i) => i.level !== 'info') || [...(info?.pins.values() ?? [])].some((a) => a.some((i) => i.level !== 'info')));
  const hasError = Boolean(info?.issues.some((i) => i.level === 'error') || [...(info?.pins.values() ?? [])].some((a) => a.some((i) => i.level === 'error')));

  // Thứ tự theo mốc thời gian → màu & dải thời gian
  const valid = item.pins
    .map((p) => ({ p, at: parseAt(p.at) }))
    .filter((x) => Number.isFinite(x.at) && x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const colorOf = new Map(valid.map((x, i) => [x.p.key, PIN_COLORS[i % PIN_COLORS.length]!]));
  const segments =
    dur && valid.length
      ? valid.map((x, i) => {
          const start = i === 0 ? 0 : Math.min(x.at, dur);
          const end = Math.min(valid[i + 1]?.at ?? dur, dur);
          return { key: x.p.key, start, end, name: x.p.product?.name ?? `Sản phẩm #${x.p.productId}`, color: colorOf.get(x.p.key)! };
        })
      : [];
  const firstAt = valid[0]?.at ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative rounded-xl border bg-surface shadow-card',
        isDragging ? 'z-20 opacity-95 shadow-pop ring-2 ring-brand-400' : '',
        hasError ? 'border-rose-300 dark:border-rose-900/70' : hasWarn ? 'border-amber-200 dark:border-amber-900/60' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2.5 sm:px-3">
        {!readOnly && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
            aria-label={`Kéo để đổi vị trí video ${index + 1}`}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-xs font-semibold tabular text-muted ring-1 ring-line">{index + 1}</span>
        <VideoThumb shopId={shopId} videoId={video?.id} ready={video?.status === 'ready'} className="hidden h-10 w-[72px] shrink-0 rounded-md sm:block" iconClassName="size-4" />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[13px] font-medium', !video && 'text-rose-600 dark:text-rose-400')} title={video?.name}>
            {video?.name ?? `Video #${item.videoId} đã bị xóa`}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="tabular">{fmtClock(dur)}</span>
            {video && video.status !== 'ready' && <VideoStatusBadge status={video.status} size="sm" />}
            <span className="inline-flex items-center gap-1">
              <Pin className="size-3" />
              {item.pins.length ? `${item.pins.length} sản phẩm ghim` : 'Chưa ghim sản phẩm'}
            </span>
          </div>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 items-center">
            <Button size="xs" variant="ghost" iconOnly icon={<ArrowUp className="size-3.5" />} disabled={index === 0} onClick={() => onMove(-1)} aria-label="Chuyển lên" title="Chuyển lên" />
            <Button size="xs" variant="ghost" iconOnly icon={<ArrowDown className="size-3.5" />} disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Chuyển xuống" title="Chuyển xuống" />
            <Menu
              width="w-48"
              trigger={({ toggle }) => <Button size="xs" variant="ghost" iconOnly icon={<MoreHorizontal className="size-3.5" />} onClick={toggle} aria-label="Thao tác khác" />}
              items={[
                { label: 'Đổi video khác', icon: <Replace />, onClick: onReplace },
                { label: 'Nhân đôi dòng này', icon: <CopyPlus />, onClick: onDuplicate },
                { divider: true, label: '' },
                { label: 'Xóa khỏi mẫu', icon: <Trash2 />, danger: true, onClick: onRemove },
              ]}
            />
          </div>
        )}
      </div>

      {info && info.issues.length > 0 && (
        <div className="space-y-1 px-3 pb-2.5 sm:pl-[52px]">
          {info.issues.map((i, k) => (
            <IssueLine key={k} i={i} />
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-b-xl border-t border-line bg-surface-2/40 px-2.5 py-2.5 sm:px-3 sm:pl-[52px]">
        {segments.length > 0 && dur && (
          <div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              {segments.map((s) => (
                <span
                  key={s.key}
                  title={`${fmtClock(s.start)}–${fmtClock(s.end)}: ${s.name}`}
                  className={cn('block h-1.5 border-r border-surface last:border-0', s.color)}
                  style={{ width: `${Math.max(0, ((s.end - s.start) / dur) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] tabular text-subtle">
              <span>0:00</span>
              <span>{fmtClock(dur)}</span>
            </div>
          </div>
        )}

        {item.pins.map((p) => {
          const at = parseAt(p.at);
          const pi = info?.pins.get(p.key) ?? [];
          const bad = pi.some((i) => i.level === 'error');
          return (
            <div key={p.key} className={cn('rounded-lg bg-surface px-2 py-1.5 ring-1', bad ? 'ring-rose-300 dark:ring-rose-900/70' : 'ring-line')}>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className={cn('size-2 shrink-0 rounded-full', colorOf.get(p.key) ?? 'bg-slate-300 dark:bg-slate-600')} />
                <ProductThumb url={p.product?.imageUrl} className="size-8" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-[13px] font-medium" title={p.product?.name}>
                    {p.product?.name ?? `Sản phẩm #${p.productId}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    {p.product && <span className="font-mono">{p.product.sku || p.product.itemId}</span>}
                    {p.product?.removed ? (
                      <Badge tone="muted" size="sm">
                        Đã gỡ
                      </Badge>
                    ) : (
                      p.product && <StockBadge stock={p.product.stock} />
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="whitespace-nowrap">Ghim từ giây thứ</span>
                  <Input
                    inputSize="sm"
                    inputMode="decimal"
                    className={cn('w-[72px] text-right tabular', bad && 'border-rose-400')}
                    value={p.at}
                    disabled={readOnly}
                    placeholder="0"
                    onChange={(e) => onPinAt(p.key, e.target.value)}
                    onBlur={onSortPins}
                    aria-label="Ghim từ giây thứ"
                  />
                  <span className="w-12 tabular text-subtle">{Number.isFinite(at) ? `= ${fmtClock(at)}` : ''}</span>
                </label>
                {!readOnly && (
                  <button type="button" onClick={() => onRemovePin(p.key)} className="rounded p-1 text-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40" aria-label="Bỏ ghim sản phẩm">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {pi.length > 0 && (
                <div className="mt-1 space-y-0.5 pl-[18px]">
                  {pi.map((i, k) => (
                    <IssueLine key={k} i={i} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {valid.length > 1 && firstAt > 0 && <p className="text-[11px] text-muted">Từ 0:00 đến {fmtClock(firstAt)}, hệ thống ghim sản phẩm có mốc sớm nhất.</p>}

        {!readOnly && (
          <Button size="xs" variant="ghost" icon={<Pin className="size-3.5" />} onClick={onAddPin} disabled={item.pins.length >= 50} className="text-brand-600 hover:text-brand-700 dark:text-brand-400">
            {item.pins.length ? 'Ghim thêm sản phẩm (chuyển ghim theo thời gian)' : 'Ghim sản phẩm cho video này'}
          </Button>
        )}
      </div>
    </div>
  );
}
