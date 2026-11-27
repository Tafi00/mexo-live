import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type LiveEvent =
  | { type: 'session'; shopId: number; sessionId: number }
  | { type: 'comment'; shopId: number; sessionId: number }
  | { type: 'alert' }
  | { type: 'server' }
  | { type: 'shop'; shopId: number };

/**
 * Nhận sự kiện thời gian thực (SSE) và làm mới các truy vấn liên quan.
 * Quy ước queryKey: ['shops'...], ['shop', id, ...], ['session', id, ...], ['live'], ['dashboard'], ['alerts'], ['servers'], ['shell'], ['comments'...]
 */
export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource('/api/events', { withCredentials: true });
      es.onmessage = (m) => {
        let batch: LiveEvent[] = [];
        try {
          batch = JSON.parse(m.data);
        } catch {
          return;
        }
        const keys = new Set<string>();
        for (const ev of batch) {
          if (ev.type === 'session') {
            keys.add(JSON.stringify(['session', ev.sessionId]));
            keys.add(JSON.stringify(['shop', ev.shopId]));
            keys.add('live');
            keys.add('shops');
            keys.add('dashboard');
          } else if (ev.type === 'comment') {
            keys.add(JSON.stringify(['session', ev.sessionId, 'comments']));
            keys.add('comments');
          } else if (ev.type === 'shop') {
            keys.add(JSON.stringify(['shop', ev.shopId]));
            keys.add('shops');
            keys.add('dashboard');
          } else if (ev.type === 'alert') {
            keys.add('alerts');
            keys.add('shell');
            keys.add('me');
          } else if (ev.type === 'server') {
            keys.add('servers');
            keys.add('shell');
          }
        }
        for (const k of keys) {
          const key = k.startsWith('[') ? JSON.parse(k) : [k];
          void qc.invalidateQueries({ queryKey: key });
        }
      };
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [enabled, qc]);
}
