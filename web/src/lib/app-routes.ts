export type ViewKey =
  | 'home'
  | 'staff'
  | 'channels'
  | 'comments'
  | 'report'
  | 'manage'
  | 'history'
  | 'leads'
  | 'scripts'
  | 'marketing';

export const VIEW_ROUTES: Record<ViewKey, string> = {
  home: '/',
  staff: '/nhan-su',
  channels: '/kenh',
  comments: '/binh-luan',
  report: '/bao-cao',
  manage: '/quan-ly',
  history: '/lich-su',
  leads: '/lead',
  scripts: '/kich-ban',
  marketing: '/bai-viet',
};

export const VIEW_LABELS: Record<ViewKey, string> = {
  home: 'Trang chủ',
  staff: 'Nhân sự',
  channels: 'Quản lý nhóm',
  comments: 'Bình luận',
  report: 'Báo cáo',
  manage: 'Quản lý',
  history: 'Lịch thử thao tác',
  leads: 'Lead',
  scripts: 'Kịch bản',
  marketing: 'Bài viết',
};

/** URL cũ → chuyển hướng sau khi gỡ trang */
export const LEGACY_PATH_REDIRECTS: Record<string, string> = {
  '/cookie': '/nhan-su',
};

const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_ROUTES).map(([view, path]) => [path, view]),
) as Record<string, ViewKey>;

export function viewToPath(view: ViewKey): string {
  return VIEW_ROUTES[view];
}

export function pathToView(pathname: string): ViewKey {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return PATH_TO_VIEW[normalized] || 'home';
}

export function fullViewUrl(view: ViewKey, origin = 'http://localhost:3000'): string {
  return `${origin.replace(/\/$/, '')}${viewToPath(view)}`;
}
