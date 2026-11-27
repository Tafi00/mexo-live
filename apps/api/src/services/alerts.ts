import { and, eq, isNull, sql } from 'drizzle-orm';
import { ALERT_TYPE_LABELS } from '@mexo/shared';
import { db } from '../db/client.js';
import { alerts } from '../db/schema.js';
import { events } from './events.js';

export type Severity = 'critical' | 'warning' | 'info';

/**
 * Tạo hoặc gộp cảnh báo. Cảnh báo cùng `key` khi còn mở sẽ được gộp (tăng count, cập nhật lastAt).
 * Nếu cảnh báo đã được "Đã nhận" thì lần lặp sau vẫn gộp vào nhưng không nhắc lại.
 */
export async function raiseAlert(input: {
  key: string;
  type: string;
  severity: Severity;
  title?: string;
  message?: string;
  shopId?: number | null;
  serverId?: number | null;
  sessionId?: number | null;
}): Promise<void> {
  const now = new Date();
  const title = input.title ?? ALERT_TYPE_LABELS[input.type] ?? input.type;
  try {
    const updated = await db
      .update(alerts)
      .set({ count: sql`${alerts.count} + 1`, lastAt: now, message: input.message ?? '', severity: input.severity })
      .where(and(eq(alerts.key, input.key), isNull(alerts.resolvedAt)))
      .returning({ id: alerts.id });
    if (updated.length === 0) {
      await db
        .insert(alerts)
        .values({
          key: input.key,
          type: input.type,
          severity: input.severity,
          title,
          message: input.message ?? '',
          shopId: input.shopId ?? null,
          serverId: input.serverId ?? null,
          sessionId: input.sessionId ?? null,
          firstAt: now,
          lastAt: now,
        })
        .onConflictDoNothing();
      events.emit('alert', { key: input.key, severity: input.severity });
    }
  } catch (e) {
    console.error('[alerts] raise lỗi', e);
  }
}

/** Đóng cảnh báo khi điều kiện đã hết */
export async function resolveAlert(key: string): Promise<void> {
  try {
    await db.update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.key, key), isNull(alerts.resolvedAt)));
  } catch (e) {
    console.error('[alerts] resolve lỗi', e);
  }
}

export async function resolveAlertsLike(prefix: string): Promise<void> {
  await db
    .update(alerts)
    .set({ resolvedAt: new Date() })
    .where(and(sql`${alerts.key} LIKE ${prefix + '%'}`, isNull(alerts.resolvedAt)));
}
