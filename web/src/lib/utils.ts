export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return d + 's trước';
  if (d < 3600) return Math.floor(d / 60) + ' phút trước';
  if (d < 86400) return Math.floor(d / 3600) + ' giờ trước';
  if (d < 2592000) return Math.floor(d / 86400) + ' ngày trước';
  return new Date(iso).toLocaleDateString('vi-VN');
}

export function initials(name: string | undefined): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1]![0]!.toUpperCase();
}

const COLORS = ['#1877f2', '#e41e3f', '#2dba4e', '#f7a21e', '#9b59b6', '#1abc9c'];

export function avatarColor(name: string | undefined): string {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return COLORS[h % COLORS.length]!;
}

export function escRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function socialAuthorProfileUrl(row: {
  author_id?: string;
  source?: string;
}): string {
  const id = String(row.author_id || '').trim();
  if (!id) return '';
  const src = String(row.source || '').toLowerCase();
  if (src.includes('facebook')) {
    return `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`;
  }
  return '';
}

export function facebookGroupIdFromChannel(item: {
  target_id?: string;
  link?: string;
}): string {
  const id = String(item.target_id || '').trim();
  if (id) return id;
  const link = String(item.link || '').trim();
  if (!link) return '';
  const match = link.match(/facebook\.com\/groups\/([^/?#]+)/i);
  if (match?.[1]) return match[1];
  return extractSlug(link);
}

export function extractSlug(raw: string): string {
  try {
    const url = new URL(raw.includes('://') ? raw : 'https://' + raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('groups');
    if (i !== -1 && parts[i + 1]) return parts[i + 1]!.replace(/[^a-zA-Z0-9._-]/g, '');
  } catch {
    /* ignore */
  }
  return raw.trim().replace(/[^a-zA-Z0-9._-]/g, '');
}

export function classifyFacebookFeedError(message: string): 'network' | 'auth' | 'other' {
  const low = String(message || '').toLowerCase();
  if (
    low.includes('dns') ||
    low.includes('mạng') ||
    low.includes('graph.facebook.com') ||
    low.includes('kết nối') ||
    low.includes('timeout') ||
    low.includes('getaddrinfo') ||
    low.includes('failed to resolve')
  ) {
    return 'network';
  }
  if (
    low.includes('cookie') ||
    low.includes('token') ||
    low.includes('hết hạn') ||
    low.includes('xác thực') ||
    low.includes('quyền')
  ) {
    return 'auth';
  }
  return 'other';
}

export function buildTikTokCommentUrl(row: {
  comment_url?: string;
  post_url?: string;
  comment_id?: string;
}): string {
  const direct = String(row.comment_url || '').trim();
  if (direct) return direct;
  const postUrl = String(row.post_url || '').trim();
  const commentId = String(row.comment_id || '').replace(/^tiktok_/i, '').trim();
  if (!postUrl) return '';
  if (!commentId) return postUrl;
  const joiner = postUrl.includes('?') ? '&' : '?';
  return `${postUrl}${joiner}comment=${encodeURIComponent(commentId)}`;
}
