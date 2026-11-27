import { useState } from 'react';
import { Film, Package, Play, Repeat, SkipForward } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtClock, fmtDuration } from '@/lib/format';
import { useAction, useNow } from '@/lib/hooks';
import type { LiveSession } from '@/lib/types';
import { StreamStateBadge } from '@/components/domain/status';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, Progress } from '@/components/ui/misc';

/** Đang phát: danh sách video của mẫu, video hiện tại + tiến độ (nội suy giữa các lần làm mới) */
export function NowPlayingPanel({
  session,
  hasJob,
  canControl,
  dataUpdatedAt,
  onStart,
}: {
  session: LiveSession;
  hasJob: boolean;
  canControl: boolean;
  dataUpdatedAt: number;
  onStart?: () => void;
}) {
  const now = useNow(1000);
  const [pending, setPending] = useState<number | null>(null);
  const playlist = session.playlist ?? [];
  const idx = session.videoIndex;
  const cur = idx !== null && idx !== undefined ? playlist[idx] : null;
  const dur = cur?.durationSec ?? 0;
  const base = session.videoPositionSec ?? 0;
  const elapsed = session.streamState === 'pushing' && hasJob ? Math.max(0, (now - dataUpdatedAt) / 1000) : 0;
  const pos = dur ? Math.min(dur, base + elapsed) : base + elapsed;
  const totalSec = playlist.reduce((s, p) => s + (p.durationSec || 0), 0);
  const canSkip = hasJob && canControl && session.state !== 'ended';

  const skip = useAction((index: number) => api.post(`/api/sessions/${session.id}/stream/skip`, { index }), {
    success: 'Đã gửi lệnh chuyển video — máy chủ sẽ chuyển trong giây lát',
    invalidate: [['session', session.id]],
    onSuccess: () => setPending(null),
    onError: () => setPending(null),
  });

  return (
    <Card>
      <CardHeader
        title={hasJob ? 'Đang phát' : 'Danh sách phát'}
        icon={<Film className="size-4" />}
        description={playlist.length ? `${session.templateName ?? 'Mẫu phát'} · ${playlist.length} video · ${fmtDuration(totalSec)}` : undefined}
        actions={
          playlist.length > 0 && (
            <>
              <Badge tone="muted" size="sm" icon={<Repeat className="size-3" />}>
                {session.loop ? `Lặp vòng · đã lặp ${session.loops} lần` : 'Phát 1 lượt'}
              </Badge>
              <StreamStateBadge state={session.streamState} size="sm" />
            </>
          )
        }
      />
      {!playlist.length ? (
        <EmptyState
          compact
          icon={Play}
          title="Chưa phát tự động"
          description={session.state === 'ended' ? 'Phiên này không dùng phát tự động của MEXO.' : 'Chọn mẫu phát để máy chủ tự đẩy video, tự ghim sản phẩm theo từng video và trả lời bình luận.'}
          action={
            onStart && (
              <Button variant="primary" size="sm" icon={<Play className="size-4" />} onClick={onStart}>
                Bắt đầu phát tự động
              </Button>
            )
          }
        />
      ) : (
        <div>
          {cur && (
            <div className="border-b border-line px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted">
                    Video {(idx ?? 0) + 1}/{playlist.length}
                  </p>
                  <p className="truncate text-base font-semibold" title={cur.name}>
                    {cur.name}
                  </p>
                </div>
                <p className="shrink-0 pt-4 text-sm tabular text-muted">
                  <span className="font-medium text-fg">{fmtClock(pos)}</span> / {fmtClock(dur)}
                </p>
              </div>
              <Progress className="mt-2.5" value={pos} max={dur || 1} tone={session.streamState === 'pushing' ? 'brand' : session.streamState === 'error' || session.streamState === 'lost' ? 'danger' : 'muted'} />
              {cur.pins.length > 0 && (
                <p className="mt-2 flex items-center gap-1 text-xs text-muted">
                  <Package className="size-3.5" />
                  Video này ghim {cur.pins.length} sản phẩm theo mốc thời gian
                </p>
              )}
            </div>
          )}
          <ol className="max-h-80 divide-y divide-line overflow-y-auto">
            {playlist.map((v, i) => {
              const active = i === idx;
              return (
                <li key={`${v.videoId}-${i}`} className={cn('group flex items-center gap-3 px-4 py-1.5', active ? 'bg-brand-50/70 dark:bg-brand-950/25' : 'hover:bg-surface-2/60')}>
                  <span className={cn('w-6 shrink-0 text-right text-xs tabular', active ? 'font-semibold text-brand-600 dark:text-brand-400' : 'text-subtle')}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm', active && 'font-semibold')} title={v.name}>
                      {v.name}
                    </p>
                    <p className="text-2xs text-muted">
                      {fmtClock(v.durationSec)} · {v.pins.length ? `${v.pins.length} sản phẩm ghim` : 'Không ghim'}
                    </p>
                  </div>
                  {active ? (
                    hasJob ? (
                      <Badge tone="brand" size="sm" dot pulse={session.streamState === 'pushing'}>
                        Đang phát
                      </Badge>
                    ) : (
                      <Badge tone="muted" size="sm">
                        Dừng tại đây
                      </Badge>
                    )
                  ) : (
                    canSkip && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                        icon={<SkipForward className="size-3.5" />}
                        loading={pending === i && skip.isPending}
                        disabled={skip.isPending}
                        onClick={() => {
                          setPending(i);
                          skip.mutate(i);
                        }}
                      >
                        Chuyển tới
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}
