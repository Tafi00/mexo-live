import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bell, BellRing, Check, CheckCheck, CheckCircle2, Clock, Radio, Server, Store } from 'lucide-react';
import { ALERT_TYPE_LABELS, foldVi } from '@mexo/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { AlertRow } from '@/lib/types';
import { SeverityBadge } from '@/components/admin/common';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialog';
import { SearchInput, Select } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, Tabs, Tooltip } from '@/components/ui/misc';

type Status = 'open' | 'acknowledged' | 'resolved' | 'all';
interface AlertsResponse {
  items: AlertRow[];
  counts: Record<Status, number>;
}

const SEVERITY_BAR: Record<string, string> = { critical: 'bg-rose-500', warning: 'bg-amber-500', info: 'bg-sky-500' };

function AlertItem({ a, isStaff, onAck, acking }: { a: AlertRow; isStaff: boolean; onAck: () => void; acking: boolean }) {
  const resolved = Boolean(a.resolvedAt);
  const acked = Boolean(a.acknowledgedAt);
  return (
    <li className={cn('relative flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4', resolved && 'opacity-75')}>
      <span className={cn('absolute inset-y-3 left-0 w-1 rounded-r-full', SEVERITY_BAR[a.severity] ?? 'bg-slate-400', resolved && 'opacity-40')} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={a.severity} size="sm" />
          <span className="text-2xs font-medium uppercase tracking-wide text-subtle">{ALERT_TYPE_LABELS[a.type] ?? a.type}</span>
          {resolved ? (
            <Badge tone="success" size="sm" icon={<CheckCircle2 className="size-3" />}>
              Đã xử lý
            </Badge>
          ) : acked ? (
            <Badge tone="muted" size="sm" icon={<Check className="size-3" />}>
              Đã nhận
            </Badge>
          ) : null}
        </div>
        <p className="text-sm font-semibold">
          {a.title}
          {a.count > 1 && (
            <Tooltip content={`Sự cố lặp lại ${a.count} lần, đã được gộp thành một cảnh báo`}>
              <span className="ml-1.5 rounded-md bg-surface-2 px-1.5 py-px text-2xs font-medium text-muted ring-1 ring-inset ring-line tabular">×{a.count.toLocaleString('vi-VN')}</span>
            </Tooltip>
          )}
        </p>
        {a.message && <p className="text-sm text-muted">{a.message}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {a.shopId && (
            <Link to={`/shops/${a.shopId}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
              <Store className="size-3.5" />
              {a.shopName ?? `Shop #${a.shopId}`}
            </Link>
          )}
          {a.serverId &&
            (isStaff ? (
              <Link to="/servers" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
                <Server className="size-3.5" />
                {a.serverName ?? `Máy chủ #${a.serverId}`}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted">
                <Server className="size-3.5" />
                {a.serverName ?? `Máy chủ #${a.serverId}`}
              </span>
            ))}
          {a.sessionId && (
            <Link to={`/sessions/${a.sessionId}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
              <Radio className="size-3.5" />
              Phiên #{a.sessionId}
            </Link>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:w-52 sm:flex-col sm:items-end sm:justify-start sm:gap-2">
        <div className="space-y-0.5 text-xs text-muted sm:text-right">
          <p className="inline-flex items-center gap-1" title={fmtDateTime(a.lastAt, { seconds: true })}>
            <Clock className="size-3" />
            Gần nhất {fmtRelative(a.lastAt)}
          </p>
          {a.count > 1 && <p title={fmtDateTime(a.firstAt, { seconds: true })}>Lần đầu {fmtDateTime(a.firstAt)}</p>}
          {acked && (
            <p title={fmtDateTime(a.acknowledgedAt)}>
              Nhận bởi <b className="font-medium text-fg">{a.acknowledgedBy ?? '—'}</b> · {fmtRelative(a.acknowledgedAt)}
            </p>
          )}
          {resolved && <p>Hết sự cố {fmtRelative(a.resolvedAt)}</p>}
        </div>
        {!resolved && !acked && (
          <Button size="sm" icon={<Check className="size-3.5" />} loading={acking} onClick={onAck}>
            Đã nhận
          </Button>
        )}
      </div>
    </li>
  );
}

export default function Alerts() {
  const { isStaff } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as Status) || 'open';
  const severity = params.get('severity') ?? '';
  const type = params.get('type') ?? '';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  useEffect(() => setPage(1), [status, severity, type, q]);

  const setParam = (k: string, v: string, def = '') => {
    const p = new URLSearchParams(params);
    if (!v || v === def) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };

  const list = useQuery({
    queryKey: ['alerts', { status, severity, type }],
    queryFn: () => api.get<AlertsResponse>('/api/alerts', { status, severity, type }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const counts = list.data?.counts;
  const items = useMemo(() => {
    const all = list.data?.items ?? [];
    const f = foldVi(q);
    if (!f) return all;
    return all.filter((a) => foldVi(`${a.title} ${a.message} ${a.shopName ?? ''} ${a.serverName ?? ''}`).includes(f));
  }, [list.data, q]);

  const invalidate = [['alerts'], ['shell'], ['dashboard']];
  const ack = useAction((id: number) => api.post(`/api/alerts/${id}/acknowledge`), { success: 'Đã nhận cảnh báo', invalidate });
  const ackAll = useAction(() => api.post<{ count: number }>('/api/alerts/acknowledge-all'), { success: (r) => `Đã nhận ${r.count} cảnh báo`, invalidate });

  async function onAckAll() {
    const r = await confirm({
      title: 'Đánh dấu đã nhận tất cả cảnh báo?',
      description: `${counts?.open ?? 0} cảnh báo đang mở sẽ chuyển sang "Đã nhận". Cảnh báo chỉ đóng hẳn khi sự cố được khắc phục; nếu sự cố lặp lại trong lúc đó, hệ thống chỉ cộng dồn số lần, không nhắc lại.`,
      confirmText: 'Đã nhận tất cả',
    });
    if (r.ok) ackAll.mutate();
  }

  const typeOptions = useMemo(() => Object.entries(ALERT_TYPE_LABELS).sort((a, b) => a[1].localeCompare(b[1], 'vi')), []);

  return (
    <div>
      <PageHeader
        title="Cảnh báo"
        description={isStaff ? 'Sự cố cần chú ý trên toàn hệ thống: shop, phiên live, máy chủ phát, API Shopee' : 'Sự cố cần chú ý trên các shop của bạn'}
        actions={
          (counts?.open ?? 0) > 0 && (
            <Button variant="primary" icon={<CheckCheck className="size-4" />} loading={ackAll.isPending} onClick={() => void onAckAll()}>
              Đã nhận tất cả ({counts?.open})
            </Button>
          )
        }
      />

      <Card>
        <div className="px-2 pt-0.5">
          <Tabs<Status>
            value={status}
            onChange={(v) => setParam('status', v, 'open')}
            items={[
              { value: 'open', label: 'Đang mở', count: counts?.open ?? null, tone: 'danger', icon: <BellRing className="size-3.5" /> },
              { value: 'acknowledged', label: 'Đã nhận', count: counts?.acknowledged ?? null },
              { value: 'resolved', label: 'Đã xử lý', count: counts?.resolved ?? null },
              { value: 'all', label: 'Tất cả', count: counts?.all ?? null },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm nội dung, shop, máy chủ…" className="w-full sm:w-64" />
          <Select className="w-full sm:w-40" value={severity} onChange={(e) => setParam('severity', e.target.value)} aria-label="Mức độ">
            <option value="">Mọi mức độ</option>
            <option value="critical">Nghiêm trọng</option>
            <option value="warning">Cần xử lý</option>
            <option value="info">Thông tin</option>
          </Select>
          <Select className="w-full sm:w-64" value={type} onChange={(e) => setParam('type', e.target.value)} aria-label="Loại cảnh báo">
            <option value="">Mọi loại cảnh báo</option>
            {typeOptions.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
          {(severity || type || q) && (
            <Button
              variant="ghost"
              onClick={() => {
                setQ('');
                const p = new URLSearchParams(params);
                p.delete('severity');
                p.delete('type');
                setParams(p, { replace: true });
              }}
            >
              Xóa bộ lọc
            </Button>
          )}
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : items.length ? (
          <ul className={cn('divide-y divide-line', list.isFetching && list.isPlaceholderData && 'opacity-60')}>
            {items.slice((page - 1) * pageSize, page * pageSize).map((a) => (
              <AlertItem key={a.id} a={a} isStaff={isStaff} acking={ack.isPending && ack.variables === a.id} onAck={() => ack.mutate(a.id)} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={status === 'open' ? CheckCircle2 : Bell}
            title={status === 'open' && !severity && !type && !q ? 'Không có cảnh báo đang mở' : 'Không có cảnh báo phù hợp'}
            description={status === 'open' ? 'Mọi thứ đang hoạt động bình thường.' : 'Thử đổi bộ lọc hoặc chọn thẻ khác.'}
          />
        )}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <Pagination className="flex-1" page={page} pageSize={pageSize} total={items.length} onChange={setPage} />
            {(list.data?.items.length ?? 0) >= 500 && <span className="text-xs text-muted">Hiển thị 500 cảnh báo gần nhất</span>}
          </div>
        )}
      </Card>

      <Callout tone="neutral" className="mt-4">
        <b>Đã nhận</b> nghĩa là đã có người biết và đang xử lý — cảnh báo vẫn được theo dõi cho đến khi hệ thống xác nhận sự cố hết thì tự chuyển sang <b>Đã xử lý</b>. Sự cố lặp lại được gộp vào một cảnh báo (×số lần); cảnh báo đã nhận không nhắc lại khi lặp.
      </Callout>
    </div>
  );
}
