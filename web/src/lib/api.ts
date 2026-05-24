export function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
      return `${window.location.protocol}//${host}:5000`;
    }
    return '';
  }
  return 'http://127.0.0.1:5000';
}

export function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    ...init,
  });
}
