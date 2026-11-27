export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query): string {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const isBinary = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined || isForm ? undefined : isBinary ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : isForm || isBinary ? (body as BodyInit) : JSON.stringify(body),
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && onUnauthorized && !url.includes('/api/auth/')) onUnauthorized();
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Lỗi ${res.status}`, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string, params?: Query, init?: RequestInit) => request<T>('GET', url + qs(params), undefined, init),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown, init?: RequestInit) => request<T>('PUT', url, body ?? {}, init),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Đã có lỗi xảy ra';
}

/** Tải file (CSV/XLSX) qua link có cookie */
export function download(url: string, params?: Query) {
  const a = document.createElement('a');
  a.href = url + qs(params);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
