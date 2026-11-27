import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { LiveSession, TemplateSummary } from '@/lib/types';
import { Segmented } from '@/components/ui/form';
import { Badge } from '@/components/ui/misc';
import type { SessionReplyMode } from './types';

const MODE_LABEL: Record<SessionReplyMode, string> = { inherit: 'Theo mẫu/shop', on: 'Bật', off: 'Tắt' };

/** Chế độ trả lời của mẫu phát (khóa riêng để không bị làm mới theo mỗi sự kiện phiên) */
function useTemplateReplyMode(shopId: number, templateId: number | null) {
  return useQuery({
    queryKey: ['tpl-reply-mode', shopId],
    queryFn: async () => {
      const r = await api.get<{ items: TemplateSummary[] }>(`/api/shops/${shopId}/templates`);
      return Object.fromEntries(r.items.map((t) => [t.id, { mode: t.replyMode, name: t.name }])) as Record<number, { mode: TemplateSummary['replyMode']; name: string }>;
    },
    enabled: templateId !== null,
    staleTime: 5 * 60_000,
  });
}

/**
 * Bật/tắt trả lời bình luận tự động cho riêng phiên này.
 * Ưu tiên: cài đặt phiên → mẫu phát → shop.
 */
export function AutoReplyControl({ session, shopReplyEnabled, canSet }: { session: LiveSession & { replyMode?: SessionReplyMode }; shopReplyEnabled: boolean; canSet: boolean }) {
  const mode: SessionReplyMode = session.replyMode ?? 'inherit';
  const [pending, setPending] = useState<SessionReplyMode | null>(null);
  const tpl = useTemplateReplyMode(session.shopId, session.templateId);
  const tplInfo = session.templateId !== null ? tpl.data?.[session.templateId] : undefined;

  const set = useAction((m: SessionReplyMode) => api.patch(`/api/sessions/${session.id}/reply`, { mode: m }), {
    invalidate: [['session', session.id], ['live']],
    onSuccess: (_r, m) => {
      toast.success(m === 'on' ? 'Đã bật trả lời tự động cho phiên này' : m === 'off' ? 'Đã tắt trả lời tự động cho phiên này' : 'Phiên dùng lại cài đặt của mẫu phát / shop');
    },
    onError: () => setPending(null),
  });

  // Giữ lựa chọn vừa bấm cho tới khi dữ liệu phiên làm mới khớp
  useEffect(() => {
    if (pending && mode === pending) setPending(null);
  }, [mode, pending]);

  const shown = pending ?? mode;
  let on: boolean;
  let source: string;
  if (shown === 'on' || shown === 'off') {
    on = shown === 'on';
    source = 'cài đặt riêng của phiên';
  } else if (tplInfo && tplInfo.mode !== 'inherit') {
    on = tplInfo.mode === 'on';
    source = `mẫu phát “${tplInfo.name}”`;
  } else {
    on = shopReplyEnabled;
    source = 'cài đặt trả lời của shop';
  }
  const failing = on && session.replyState === 'attn';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <Bot className="size-3.5 text-muted" />
          Tự động trả lời
        </span>
        <Badge tone={failing ? 'danger' : on ? 'success' : 'muted'} size="sm" dot pulse={on && !failing && session.state === 'live'}>
          {failing ? 'Đang lỗi gửi' : on ? 'Đang bật' : 'Đang tắt'}
        </Badge>
      </div>
      {canSet ? (
        <Segmented
          size="sm"
          className="flex w-full [&>button]:flex-1 [&>button]:justify-center"
          value={shown}
          onChange={(m) => {
            if (m === mode || set.isPending) return;
            setPending(m);
            set.mutate(m);
          }}
          options={(['inherit', 'on', 'off'] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
        />
      ) : (
        <p className="text-xs text-muted">Cài đặt phiên: {MODE_LABEL[mode]}</p>
      )}
      <p className="text-2xs leading-relaxed text-muted">
        Hiện {on ? 'bật' : 'tắt'} theo {source}. Ưu tiên: cài đặt phiên → mẫu phát → shop.
      </p>
    </div>
  );
}
