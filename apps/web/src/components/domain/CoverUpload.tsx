import { useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Ảnh bìa livestream (JPG/PNG ≤ 2 MB). value = storage key */
export function CoverUpload({ value, onChange, className, required }: { value: string | null | undefined; onChange: (key: string | null) => void; className?: string; required?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const url = value ? `/api/files/cover?key=${encodeURIComponent(value)}` : null;

  async function pick(file: File) {
    if (!/^image\/(jpeg|png)$/.test(file.type)) return toast.error('Ảnh bìa phải là JPG hoặc PNG');
    if (file.size > 2 * 1024 * 1024) return toast.error('Ảnh bìa tối đa 2 MB');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post<{ key: string }>('/api/files/cover', fd);
      onChange(r.key);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn(
          'group relative grid aspect-[3/4] w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed bg-surface-2 text-muted transition-colors hover:border-brand-400 hover:text-brand-600',
          required && !value ? 'border-amber-400' : 'border-line-strong',
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : url ? (
          <>
            <img src={url} alt="Ảnh bìa" className="absolute inset-0 size-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <RefreshCw className="size-5" />
            </span>
          </>
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px]">
            <ImagePlus className="size-5" />
            Tải ảnh bìa
          </span>
        )}
      </button>
      <div className="space-y-1.5 pt-1 text-xs text-muted">
        <p>JPG hoặc PNG, tối đa 2 MB.</p>
        <p>Nên dùng ảnh dọc 3:4 hoặc 9:16.</p>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-rose-600 hover:underline">
            <X className="size-3" /> Bỏ ảnh
          </button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
