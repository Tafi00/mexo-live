import { EventEmitter } from 'node:events';

/** Bus sự kiện nội bộ: đẩy cập nhật thời gian thực tới dashboard qua SSE */
class Events extends EventEmitter {}
export const events = new Events();
events.setMaxListeners(1000);

export type LiveEvent =
  | { type: 'session'; shopId: number; sessionId: number }
  | { type: 'comment'; shopId: number; sessionId: number }
  | { type: 'alert' }
  | { type: 'server' }
  | { type: 'shop'; shopId: number };

export function publish(ev: LiveEvent): void {
  events.emit('live', ev);
}
