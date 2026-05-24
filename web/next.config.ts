import type { NextConfig } from 'next';

const apiProxyBase = (process.env.API_PROXY_BASE_URL || 'https://fb-moni.vercel.app').replace(/\/$/, '');

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
