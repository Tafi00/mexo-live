import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, ListRestart, Save, Send, Sparkles, Timer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Badge, Callout, Card, CardHeader, ErrorState, PageLoading } from '@/components/ui/misc';

interface AiSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  hasKey: boolean;
  keyHint: string | null;
  models: string[];
  globalContext: string;
  ready: boolean;
  canEdit: boolean;
  contextMax: number;
}

const T_MAX = 1.5;
const BAND = [0.3, 0.5] as const;

function TemperatureSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const pct = (v: number) => `${(v / T_MAX) * 100}%`;
  const inBand = value >= BAND[0] && value <= BAND[1];
  return (
    <div>
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-3" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-emerald-400/70 dark:bg-emerald-500/50" style={{ left: pct(BAND[0]), width: `${((BAND[1] - BAND[0]) / T_MAX) * 100}%` }} />
        <input
          type="range"
          min={0}
          max={T_MAX}
          step={0.05}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Temperature"
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-500 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
        />
      </div>
      <div className="relative mt-0.5 h-4 text-[11px] text-muted">
        <span className="absolute left-0">0 · ổn định</span>
        <span className="absolute -translate-x-1/2 font-medium text-emerald-700 dark:text-emerald-400" style={{ left: pct((BAND[0] + BAND[1]) / 2) }}>
          khuyến nghị
        </span>
        <span className="absolute right-0">1,5 · đa dạng</span>
      </div>
      {!inBand && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
          {value > BAND[1] ? 'Cao hơn khuyến nghị: câu trả lời đa dạng hơn nhưng dễ bịa thông tin hoặc lạc đề.' : 'Thấp hơn khuyến nghị: trả lời rất giống nhau giữa các bình luận, dễ bị coi là spam.'}
        </p>
      )}
    </div>
  );
}

