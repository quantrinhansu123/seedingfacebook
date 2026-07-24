export function getApiBase(): string {
  // Trình duyệt luôn gọi /api cùng origin → Vercel rewrite sang Flask (tránh CORS & URL /api/api lỗi 404).
  if (typeof window !== 'undefined') {
    return '';
  }
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return '';
}

const API_TIMEOUT_MS = 30000;
export const AUTH_TIMEOUT_MS = 75000;
export const AI_TIMEOUT_MS = 120000;
export const UPLOAD_TIMEOUT_MS = 120000;
export const PUBLISH_TIMEOUT_MS = 180000;

export function formatFetchError(err: unknown, fallback = 'Không gọi được backend'): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Máy chủ chưa phản hồi kịp. Nếu Render đang khởi động, đợi một lát rồi thử lại.';
  }
  const message = err instanceof Error ? err.message : String(err || '');
  if (/aborted|abort/i.test(message)) {
    return 'Máy chủ chưa phản hồi kịp. Nếu Render đang khởi động, đợi một lát rồi thử lại.';
  }
  return message || fallback;
}

export type ApiInit = RequestInit & { timeoutMs?: number };

export function api(path: string, init?: ApiInit): Promise<Response> {
  const { timeoutMs = API_TIMEOUT_MS, signal: externalSignal, ...fetchInit } = init || {};
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  return fetch(url, {
    credentials: 'include',
    ...fetchInit,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  });
}
