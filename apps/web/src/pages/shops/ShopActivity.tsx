import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ActivityList } from '@/components/domain/ActivityList';
import { Card, CardHeader, PageLoading } from '@/components/ui/misc';
import { useShop } from './ShopLayout';

export default function ShopActivity() {
  const { shop } = useShop();
  const q = useQuery({ queryKey: ['shop', shop.id, 'activity'], queryFn: () => api.get(`/api/shops/${shop.id}/activity`) });
  return (
    <Card>
      <CardHeader title="Nhật ký shop" description="Kết nối, hạn dùng, tên gợi nhớ, phiên, video, mẫu, lịch — kèm người thực hiện" />
      {q.isLoading ? <PageLoading /> : <ActivityList items={q.data?.items ?? []} />}
    </Card>
  );
}
