'use client';

import nextDynamic from 'next/dynamic';
import { APP_BRAND } from '@/lib/app-brand';

const MonitorPage = nextDynamic(
  () => import('@/components/MonitorPage').then((mod) => mod.MonitorPage),
  {
    loading: () => (
      <main className="auth-page">
        <div className="auth-loading">
          <img src="/LOGO4_XOANEN.png" alt={APP_BRAND.name} />
          <div className="auth-loading-text">
            <b>{APP_BRAND.name}</b>
            <span>Đang tải giao diện...</span>
          </div>
        </div>
      </main>
    ),
  },
);

export function MonitorPageLoader() {
  return <MonitorPage />;
}
