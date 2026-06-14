'use client';

import { CONSOLE_MODULE_ICONS } from '@/lib/console-nav-icons';
import { CONSOLE_NAV_ITEMS } from '@/lib/console-nav';
import type { ViewKey } from '@/lib/app-routes';

const MODULE_DESCS: Partial<Record<ViewKey, string>> = {
  staff: 'Quản lý tài khoản sale và quyền thao tác.',
  channels: 'Lưu nền tảng, kênh, page, video và nhóm.',
  comments: 'Inbox comment đa kênh, lọc tag và tách lead.',
  manage: 'Theo dõi bài viết, phân loại và vận hành.',
  history: 'Xem lịch sử comment và trạng thái thao tác.',
  leads: 'Theo dõi khách hàng tiềm năng và nhu cầu.',
  marketing: 'Soạn bài viết chuẩn, lên lịch và chọn nơi đăng.',
};

const HOME_MODULES = CONSOLE_NAV_ITEMS.filter((item) => item.key !== 'home');

export function ConsoleHome({ staffName, onOpen }: { staffName?: string; onOpen: (key: ViewKey) => void }) {
  return (
    <section className="home-view">
      <div className="home-title">
        <h1>Chào buổi tối, {staffName || 'Admin'} 👋</h1>
        <p>Chọn module để vận hành hệ thống social console.</p>
      </div>
      <div className="home-tabs">
        <button className="active" type="button">
          Chức năng
        </button>
        <button type="button">Đánh dấu</button>
        <button type="button">Tất cả</button>
      </div>
      <div className="module-card-grid">
        {HOME_MODULES.map((item) => {
          const Icon = CONSOLE_MODULE_ICONS[item.key];
          return (
            <button key={item.key} type="button" className="module-card" onClick={() => onOpen(item.key)}>
              <span className={`module-card-icon rail-tone-${item.tone}`} aria-hidden="true">
                <Icon strokeWidth={2.1} />
              </span>
              <div className="module-card-body">
                <b>{item.label}</b>
                <small>{MODULE_DESCS[item.key]}</small>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