export function SettingsAi() {
  const q = useQuery({ queryKey: ['settings', 'ai'], queryFn: () => api.get<AiSettings>('/api/settings/ai') });
  const d = q.data;
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.4);
  const [ctx, setCtx] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [question, setQuestion] = useState('Shop ơi sản phẩm này còn hàng không ạ?');
  const [test, setTest] = useState<{ ok: true; latencyMs: number; answer: string } | { ok: false; error: string } | null>(null);

  useEffect(() => {
    if (!d) return;
    setBaseUrl(d.baseUrl);
    setModel(d.model);
    setTemperature(d.temperature);
    setCtx(d.globalContext);
    setModels(d.models ?? []);
    setApiKey('');
  }, [d]);

  const urlErr = useMemo(() => {
    if (!baseUrl.trim()) return 'Bắt buộc nhập Base URL';
    try {
      const u = new URL(baseUrl.trim());
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Base URL phải bắt đầu bằng https://';
    } catch {
      return 'Base URL không hợp lệ';
    }
    return null;
  }, [baseUrl]);
  const notHttps = !urlErr && baseUrl.trim().startsWith('http://');
  const max = d?.contextMax ?? 4000;
  const over = ctx.length > max;
  const dirty = Boolean(d) && (baseUrl !== d!.baseUrl || model !== d!.model || temperature !== d!.temperature || ctx !== d!.globalContext || apiKey.trim() !== '');
  const canEdit = d?.canEdit ?? false;
  const keyBody = apiKey.trim() ? { apiKey: apiKey.trim() } : {};

  const save = useAction(() => api.put('/api/settings/ai', { baseUrl: baseUrl.trim(), model: model.trim(), temperature, globalContext: ctx, ...keyBody }), {
    success: 'Đã lưu cấu hình AI',
    invalidate: [['settings', 'ai']],
  });
  const loadModels = useAction(() => api.post<{ models: string[] }>('/api/settings/ai/models', { baseUrl: baseUrl.trim(), ...keyBody }), {
    success: (r) => `Tải được ${r.models.length} model`,
    onSuccess: (r) => setModels(r.models),
  });
  const runTest = useAction(() => api.post<{ latencyMs: number; answer: string }>('/api/settings/ai/test', { baseUrl: baseUrl.trim(), model: model.trim(), temperature, globalContext: ctx, question: question.trim() || undefined, ...keyBody }), {
    silentError: true,
    onSuccess: (r) => setTest({ ok: true, ...r }),
    onError: (e) => setTest({ ok: false, error: errorMessage(e) }),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return <PageLoading />;

  const noKey = !d.hasKey && !apiKey.trim();

  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader
          title="Kết nối mô hình AI"
          icon={<Bot className="size-4" />}
          description="Dùng chuẩn OpenAI-compatible (gọi {Base URL}/chat/completions) để trả lời bình luận tự động"
          actions={
            d.ready ? (
              <Badge tone="success" icon={<CheckCircle2 className="size-3.5" />}>
                Sẵn sàng
              </Badge>
            ) : (
              <Badge tone="warning" icon={<KeyRound className="size-3.5" />}>
                Chưa có khóa API
              </Badge>
            )
          }
        />
        <div className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base URL" required error={urlErr} hint={!urlErr ? 'Bắt buộc HTTPS, không dùng địa chỉ nội bộ/IP riêng (trừ khi máy chủ bật cờ cho phép).' : undefined} className="sm:col-span-2">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} placeholder="https://api.openai.com/v1" className="font-mono" spellCheck={false} invalid={Boolean(urlErr)} />
            </Field>
            {notHttps && <Callout tone="warning" className="sm:col-span-2">Địa chỉ đang dùng http:// — máy chủ sẽ từ chối nếu chưa bật cờ cho phép địa chỉ nội bộ/không mã hóa.</Callout>}
            <Field
              label="Khóa API"
              className="sm:col-span-2"
              hint={d.hasKey ? `Đã lưu khóa ${d.keyHint ?? ''} — để trống nếu không đổi. Khóa được mã hóa và không bao giờ hiển thị lại.` : 'Chưa có khóa. Khóa được mã hóa khi lưu và không bao giờ hiển thị lại.'}
            >
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!canEdit}
                autoComplete="new-password"
                spellCheck={false}
                className="font-mono"
                placeholder={d.hasKey ? `${d.keyHint ?? '••••'}  (giữ nguyên)` : 'sk-…'}
                trailing={
                  <button type="button" className="rounded p-0.5 hover:text-fg" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Ẩn khóa' : 'Hiện khóa'}>
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              />
            </Field>
            <Field
              label="Model"
              required
              className="sm:col-span-2"
              hint={models.length ? `${models.length} model khả dụng — gõ để lọc` : 'Bấm “Tải danh sách model” để lấy model từ nhà cung cấp, hoặc nhập tay.'}
            >
              <div className="flex gap-2">
                <Input list="mexo-ai-models" value={model} onChange={(e) => setModel(e.target.value)} disabled={!canEdit} className="flex-1 font-mono" placeholder="gpt-4o-mini" spellCheck={false} />
                <datalist id="mexo-ai-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <Button icon={<ListRestart className="size-4" />} loading={loadModels.isPending} disabled={!canEdit || Boolean(urlErr) || noKey} onClick={() => loadModels.mutate()}>
                  Tải danh sách model
                </Button>
              </div>
            </Field>
          </div>

          <Field label={<span>Temperature: <b className="tabular">{temperature.toLocaleString('vi-VN', { minimumFractionDigits: 2 })}</b></span>} hint="Khuyến nghị 0,3–0,5: trả lời ổn định, bám sát quy định, ít bịa.">
            <TemperatureSlider value={temperature} onChange={setTemperature} disabled={!canEdit} />
          </Field>

          <Field
            label="Quy định chung (ngữ cảnh toàn hệ thống)"
            hint="Áp dụng cho mọi câu trả lời AI ở mọi shop, trước ngữ cảnh riêng của từng shop. Nêu rõ điều được và không được nói."
            error={over ? `Vượt ${fmtNumber(ctx.length - max)} ký tự so với giới hạn` : null}
            aside={<span className={cn('text-xs tabular', over ? 'font-semibold text-rose-600' : ctx.length > max * 0.9 ? 'text-amber-600' : 'text-muted')}>{fmtNumber(ctx.length)}/{fmtNumber(max)}</span>}
          >
            <Textarea value={ctx} onChange={(e) => setCtx(e.target.value)} disabled={!canEdit} rows={8} invalid={over} className="min-h-[180px]" />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            {dirty && <span className="mr-auto text-xs text-amber-700 dark:text-amber-400">Có thay đổi chưa lưu</span>}
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setBaseUrl(d.baseUrl);
                  setModel(d.model);
                  setTemperature(d.temperature);
                  setCtx(d.globalContext);
                  setApiKey('');
                }}
              >
                Hoàn tác
              </Button>
            )}
            <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!canEdit || !dirty || Boolean(urlErr) || !model.trim() || over} onClick={() => save.mutate()}>
              Lưu cấu hình AI
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-5 xl:col-span-2">
        <Card>
          <CardHeader title="Gọi thử" icon={<Sparkles className="size-4" />} description="Dùng cấu hình đang nhập (chưa cần lưu) để hỏi thử một câu" />
          <div className="space-y-3 p-5">
            <Field label="Câu hỏi của khách">
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} onKeyDown={(e) => e.key === 'Enter' && !runTest.isPending && runTest.mutate()} />
            </Field>
            <Button variant="primary" className="w-full" icon={<Send className="size-4" />} loading={runTest.isPending} disabled={Boolean(urlErr) || !model.trim() || noKey || over} onClick={() => runTest.mutate()}>
              Gọi thử
            </Button>
            {noKey && <p className="text-xs text-muted">Cần nhập khóa API trước khi gọi thử.</p>}
            {test &&
              (test.ok ? (
                <div className="space-y-2">
                  <div className="rounded-xl rounded-tl-sm border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed">{test.answer || <span className="text-muted">(Không có nội dung trả lời)</span>}</div>
                  <p className="inline-flex items-center gap-1 text-xs text-muted">
                    <Timer className="size-3.5" />
                    Phản hồi sau <b className={cn('tabular', test.latencyMs > 8000 ? 'text-rose-600' : test.latencyMs > 4000 ? 'text-amber-600' : 'text-fg')}>{fmtNumber(test.latencyMs)} ms</b>
                    {test.latencyMs > 4000 && ' — chậm, khách có thể đã rời phiên'}
                  </p>
                </div>
              ) : (
                <Callout tone="danger" title="Gọi thử thất bại">
                  {test.error}
                </Callout>
              ))}
          </div>
        </Card>
        <Callout tone="neutral" title="Gợi ý">
          AI chỉ trả lời bình luận không khớp kịch bản, ở những shop bật “dùng AI”, trong giới hạn lượt AI mỗi ngày của shop. Mọi câu trả lời AI đều đi qua bộ lọc nội dung trước khi đăng; mỗi shop có thể thêm ngữ cảnh riêng trong phần Trả lời bình luận.
        </Callout>
      </div>
    </div>
  );
}
