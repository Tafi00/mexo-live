import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { LiveSession } from '@/lib/types';
import { CoverUpload } from '@/components/domain/CoverUpload';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';

/** Sửa tiêu đề / mô tả / ảnh bìa — chỉ khi phiên chưa bắt đầu */
export function EditSessionDialog({ session, open, onClose }: { session: LiveSession; open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(session.title);
  const [description, setDescription] = useState(session.description ?? '');
  const [coverKey, setCoverKey] = useState<string | null>(session.coverKey);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(session.title);
    setDescription(session.description ?? '');
    setCoverKey(session.coverKey);
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useAction((body: { title: string; description: string; coverKey: string | null }) => api.patch(`/api/sessions/${session.id}`, body), {
    success: 'Đã cập nhật thông tin phiên trên Shopee',
    invalidate: [['session', session.id], ['shop', session.shopId], ['live']],
    onSuccess: () => onClose(),
  });

  const titleErr = touched && !title.trim() ? 'Cần nhập tên phiên' : undefined;
  const coverErr = touched && !coverKey ? 'Shopee yêu cầu gửi lại ảnh bìa khi sửa thông tin' : undefined;

  function submit() {
    setTouched(true);
    if (!title.trim() || !coverKey) return;
    save.mutate({ title: title.trim(), description: description.trim(), coverKey });
  }

  return (
    <Dialog
      open={open}
      onClose={() => !save.isPending && onClose()}
      dismissable={!save.isPending}
      title="Sửa thông tin phiên"
      description="Chỉ sửa được khi phiên chưa bắt đầu trên Shopee."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Hủy
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            Lưu thay đổi
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
        <Field label="Tên phiên" required error={titleErr} hint={`${title.length}/200 ký tự`}>
          <Input value={title} maxLength={200} invalid={Boolean(titleErr)} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Mô tả" hint={`${description.length}/1000 ký tự`}>
          <Textarea value={description} maxLength={1000} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Ảnh bìa" required error={coverErr}>
          <CoverUpload value={coverKey} onChange={setCoverKey} required />
        </Field>
        <Callout tone="info">Shopee yêu cầu gửi lại ảnh bìa mỗi lần sửa tiêu đề hoặc mô tả. Nếu bạn không đổi ảnh, hệ thống tự gửi lại ảnh bìa hiện tại.</Callout>
      </form>
    </Dialog>
  );
}
