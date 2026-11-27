import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtDate, fmtTime } from '@/lib/format';
import { Segmented } from '@/components/ui/form';
import { Card, CardHeader, EmptyState } from '@/components/ui/misc';
import { eventTone } from './helpers';
import type { SessionEventRow } from './types';

/** Nhật ký sự kiện của phiên (mới nhất trước) */
export function EventTimeline({ events }: { events: SessionEventRow[] }) {
  const [filter, setFilter] = useState<'all' | 'issues'>('all');
  const issues = useMemo(() => events.filter((e) => e.level === 'warn' || e.level === 'error'), [events]);
  const list = filter === 'all' ? events : issues;
  const today = fmtDate(new Date());
  return (
    <Card>
      <CardHeader
        title="Nhật ký phiên"
        icon={<ScrollText className="size-4" />}
        actions={
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Tất cả' },
              { value: 'issues', label: 'Cảnh báo & lỗi', count: issues.length },
            ]}
          />
        }
      />
      {!list.length ? (
        <EmptyState compact icon={ScrollText} title={filter === 'issues' ? 'Không có cảnh báo hoặc lỗi' : 'Chưa có sự kiện'} />
      ) : (
        <ol className="max-h-[420px] overflow-y-auto px-4 py-2.5">
          {list.map((e, i) => {
            const t = eventTone(e.level);
            const day = fmtDate(e.at);
            return (
              <li key={e.id} className="relative flex gap-3 pb-3 last:pb-0">
                {i < list.length - 1 && <span className="absolute bottom-0 left-[3.5px] top-3.5 w-px bg-line" />}
                <span className={cn('relative mt-1.5 size-2 shrink-0 rounded-full ring-2 ring-surface', t.dot)} />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm leading-snug', t.text)}>{e.message}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-2xs text-subtle">
                    <span className="tabular">
                      {fmtTime(e.at, true)}
                      {day !== today ? ` · ${day}` : ''}
                    </span>
                    <span className="font-mono">{e.code}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
