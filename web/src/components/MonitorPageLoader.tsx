'use client';

import nextDynamic from 'next/dynamic';

const MonitorPage = nextDynamic(
  () => import('@/components/MonitorPage').then((mod) => mod.MonitorPage),
  {
    loading: () => (
      <main className="auth-page">
        <div className="auth-loading">
          <img src="/st-real-logo.jpg" alt="Seeding Fsolution" />
          <div className="auth-loading-text">
            <b>Seeding Fsolution</b>
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
