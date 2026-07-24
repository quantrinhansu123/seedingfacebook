import type { NextConfig } from 'next';
import path from 'path';

const DEFAULT_API_PROXY_BASE_URL = 'https://seedingfacebook.onrender.com';
const webRoot = path.join(__dirname);

function normalizeUrl(value?: string): string {
  let normalized = (value || '').trim().replace(/\/$/, '');
  if (normalized.toLowerCase().endsWith('/api')) {
    normalized = normalized.slice(0, -4).replace(/\/$/, '');
  }
  return normalized;
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLocalBackend(url: string): boolean {
  const host = hostOf(url);
  return host === '127.0.0.1' || host === 'localhost';
}

function resolveApiProxyBase(): string {
  const configured = normalizeUrl(process.env.API_PROXY_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL);
  const frontendHosts = new Set(
    [
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_URL,
      'fb-moni.vercel.app',
      'seeding-beta.vercel.app',
    ]
      .map((host) => (host || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase())
      .filter(Boolean),
  );

  // Local dev must hit Flask on this machine, even if .env.local still points to Render.
  if (process.env.NODE_ENV === 'development') {
    if (configured && isLocalBackend(configured)) {
      return configured;
    }
    return 'http://127.0.0.1:5000';
  }

  // API_PROXY_BASE_URL must point to the Flask backend. If it points back to the
  // Vercel frontend, /api rewrites loop to itself and the login page shows
  // "Không kết nối được server".
  if (configured && !frontendHosts.has(hostOf(configured))) {
    return configured;
  }
  return DEFAULT_API_PROXY_BASE_URL;
}

const apiProxyBase = resolveApiProxyBase();

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Tránh Next chọn nhầm root D:\Seeding_Fb (package-lock.json ở repo gốc).
  outputFileTracingRoot: webRoot,
  turbopack: {
    root: webRoot,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiProxyBase}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
