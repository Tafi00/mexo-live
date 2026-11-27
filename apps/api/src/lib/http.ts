import { z, type ZodTypeAny } from 'zod';
import { err } from './errors.js';

export { z };

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first?.path.join('.') || 'dữ liệu';
    throw err.badRequest('validation', `${field}: ${first?.message ?? 'không hợp lệ'}`, r.error.issues);
  }
  return r.data;
}

export function idOf(params: unknown, key = 'id'): number {
  const v = Number((params as Record<string, string>)[key]);
  if (!Number.isInteger(v) || v <= 0) throw err.notFound();
  return v;
}

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

export function paginate<T>(items: T[], page: number, pageSize: number) {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải theo định dạng HH:mm');

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\r\n');
}
