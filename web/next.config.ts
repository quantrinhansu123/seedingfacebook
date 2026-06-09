import type { NextConfig } from 'next';

const DEFAULT_API_PROXY_BASE_URL = 'https://web-sand-phi-41.vercel.app';
const apiProxyBase = (process.env.API_PROXY_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_PROXY_BASE_URL).replace(/\/$/, '');

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
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
