import { db } from '../db/client.js';
import { activityLogs } from '../db/schema.js';

export interface ActorRef {
  id: number | null;
  name: string;
  ip?: string | null;
}

export const SYSTEM_ACTOR: ActorRef = { id: null, name: 'Hệ thống' };

export async function audit(
  actor: ActorRef,
  code: string,
  opts: { shopId?: number | null; targetAccountId?: number | null; params?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      actorId: actor.id,
      actorName: actor.name,
      shopId: opts.shopId ?? null,
      targetAccountId: opts.targetAccountId ?? null,
      code,
      params: opts.params ?? {},
      ip: actor.ip ?? null,
    });
  } catch (e) {
    console.error('[audit] ghi nhật ký lỗi', e);
  }
}
