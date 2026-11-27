import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ListVideo } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDuration } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { LiveSession, ShopDetail } from '@/lib/types';
import { CoverUpload } from '@/components/domain/CoverUpload';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { useShopTemplates } from './helpers';

/** Hộp tạo phiên live trên Shopee cho 1 shop */
export function CreateSessionDialog({ shop, open, onClose }: { shop: Pick<ShopDetail, 'id' | 'name'>; open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const tpl = useShopTemplates(shop.id, open);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [autoTitle, setAutoTitle] = useState('');
  const [autoCover, setAutoCover] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setCoverKey(null);
    setTemplateId(null);
    setAutoTitle('');
    setAutoCover(null);
    setTouched(false);
  }, [open]);

  const templates = tpl.data?.items ?? [];
  const selected = templates.find((t) => t.id === templateId) ?? null;

  function pickTemplate(id: number | null) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const nextTitle = (t.liveTitle || t.name).slice(0, 200);
    // Chỉ điền sẵn khi người dùng chưa tự nhập (hoặc giá trị hiện tại do mẫu trước điền)
    if (!title.trim() || title === autoTitle) {
      setTitle(nextTitle);
      setAutoTitle(nextTitle);
    }
    if (t.coverKey && (!coverKey || coverKey === autoCover)) {
      setCoverKey(t.coverKey);
      setAutoCover(t.coverKey);
    }
  }

  const create = useAction((body: { title: string; description: string; coverKey: string; templateId: number | null }) => api.post<LiveSession>(`/api/shops/${shop.id}/sessions`, body), {
    success: 'Đã tạo phiên live trên Shopee',
    invalidate: [['shop', shop.id], ['shops'], ['live'], ['dashboard']],
    onSuccess: (r) => {
      onClose();
      nav(`/sessions/${r.id}`);
    },
  });

  const titleErr = touched && !title.trim() ? 'Cần nhập tên phiên' : undefined;
  const coverErr = touched && !coverKey ? 'Shopee bắt buộc có ảnh bìa' : undefined;

  function submit() {
    setTouched(true);
    if (!title.trim() || !coverKey) return;
    create.mutate({ title: title.trim(), description: description.trim(), coverKey, templateId });
  }

  return (
    <Dialog
      open={open}
      onClose={() => !create.isPending && onClose()}
      dismissable={!create.isPending}
      title="Tạo phiên live"
      description={`Tạo phiên mới trên Shopee cho ${shop.name}. Phiên ở trạng thái "Chưa bắt đầu" cho tới khi bạn bắt đầu phát.`}
      size="lg"
      footer={
        <>
          {create.isPending && <span className="mr-auto text-xs text-muted">Đang tải ảnh bìa và tạo phiên trên Shopee…</span>}
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            Hủy
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Tạo phiên
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Mẫu phát" hint="Không bắt buộc. Chọn mẫu để điền sẵn tiêu đề và ảnh bìa; khi bắt đầu phát tự động bạn vẫn chọn lại được." aside={<ListVideo className="size-3.5 text-subtle" />}>
          <Select value={templateId ?? ''} onChange={(e) => pickTemplate(e.target.value ? Number(e.target.value) : null)} disabled={tpl.isLoading}>
            <option value="">{tpl.isLoading ? 'Đang tải mẫu phát…' : templates.length ? '— Không dùng mẫu —' : 'Shop chưa có mẫu phát'}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.number} · {t.name} ({t.videoCount} video{t.issueCount ? ` · ${t.issueCount} cảnh báo` : ''})
              </option>
            ))}
          </Select>
        </Field>
        {selected && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            <span>{selected.videoCount} video · {fmtDuration(selected.durationSec)}</span>
            <span>{selected.productCount} sản phẩm ghim</span>
            <span>{selected.loop ? 'Lặp vòng' : 'Phát 1 lượt'}</span>
            {selected.issueCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                {selected.issueCount} vấn đề cần xử lý trước khi phát
              </span>
            )}
          </div>
        )}
        <Field label="Tên phiên" required error={titleErr} hint={`${title.length}/200 ký tự — người xem thấy tên này trên Shopee Live`}>
          <Input value={title} maxLength={200} invalid={Boolean(titleErr)} onChange={(e) => setTitle(e.target.value)} placeholder="vd: Xả kho cuối tuần — giảm đến 50%" autoFocus />
        </Field>
        <Field label="Mô tả" hint={`${description.length}/1000 ký tự`}>
          <Textarea value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="Giới thiệu ngắn về phiên live (không bắt buộc)" />
        </Field>
        <Field label="Ảnh bìa" required error={coverErr}>
          <CoverUpload value={coverKey} onChange={setCoverKey} required />
        </Field>
        <Callout tone="info">Mỗi shop chỉ có 1 phiên mở tại một thời điểm. Sau khi tạo, vào bảng điều khiển phiên để bắt đầu phát tự động bằng mẫu phát.</Callout>
      </form>
    </Dialog>
  );
}
