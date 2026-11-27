import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/lib/hooks';
import type { ActivityRow } from '@/lib/types';
import { DateRangeBar } from '@/components/admin/common';
import { ActivityList } from '@/components/domain/ActivityList';
import { Button } from '@/components/ui/button';
import { SearchInput, Select } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '@/components/ui/misc';

interface AuditResponse {
  items: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  codes: Record<string, string>;
}

/** Nhóm mã hành động để chọn dễ hơn */
function groupOf(code: string): string {
  if (/^(login|logout|password|account_|role_|shops_assigned|shop_limit|account_expiry)/.test(code)) return 'Tài khoản & đăng nhập';
  if (/^server_/.test(code)) return 'Máy chủ phát';
  if (/^(system_|settings_|legacy_)/.test(code)) return 'Hệ thống';
  if (/^(session_|stream_|pin_|cart_)/.test(code)) return 'Phiên live';
  if (/^schedule_/.test(code)) return 'Lịch phát';
  if (/^(video_|template_|products_)/.test(code)) return 'Nội dung';
  if (/^(reply_|comment_)/.test(code)) return 'Bình luận';
  return 'Gian hàng';
}
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button onClick={onClear} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-50 px-2.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900" title="Bỏ lọc">
      {label}
      <X className="size-3" />
    </button>
  );
}

const GROUP_ORDER = ['Gian hàng', 'Phiên live', 'Lịch phát', 'Nội dung', 'Bình luận', 'Tài khoản & đăng nhập', 'Máy chủ phát', 'Hệ thống'];

export default function Audit() {
  const { role, isStaff } = useAuth();
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q.trim(), 300);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const shopId = params.get('shopId') ? Number(params.get('shopId')) : undefined;
  const actorId = params.get('actorId') ? Number(params.get('actorId')) : undefined;
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => setPage(1), [code, dq, from, to, shopId, actorId]);

  const list = useQuery({
    queryKey: ['audit', { code, dq, from, to, shopId, actorId, page }],
    queryFn: () => api.get<AuditResponse>('/api/audit', { code, q: dq, from, to, shopId, actorId, page, pageSize }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const groups = useMemo(() => {
    const codes = list.data?.codes ?? {};
    const m = new Map<string, [string, string][]>();
    for (const [k, label] of Object.entries(codes)) {
      const g = groupOf(k);
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push([k, label]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a[1].localeCompare(b[1], 'vi'));
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => [g, m.get(g)!] as const);
  }, [list.data?.codes]);

  const hasFilter = Boolean(code || q || from || to || shopId || actorId);
  const clearAll = () => {
    setCode('');
    setQ('');
    setFrom('');
    setTo('');
    setParams(new URLSearchParams(), { replace: true });
  };
  const clearParam = (k: string) => {
    const p = new URLSearchParams(params);
    p.delete(k);
    setParams(p, { replace: true });
  };
  const sample = list.data?.items[0];

  return (
    <div>
      <PageHeader
        title="Nhật ký hệ thống"
        description={isStaff ? 'Mọi thao tác quan trọng: đăng nhập, tài khoản, shop, phiên live, cấu hình hệ thống' : role === 'owner' ? 'Hoạt động trên các shop của bạn và của nhân viên bạn quản lý' : 'Hoạt động trong phạm vi được phép xem'}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Select className="w-full sm:w-60" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Loại hành động">
            <option value="">Mọi loại hành động</option>
            {groups.map(([g, arr]) => (
              <optgroup key={g} label={g}>
                {arr.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <SearchInput value={q} onChange={setQ} placeholder="Tên người thực hiện…" className="w-full sm:w-52" />
          <DateRangeBar
            from={from}
            to={to}
            presets={[1, 7, 30]}
            maxDays={3660}
            allowEmpty
            onChange={(f, t) => {
              setFrom(f);
              setTo(t);
            }}
          />
          {shopId !== undefined && <Chip label={`Shop: ${sample?.shopId === shopId && sample?.shopName ? sample.shopName : `#${shopId}`}`} onClear={() => clearParam('shopId')} />}
          {actorId !== undefined && <Chip label={`Người thực hiện: ${sample?.actorId === actorId ? sample.actorName : `#${actorId}`}`} onClear={() => clearParam('actorId')} />}
          {hasFilter && (
            <Button variant="ghost" onClick={clearAll}>
              Xóa bộ lọc
            </Button>
          )}
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : list.data.items.length ? (
          <div className={cn(list.isFetching && list.isPlaceholderData && 'opacity-60')}>
            <ActivityList items={list.data.items} showShop />
          </div>
        ) : (
          <EmptyState icon={ScrollText} title={hasFilter ? 'Không có nhật ký phù hợp' : 'Chưa có nhật ký'} description={hasFilter ? 'Thử đổi bộ lọc hoặc mở rộng khoảng ngày.' : undefined} />
        )}
        {list.data && list.data.total > 0 && (
          <div className="border-t border-line px-4 py-2.5">
            <Pagination page={page} pageSize={pageSize} total={list.data.total} onChange={setPage} />
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-muted">Thời gian theo giờ Việt Nam. Nhật ký không ghi mật khẩu, token hay khóa bí mật.</p>
    </div>
  );
}
