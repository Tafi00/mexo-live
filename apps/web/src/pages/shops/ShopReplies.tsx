import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  BadgeDollarSign,
  Bot,
  ChevronDown,
  ChevronRight,
  Gauge,
  History,
  Layers,
  Link2,
  Megaphone,
  MessageSquareWarning,
  MessagesSquare,
  Phone,
  RadioTower,
  RotateCcw,
  Save,
  ScrollText,
  Settings2,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtNumber, fmtRelative } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ReplyLogCard } from '@/components/schedule/replies/ReplyLogCard';
import { RulesCard } from '@/components/schedule/replies/RulesCard';
import { TryPanel } from '@/components/schedule/replies/TryPanel';
import { CONFIG_FIELDS, DEFAULT_REPLY_CONFIG, POLL_REASON, POLL_STATE, type RepliesResp, type ReplyConfig } from '@/components/schedule/replies/types';
import { Button } from '@/components/ui/button';
import { Field, Input, RadioCards, Switch, Textarea } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, ErrorState, PageLoading, Progress, Tabs } from '@/components/ui/misc';
import { useShop } from './ShopLayout';

interface Form {
  enabled: boolean;
  unmatched: 'none' | 'ai';
  context: string;
  config: ReplyConfig;
}

const CONTEXT_MAX = 3000;
const CONTEXT_PLACEHOLDER = `Ví dụ:
• Shop bán: thời trang nữ công sở, size S–XL, chất liệu cotton và lụa.
• Đổi trả: trong 7 ngày nếu lỗi do nhà sản xuất hoặc giao nhầm mẫu.
• Bảo hành: đường may 30 ngày.
• Phí ship: theo phí vận chuyển của Shopee, áp dụng mã miễn phí vận chuyển của Shopee.
• Lưu ý: không hứa tặng quà hay giảm giá nếu chưa có trong phiên.`;

const FILTER_ITEMS = [
  { icon: Link2, label: 'Đường link' },
  { icon: Phone, label: 'Số điện thoại' },
  { icon: AtSign, label: 'Kênh liên hệ ngoài Shopee (Zalo, Facebook, @tài khoản, inbox…)' },
  { icon: BadgeDollarSign, label: 'Nhắc giá tiền' },
  { icon: Store, label: 'Nhắc sàn khác hoặc bên thứ ba' },
  { icon: MessageSquareWarning, label: 'Lời lẽ xúc phạm' },
  { icon: Megaphone, label: 'Khuyến mãi chưa được xác nhận (AI)' },
];

function toForm(d: RepliesResp): Form {
  return { enabled: d.enabled, unmatched: d.unmatched === 'ai' ? 'ai' : 'none', context: d.context ?? '', config: { ...d.config } };
}

