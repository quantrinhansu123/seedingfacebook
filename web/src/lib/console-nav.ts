import type { ViewKey } from '@/lib/app-routes';

export type ConsoleNavTone =
  | 'blue'
  | 'violet'
  | 'indigo'
  | 'cyan'
  | 'teal'
  | 'sky'
  | 'amber'
  | 'slate'
  | 'emerald'
  | 'rose';

export type ConsoleNavItem = {
  key: ViewKey;
  label: string;
  shortLabel: string;
  tone: ConsoleNavTone;
};

export const CONSOLE_NAV_ITEMS: ConsoleNavItem[] = [
  { key: 'home', label: 'Trang chủ', shortLabel: 'Trang chủ', tone: 'blue' },
  { key: 'staff', label: 'Nhân sự', shortLabel: 'Nhân sự', tone: 'violet' },
  { key: 'channels', label: 'Quản lý nhóm', shortLabel: 'Kênh', tone: 'indigo' },
  { key: 'comments', label: 'Bình luận', shortLabel: 'Bình luận', tone: 'cyan' },
  { key: 'report', label: 'Báo cáo', shortLabel: 'Báo cáo', tone: 'teal' },
  { key: 'manage', label: 'Quản lý', shortLabel: 'Quản lý', tone: 'sky' },
  { key: 'history', label: 'Lịch thử thao tác', shortLabel: 'Lịch sử', tone: 'slate' },
  { key: 'leads', label: 'Lead', shortLabel: 'Lead', tone: 'emerald' },
  { key: 'scripts', label: 'Kịch bản', shortLabel: 'Kịch bản', tone: 'violet' },
  { key: 'marketing', label: 'Bài viết', shortLabel: 'Bài viết', tone: 'rose' },
];
