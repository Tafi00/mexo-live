import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Film } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Ảnh xem trước video: chỉ tải khung hình đầu khi thẻ xuất hiện trên màn hình (lazy),
 * video chưa sẵn sàng → nền tối có biểu tượng.
 */
export function VideoThumb({ shopId, videoId, ready, className, children, iconClassName }: { shopId: number; videoId: number | null | undefined; ready: boolean; className?: string; children?: ReactNode; iconClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ready || !videoId || visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready, videoId, visible]);

  const show = ready && videoId && visible && !err;
  return (
    <div ref={ref} className={cn('relative overflow-hidden bg-gradient-to-br from-slate-700 to-slate-900 dark:from-slate-800 dark:to-slate-950', className)}>
      {(!show || !loaded) && (
        <span className="absolute inset-0 grid place-items-center text-white/30">
          <Film className={cn('size-6', iconClassName)} />
        </span>
      )}
      {show && (
        <video
          src={`/api/shops/${shopId}/videos/${videoId}/file#t=1`}
          preload="metadata"
          muted
          playsInline
          disablePictureInPicture
          onLoadedData={() => setLoaded(true)}
          onError={() => setErr(true)}
          className={cn('absolute inset-0 size-full object-cover transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
      {children}
    </div>
  );
}