function ContentFilterCard() {
  return (
    <Card>
      <CardHeader title="Lớp lọc nội dung" icon={<ShieldCheck className="size-4" />} description="Áp dụng cho mọi câu trả lời: kịch bản và AI" />
      <div className="space-y-3 p-4">
        <ul className="space-y-1.5">
          {FILTER_ITEMS.map((it) => (
            <li key={it.label} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <it.icon className="size-3" />
              </span>
              <span>{it.label}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Câu vi phạm không bao giờ được đăng. Kịch bản vi phạm sẽ <b className="text-fg">tự tắt kèm cảnh báo</b> — sửa câu trả lời để bật lại. Kịch bản do shop soạn được phép nêu khuyến mãi.
        </p>
      </div>
    </Card>
  );
}

function PollCard({ poll }: { poll: RepliesResp['commentPoll'] }) {
  const st = POLL_STATE[poll.state] ?? { label: poll.state, tone: 'neutral' as const, description: '' };
  const reason = poll.reason ? (POLL_REASON[poll.reason] ?? poll.reason) : null;
  return (
    <Card>
      <CardHeader
        title="Đọc bình luận"
        icon={<RadioTower className="size-4" />}
        actions={
          <Badge tone={st.tone} dot pulse={poll.state === 'normal'}>
            {st.label}
          </Badge>
        }
      />
      <div className="space-y-1 px-4 py-2.5 text-sm">
        <p className="text-xs text-muted">{st.description}</p>
        {poll.state !== 'normal' && (
          <>
            {reason && (
              <p>
                <span className="text-muted">Nguyên nhân: </span>
                <span className="font-medium">{reason}</span>
              </p>
            )}
            {poll.until && Date.parse(poll.until) > Date.now() && (
              <p>
                <span className="text-muted">Thử lại: </span>
                <span className="font-medium">{fmtRelative(poll.until)}</span>
              </p>
            )}
            {poll.failures > 0 && <p className="text-xs text-muted">{poll.failures} lần lỗi liên tiếp</p>}
          </>
        )}
      </div>
    </Card>
  );
}

export default function ShopReplies() {
  const { shop } = useShop();
  const { can } = useAuth();
  const canWrite = can('comment.reply') && shop.service.state !== 'expired' && shop.status !== 'suspended';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'settings' | 'rules' | 'logs' | null) ?? 'settings';
  const setTab = (t: string) => {
    const p = new URLSearchParams(params);
    if (t === 'settings') p.delete('tab');
    else p.set('tab', t);
    setParams(p, { replace: true });
  };

  const q = useQuery({ queryKey: ['shop', shop.id, 'replies'], queryFn: () => api.get<RepliesResp>(`/api/shops/${shop.id}/replies`), refetchInterval: 30_000 });
  const d = q.data;
  const base = useMemo(() => (d ? toForm(d) : null), [d]);
  const [draft, setDraft] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cfgErr, setCfgErr] = useState<Partial<Record<keyof ReplyConfig, string>>>({});
  const [showGlobal, setShowGlobal] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [error]);

  const form = draft ?? base;
  const dirty = Boolean(draft && base && JSON.stringify(draft) !== JSON.stringify(base));
  const edit = (patch: Partial<Form>) => form && setDraft({ ...form, ...patch });

  const qc = useQueryClient();
  const save = useAction((f: Form) => api.put(`/api/shops/${shop.id}/replies`, f), {
    silentError: true,
    success: 'Đã lưu cài đặt trả lời bình luận',
    invalidate: [['shop', shop.id]],
    onSuccess: (_r, f) => {
      qc.setQueryData<RepliesResp>(['shop', shop.id, 'replies'], (old) => (old ? { ...old, ...f, disabledReason: f.enabled ? null : old.disabledReason } : old));
      setDraft(null);
      setError(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function validate(f: Form): string | null {
    const errs: typeof cfgErr = {};
    for (const c of CONFIG_FIELDS) {
      const v = f.config[c.key];
      if (!Number.isInteger(v) || v < c.min || v > c.max) errs[c.key] = `Từ ${fmtNumber(c.min)} đến ${fmtNumber(c.max)}`;
    }
    setCfgErr(errs);
    if (Object.keys(errs).length) {
      setShowAdvanced(true);
      return 'Giới hạn chống spam (mục Nâng cao) chưa hợp lệ.';
    }
    if (f.enabled && f.unmatched === 'ai' && !d?.aiReady) return 'Hệ thống chưa cấu hình AI nên chưa bật được “AI trả lời”. Chọn “Không trả lời” hoặc liên hệ quản trị viên MEXO.';
    if (f.enabled && f.unmatched === 'ai' && !f.context.trim()) return 'Cần nhập “Đặc trưng của shop” trước khi bật AI trả lời — AI chỉ trả lời dựa trên thông tin này.';
    if (f.context.length > CONTEXT_MAX) return `Đặc trưng của shop tối đa ${CONTEXT_MAX} ký tự.`;
    return null;
  }

  function submit(f: Form | null = form) {
    if (!f) return;
    const msg = validate(f);
    setError(msg);
    if (msg) return;
    save.mutate(f);
  }

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d || !form || !base) return <PageLoading />;

  const aiBlockedReason = !d.aiReady ? 'Hệ thống chưa cấu hình khóa AI — liên hệ quản trị viên MEXO.' : !form.context.trim() ? 'Cần nhập “Đặc trưng của shop” bên dưới trước khi bật.' : null;
  const isDefault = CONFIG_FIELDS.every((c) => form.config[c.key] === DEFAULT_REPLY_CONFIG[c.key]);
  const statusBadge = d.disabledReason ? (
    <Badge tone="danger" dot>
      Đã tự tắt
    </Badge>
  ) : d.enabled ? (
    <Badge tone="success" dot pulse>
      Đang bật
    </Badge>
  ) : (
    <Badge tone="muted" dot>
      Đang tắt
    </Badge>
  );

  return (
    <div className="space-y-4">
      {d.disabledReason && (
        <Callout
          tone="danger"
          title="Trả lời tự động đã tự tắt"
          action={
            canWrite && (
              <Button size="sm" variant="danger" loading={save.isPending} onClick={() => submit({ ...base, enabled: true })}>
                Bật lại
              </Button>
            )
          }
        >
          {d.disabledReason}. Hệ thống tự tắt để tránh gửi lỗi liên tục lên Shopee. Kiểm tra kết nối shop rồi bật lại.
        </Callout>
      )}
      {(d.commentPoll.state === 'stopped' || d.commentPoll.state === 'quarantine') && (
        <Callout tone="danger" title={`Đọc bình luận: ${POLL_STATE[d.commentPoll.state]?.label ?? d.commentPoll.state}`}>
          {d.commentPoll.reason ? (POLL_REASON[d.commentPoll.reason] ?? d.commentPoll.reason) : POLL_STATE[d.commentPoll.state]?.description}
          {d.commentPoll.until && Date.parse(d.commentPoll.until) > Date.now() && ` · tự thử lại ${fmtRelative(d.commentPoll.until)}`}
        </Callout>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'settings', label: 'Cài đặt', icon: <Settings2 className="size-4" /> },
          { value: 'rules', label: 'Kịch bản', icon: <ScrollText className="size-4" />, count: d.rules.all },
          { value: 'logs', label: 'Nhật ký trả lời', icon: <History className="size-4" /> },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {tab === 'settings' && (
            <>
              {/* Công tắc chính + cách xử lý câu không khớp */}
              <Card>
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="hidden size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 sm:grid dark:bg-brand-950/50 dark:text-brand-400">
                    <MessagesSquare className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">Tự động trả lời</h3>
                      {statusBadge}
                      {dirty && form.enabled !== base.enabled && (
                        <Badge tone="warning" size="sm">
                          Chưa lưu
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted">
                      <Layers className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Thứ tự ưu tiên: <b className="font-medium text-fg">Phiên live › Mẫu phát › Shop</b>. Phiên hoặc mẫu phát đặt Bật/Tắt riêng sẽ ghi đè công tắc này.
                      </span>
                    </p>
                  </div>
                  <Switch checked={form.enabled} disabled={!canWrite} onChange={(v) => edit({ enabled: v })} />
                </div>
                <div className="space-y-2 border-t border-line px-4 py-3">
                  <p className="text-xs font-medium">Câu không khớp kịch bản</p>
                  <RadioCards
                    className="sm:grid-cols-2"
                    value={form.unmatched}
                    onChange={(v) => canWrite && edit({ unmatched: v })}
                    options={[
                      { value: 'none', label: 'Không trả lời', description: 'Chỉ trả lời câu khớp kịch bản — kiểm soát hoàn toàn nội dung.', icon: <ScrollText className="mt-0.5 size-4 shrink-0 text-muted" /> },
                      {
                        value: 'ai',
                        label: 'AI trả lời và đăng ngay',
                        description: aiBlockedReason && form.unmatched !== 'ai' ? aiBlockedReason : 'AI soạn từ đặc trưng của shop, qua lớp lọc rồi đăng.',
                        icon: <Bot className="mt-0.5 size-4 shrink-0 text-violet-500" />,
                        disabled: !canWrite || (!d.aiReady && form.unmatched !== 'ai'),
                      },
                    ]}
                  />
                  {form.unmatched === 'ai' && aiBlockedReason && <Callout tone="warning">{aiBlockedReason}</Callout>}
                  {form.unmatched === 'ai' && !aiBlockedReason && (
                    <p className="text-xs text-muted">AI tự chuyển cho nhân viên với câu khó (khiếu nại, đổi trả cụ thể…) và dừng khi hết {fmtNumber(form.config.aiDailyBudget)} lượt trong ngày.</p>
                  )}
                  {d.rules.on === 0 && form.unmatched === 'none' && form.enabled && <Callout tone="warning">Chưa có kịch bản nào đang bật và không dùng AI — sẽ không có bình luận nào được trả lời.</Callout>}
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-surface-2/40 px-4 py-2 text-xs">
                  <button type="button" onClick={() => setTab('rules')} className="inline-flex items-center gap-1 hover:text-brand-600">
                    <span className="text-muted">Kịch bản đang bật</span>
                    <span className="font-semibold tabular">
                      {d.rules.on}/{d.rules.all}
                    </span>
                    <ChevronRight className="size-3.5 text-subtle" />
                  </button>
                  <div className="flex min-w-[200px] items-center gap-2">
                    <span className="shrink-0 text-muted">AI hôm nay</span>
                    <span className="shrink-0 font-semibold tabular">
                      {fmtNumber(d.aiUsedToday)}/{fmtNumber(d.config.aiDailyBudget)}
                    </span>
                    <Progress size="sm" className="w-20" value={d.aiUsedToday} max={Math.max(1, d.config.aiDailyBudget)} tone={d.aiUsedToday >= d.config.aiDailyBudget ? 'danger' : 'violet'} />
                  </div>
                </div>
              </Card>

              {/* Đặc trưng của shop */}
              <Card>
                <CardHeader
                  title="Đặc trưng của shop"
                  icon={<Store className="size-4" />}
                  description="AI chỉ dùng thông tin này và quy định chung để trả lời"
                  actions={<span className={cn('text-2xs tabular', form.context.length > CONTEXT_MAX ? 'font-semibold text-rose-600' : 'text-subtle')}>{fmtNumber(form.context.length)}/{fmtNumber(CONTEXT_MAX)}</span>}
                />
                <div className="space-y-3 p-4">
                  <Field hint="Bán gì, đổi trả, bảo hành, phí ship… mỗi ý một dòng. Không ghi số điện thoại, link hay kênh liên hệ ngoài Shopee.">
                    <Textarea rows={6} disabled={!canWrite} value={form.context} onChange={(e) => edit({ context: e.target.value })} placeholder={CONTEXT_PLACEHOLDER} invalid={form.context.length > CONTEXT_MAX} />
                  </Field>
                  <div className="overflow-hidden rounded-lg border border-line">
                    <button type="button" onClick={() => setShowGlobal(!showGlobal)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-surface-2/60">
                      <span>
                        Quy định chung của hệ thống <span className="font-normal text-muted">· áp cho mọi shop, chỉ xem</span>
                      </span>
                      <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', showGlobal && 'rotate-180')} />
                    </button>
                    {showGlobal && (
                      <div className="border-t border-line bg-surface-2/50 px-3 py-2.5">
                        {d.globalContext.trim() ? <p className="whitespace-pre-wrap text-sm text-muted">{d.globalContext}</p> : <p className="text-xs text-subtle">Chưa có quy định chung.</p>}
                      </div>
                    )}
                  </div>
                </div>
              </Card>

              {/* Nâng cao: giới hạn chống spam */}
              <Card>
                <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-surface-2/40">
                  <Gauge className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold">
                      Nâng cao <span className="text-sm font-normal text-muted">· giới hạn chống spam</span>
                    </p>
                    {!showAdvanced && (
                      <p className="line-clamp-2 text-xs text-muted">
                        {isDefault ? 'Mặc định: ' : ''}
                        {CONFIG_FIELDS.map((c) => c.short(form.config[c.key])).join(' · ')}
                      </p>
                    )}
                  </div>
                  <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', showAdvanced && 'rotate-180')} />
                </button>
                {showAdvanced && (
                  <div className="space-y-3 border-t border-line p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {CONFIG_FIELDS.map((c) => (
                        <Field key={c.key} label={c.label} hint={cfgErr[c.key] ? undefined : `${c.hint}. Mặc định ${fmtNumber(DEFAULT_REPLY_CONFIG[c.key])} ${c.unit}.`} error={cfgErr[c.key]}>
                          <Input
                            type="number"
                            min={c.min}
                            max={c.max}
                            step={1}
                            disabled={!canWrite}
                            invalid={Boolean(cfgErr[c.key])}
                            value={Number.isFinite(form.config[c.key]) ? form.config[c.key] : ''}
                            onChange={(e) => edit({ config: { ...form.config, [c.key]: e.target.value === '' ? NaN : Math.trunc(Number(e.target.value)) } })}
                            trailing={<span className="pointer-events-none pr-1 text-xs">{c.unit}</span>}
                            className="tabular"
                          />
                        </Field>
                      ))}
                    </div>
                    {canWrite && !isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => {
                          edit({ config: { ...DEFAULT_REPLY_CONFIG } });
                          setCfgErr({});
                        }}
                      >
                        Khôi phục mặc định
                      </Button>
                    )}
                  </div>
                )}
              </Card>

              {error && (
                <div ref={errRef}>
                  <Callout tone="danger" title="Chưa lưu được">
                    {error}
                  </Callout>
                </div>
              )}

              {!canWrite && <Callout tone="neutral">Bạn chỉ có quyền xem cài đặt trả lời bình luận của shop này.</Callout>}
              {canWrite && dirty && (
                <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-brand-300 bg-surface/95 px-4 py-2 shadow-pop backdrop-blur dark:border-brand-800">
                  <p className="mr-auto text-sm font-medium">Bạn có thay đổi chưa lưu</p>
                  <Button
                    variant="ghost"
                    icon={<RotateCcw className="size-4" />}
                    onClick={() => {
                      setDraft(null);
                      setError(null);
                      setCfgErr({});
                    }}
                  >
                    Hoàn tác
                  </Button>
                  <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => submit()}>
                    Lưu cài đặt
                  </Button>
                </div>
              )}
            </>
          )}
          {tab === 'rules' && <RulesCard shopId={shop.id} canWrite={canWrite} />}
          {tab === 'logs' && <ReplyLogCard shopId={shop.id} />}
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <TryPanel shopId={shop.id} unmatched={form.unmatched} context={form.context} dirty={dirty} />
          <PollCard poll={d.commentPoll} />
          <ContentFilterCard />
        </div>
      </div>
    </div>
  );
}
