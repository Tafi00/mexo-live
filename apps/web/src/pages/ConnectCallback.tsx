import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCopy } from '@/lib/hooks';
import { PublicShell } from '@/components/layout/AppShell';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';

/**
 * Trang Shopee chuyển về sau khi chủ shop đồng ý cấp quyền.
 * Không cần đăng nhập — xác thực bằng liên kết dùng một lần (state).
 */
export default function ConnectCallback() {
  const [params] = useSearchParams();
  const { me } = useAuth();
  const copy = useCopy();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [result, setResult] = useState<{ shopId: number; created: boolean; shopName: string } | null>(null);
  const [error, setError] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api
      .post('/api/connect/callback', {
        code: params.get('code') ?? undefined,
        shop_id: params.get('shop_id') ?? undefined,
        state: params.get('state') ?? undefined,
        main_account_id: params.get('main_account_id') ?? undefined,
      })
      .then((r) => {
        setResult(r);
        setState('ok');
      })
      .catch((e) => {
        setError(errorMessage(e));
        setState('error');
      });
  }, [params]);

  return (
    <PublicShell>
      <Card className="p-7 text-center">
        {state === 'loading' && (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-brand-500" />
            <h1 className="mt-4 text-lg font-semibold">Đang hoàn tất kết nối…</h1>
            <p className="mt-1 text-sm text-muted">Đang xác nhận quyền với Shopee, vui lòng không đóng trang.</p>
          </>
        )}
        {state === 'ok' && result && (
          <>
            <CheckCircle2 className="mx-auto size-12 text-emerald-500" />
            <h1 className="mt-4 text-lg font-semibold">{result.created ? 'Đã kết nối shop' : 'Đã cấp quyền lại'}</h1>
            <p className="mt-1 text-sm text-muted">
              <b className="text-fg">{result.shopName}</b> đã được cấp quyền cho MEXO Live. Hệ thống đang tải danh mục sản phẩm.
            </p>
            {me ? (
              <ButtonLink to={`/shops/${result.shopId}`} variant="primary" className="mt-6">
                Mở shop
              </ButtonLink>
            ) : (
              <p className="mt-6 rounded-lg bg-surface-2 px-4 py-3 text-sm text-muted">Bạn có thể đóng trang này.</p>
            )}
          </>
        )}
        {state === 'error' && (
          <>
            <XCircle className="mx-auto size-12 text-rose-500" />
            <h1 className="mt-4 text-lg font-semibold">Chưa kết nối được</h1>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <div className="mt-5 rounded-lg border border-line bg-surface-2 p-3 text-left text-xs text-muted">
              Nếu đã đồng ý trên Shopee nhưng vẫn lỗi, hãy sao chép địa chỉ trang này gửi cho quản trị viên để dùng chức năng "Dán địa chỉ" (mã chỉ dùng được khoảng 10 phút).
              <Button size="xs" className="mt-2 w-full" icon={<Copy className="size-3.5" />} onClick={() => copy(window.location.href, 'Đã sao chép địa chỉ')}>
                Sao chép địa chỉ trang
              </Button>
            </div>
            {me && (
              <Link to="/shops" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
                Về danh sách shop
              </Link>
            )}
          </>
        )}
      </Card>
    </PublicShell>
  );
}
