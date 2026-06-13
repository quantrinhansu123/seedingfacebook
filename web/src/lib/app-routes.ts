export type ViewKey =
  | 'home'
  | 'staff'
  | 'channels'
  | 'comments'
  | 'manage'
  | 'cookies'
  | 'history'
  | 'leads'
  | 'marketing';

export const VIEW_ROUTES: Record<ViewKey, string> = {
  home: '/',
  staff: '/nhan-su',
  channels: '/kenh',
  comments: '/binh-luan',
  manage: '/quan-ly',
  cookies: '/cookie',
  history: '/lich-su',
  leads: '/lead',
  marketing: '/bai-viet',
};

export const VIEW_LABELS: Record<ViewKey, string> = {
  home: 'Trang chủ',
  staff: 'Nhân sự',
  channels: 'Quản lý nhóm',
  comments: 'Bình luận',
  manage: 'Quản lý',
  cookies: 'Cooki',
  history: 'Lịch thử thao tác',
  leads: 'Lead',
  marketing: 'Bài viết',
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
