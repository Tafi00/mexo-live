import { useSearchParams } from 'react-router-dom';
import { Bot, Network, ShieldOff, SlidersHorizontal, Snowflake } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { SettingsAi } from '@/components/admin/SettingsAi';
import { FreezeTab, InfraTab, SystemLimitsTab, useSystemSettings } from '@/components/admin/SettingsSystem';
import { EmptyState, PageHeader, Tabs } from '@/components/ui/misc';

type Tab = 'ai' | 'system' | 'freeze' | 'infra';
const TABS: Tab[] = ['ai', 'system', 'freeze', 'infra'];

export default function SettingsPage() {
  const { isStaff, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'ai';
  const sys = useSystemSettings(isStaff);
  const frozen = sys.data?.freeze.frozen ?? me?.system.frozen ?? false;
  const openBreakers = sys.data?.breakers.filter((b) => b.open).length ?? 0;
  const failingJobs = sys.data?.jobs.filter((j) => j.failures > 0).length ?? 0;

  if (!isStaff) return <EmptyState icon={ShieldOff} title="Không có quyền truy cập" description="Trang này chỉ dành cho quản trị viên MEXO." />;

  return (
    <div>
      <PageHeader title="Cấu hình hệ thống" description="Trợ lý AI, giới hạn vận hành, đóng băng khẩn cấp và kết nối hạ tầng" />
      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={(v) => {
          const p = new URLSearchParams(params);
          if (v === 'ai') p.delete('tab');
          else p.set('tab', v);
          setParams(p, { replace: true });
        }}
        items={[
          { value: 'ai', label: 'Trợ lý AI', icon: <Bot className="size-3.5" /> },
          { value: 'system', label: 'Hệ thống', icon: <SlidersHorizontal className="size-3.5" /> },
          { value: 'freeze', label: frozen ? 'Đóng băng · ĐANG BẬT' : 'Đóng băng hệ thống', icon: <Snowflake className={frozen ? 'size-3.5 text-sky-500' : 'size-3.5'} /> },
          { value: 'infra', label: 'Kết nối Shopee & hạ tầng', icon: <Network className="size-3.5" />, count: openBreakers + failingJobs || null, tone: 'danger' },
        ]}
      />
      {tab === 'ai' && <SettingsAi />}
      {tab === 'system' && <SystemLimitsTab />}
      {tab === 'freeze' && <FreezeTab />}
      {tab === 'infra' && <InfraTab />}
    </div>
  );
}
