import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { foldVi, LIMITS } from '@mexo/shared';
import { cn } from '@/lib/cn';

/** Ô nhập từ khóa dạng chip: Enter hoặc dấu phẩy để thêm, Backspace để xóa */
export function KeywordInput({ value, onChange, invalid, max = LIMITS.ruleKeywordsMax }: { value: string[]; onChange: (v: string[]) => void; invalid?: boolean; max?: number }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const full = value.length >= max;

  function add(raw: string) {
    const parts = raw
      .split(/[,;\n|]/)
      .map((p) => p.trim().slice(0, 40))
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(value.map((v) => foldVi(v)));
    const next = [...value];
    for (const p of parts) {
      const f = foldVi(p);
      if (seen.has(f) || next.length >= max) continue;
      seen.add(f);
      next.push(p);
    }
    onChange(next);
    setText('');
  }

  return (
    <div
      onClick={() => ref.current?.focus()}
      className={cn(
        'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 transition-[border,box-shadow] focus-within:border-brand-400 focus-within:ring-3 focus-within:ring-[var(--ring)]',
        invalid ? 'border-rose-400' : 'border-line-strong',
      )}
    >
      {value.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-brand-50 py-0.5 pl-2 pr-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900">
          <span className="truncate">{k}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((_, j) => j !== i));
            }}
            className="rounded p-0.5 hover:bg-brand-100 dark:hover:bg-brand-900/60"
            aria-label={`Xóa từ khóa ${k}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={text}
        disabled={full}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\n]/.test(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === 'Tab') && text.trim()) {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          if (/[,;\n]/.test(t)) {
            e.preventDefault();
            add(text + t);
          }
        }}
        placeholder={full ? `Đã đủ ${max} từ khóa` : value.length ? 'Thêm từ khóa…' : 'Gõ từ khóa rồi nhấn Enter, ví dụ: bảo hành'}
        className="h-6 min-w-[140px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle focus-visible:shadow-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
