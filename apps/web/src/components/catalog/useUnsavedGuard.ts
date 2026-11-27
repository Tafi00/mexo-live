import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { useConfirm } from '@/components/ui/dialog';

const MESSAGE = {
  title: 'Rời trang khi chưa lưu?',
  description: 'Các thay đổi trong mẫu phát chưa được lưu sẽ bị mất.',
  confirmText: 'Rời trang, bỏ thay đổi',
  cancelText: 'Ở lại',
  danger: true,
};

/**
 * Chặn rời trang khi còn thay đổi chưa lưu.
 * Ứng dụng dùng BrowserRouter (không có useBlocker) nên chặn bằng:
 * - beforeunload (đóng tab / tải lại),
 * - bắt sự kiện bấm liên kết nội bộ ở pha capture rồi hỏi xác nhận.
 * Trả về hàm điều hướng có hỏi xác nhận để dùng cho nút "Quay lại".
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = url.pathname + url.search + url.hash;
      if (to === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      void confirm(MESSAGE).then((r) => {
        if (r.ok) {
          dirtyRef.current = false;
          navigate(to);
        }
      });
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm, navigate]);

  /** Điều hướng có hỏi xác nhận nếu còn thay đổi */
  const guardedNavigate = useCallback(
    async (to: To, opts?: NavigateOptions) => {
      if (dirtyRef.current) {
        const r = await confirm(MESSAGE);
        if (!r.ok) return;
      }
      dirtyRef.current = false;
      navigate(to, opts);
    },
    [confirm, navigate],
  );

  /** Bỏ chặn (vd. ngay sau khi lưu thành công rồi điều hướng) */
  const release = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  return { guardedNavigate, release };
}
