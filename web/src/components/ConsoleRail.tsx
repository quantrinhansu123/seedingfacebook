'use client';

import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { CONSOLE_MODULE_ICONS } from '@/lib/console-nav-icons';
import { CONSOLE_NAV_ITEMS } from '@/lib/console-nav';
import type { ViewKey } from '@/lib/app-routes';

type ConsoleRailProps = {
  activeView: ViewKey;
  onNavigate: (view: ViewKey) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
};

export function ConsoleRail({ activeView, onNavigate, collapsed = false, onToggleCollapse }: ConsoleRailProps) {
  return (
    <aside className={`console-rail${collapsed ? ' collapsed' : ''}`}>
      <div className="console-rail-brand">
        <img className="console-logo" src="/st-real-logo.jpg" alt="Seeding Fsolution" />
        <div className="console-rail-title">
          <b>Seeding</b>
          <span>Fsolution</span>
        </div>
        {onToggleCollapse ? (
          <button
            type="button"
            className="rail-collapse-top"
            title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
            aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            {collapsed ? <ChevronRight /> : <PanelLeftClose />}
          </button>
        ) : null}
      </div>

      <nav className="console-rail-nav" aria-label="Điều hướng chính">
        {CONSOLE_NAV_ITEMS.map((item) => {
          const Icon = CONSOLE_MODULE_ICONS[item.key];
          const active = activeView === item.key;

          return (
            <button
              key={item.key}
              type="button"
              className={`rail-link rail-tone-${item.tone}${active ? ' active' : ''}`}
              title={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <span className="rail-icon-wrap" aria-hidden="true">
                <Icon strokeWidth={2.1} />
              </span>
              <span className="rail-label">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
