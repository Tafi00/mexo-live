import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from './api';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Đồng hồ cập nhật mỗi giây (thời lượng live, đếm ngược) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Mutation tiện dụng: tự toast lỗi/thành công và làm mới các queryKey liên quan.
 */
export function useAction<TVars = void, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes) => string | null); invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void; onError?: (e: unknown) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(errorMessage(e));
      opts.onError?.(e);
    },
  });
}

export function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}

export function useCopy() {
  return useCallback(async (text: string, label = 'Đã sao chép') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error('Không sao chép được');
    }
  }, []);
}

export function useClickOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}

export function useTheme(): ['light' | 'dark', () => void] {
  const [t, setT] = useState<'light' | 'dark'>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const toggle = useCallback(() => {
    const next = t === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('mexo-theme', next);
    } catch {
      /* ignore */
    }
    setT(next);
  }, [t]);
  return [t, toggle];
}
