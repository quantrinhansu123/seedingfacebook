function isLocalBrowserHost(hostname: string): boolean {  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (isLocalBrowserHost(host)) {
      // Gọi cùng origin (Next rewrite → Flask) — tránh treo/CORS khi gọi thẳng :5000.
      return '';
    }
  }
  if (configured) return configured.replace(/\/$/, '');
  return '';
}

const API_TIMEOUT_MS = 12000;
const AI_TIMEOUT_MS = 120000;

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
