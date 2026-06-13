'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CommentAuthorHeading, CommentAuthorLink } from '@/components/CommentAuthorLink';
import { api } from '@/lib/api';
import type { StoredPostComment } from '@/lib/types';
import './omni-inbox.css';

type TabKey = 'inbox' | 'customers' | 'stats' | 'templates';
type ChannelFilter = 'all' | 'facebook' | 'tiktok' | 'instagram';
type SourceKey = 'fb-page' | 'fb-group' | 'tiktok' | 'instagram';
type TagKey = string;
type WorkflowFilter = 'all' | 'open' | 'done' | 'starred';

type CommentPayload = {
  ok?: boolean;
  comments?: StoredPostComment[];
  count?: number;
  warning?: string;
  error?: string;
};

type TikTokBridgeResult = {
  ok?: boolean;
  comment_id?: string;
  cid?: string;
  id?: string;
  post_id?: string;
  post_url?: string;
  url?: string;
  error?: string;
  method?: string;
  manual?: boolean;
  fallback_allowed?: boolean;
  warning?: string;
};

type TikTokOpenCommentResult = {
  ok?: boolean;
  url?: string;
  error?: string;
  message?: string;
  method?: string;
  target_found?: boolean;
};

type TagMeta = {
  key: TagKey;
  label: string;
  icon: string;
  className: string;
  system?: boolean;
};

type ReplyTemplate = {
  id: string;
  trigger: string;
  title: string;
  text: string;
  system?: boolean;
};

const CHANNEL_FILTERS: { key: ChannelFilter; label: string; materialIcon: string }[] = [
  { key: 'all', label: 'Tất cả kênh', materialIcon: 'apps' },
  { key: 'facebook', label: 'Facebook', materialIcon: 'public' },
  { key: 'tiktok', label: 'TikTok', materialIcon: 'movie' },
];

const SOURCE_META: Record<SourceKey, { label: string; icon: string; materialIcon: string; className: string; chipClass: string }> = {
  'fb-page': { label: 'Facebook', icon: '📘', materialIcon: 'public', className: 'src-page', chipClass: 'facebook' },
  'fb-group': { label: 'Facebook', icon: '👥', materialIcon: 'public', className: 'src-group', chipClass: 'facebook' },
  tiktok: { label: 'TikTok', icon: '🎵', materialIcon: 'movie', className: 'src-tiktok', chipClass: 'tiktok' },
  instagram: { label: 'Instagram', icon: '📷', materialIcon: 'photo_camera', className: 'src-instagram', chipClass: 'instagram' },
};

const TAGS: TagMeta[] = [
  { key: 'hot', label: 'Nóng', icon: '🔥', className: 'tag-hot' },
  { key: 'closed', label: 'Đã chốt', icon: '💰', className: 'tag-closed' },
  { key: 'need', label: 'Có nhu cầu', icon: '🎯', className: 'tag-need' },
  { key: 'price', label: 'Hỏi giá', icon: '❔', className: 'tag-price' },
  { key: 'review', label: 'Xem xét', icon: '🔎', className: 'tag-review' },
  { key: 'vip', label: 'VIP', icon: '⭐', className: 'tag-vip' },
];

const QUICK_REPLIES: ReplyTemplate[] = [
  {
    id: 'need',
    trigger: 'nhucau',
    title: 'Hỏi nhu cầu',
    text: 'Em chào anh/chị, mình cần hỗ trợ nội dung nào ạ? Anh/chị gửi thêm yêu cầu để bên em tư vấn đúng hơn nhé.',
  },
  {
    id: 'price',
    trigger: 'baogia',
    title: 'Báo giá',
    text: 'Em đã nhận thông tin. Anh/chị cho em xin nhu cầu cụ thể và số lượng/khối lượng để bên em báo giá chính xác ạ.',
  },
  {
    id: 'phone',
    trigger: 'sdt',
    title: 'Xin SĐT',
    text: 'Anh/chị để lại SĐT hoặc nhắn inbox giúp em, sale bên em sẽ liên hệ tư vấn nhanh ạ.',
  },
  {
    id: 'closed',
    trigger: 'chot',
    title: 'Đã chốt',
    text: 'Em cảm ơn anh/chị. Bên em sẽ ghi nhận thông tin và liên hệ xác nhận đơn/yêu cầu ngay ạ.',
  },
];

const WORKFLOW_STORAGE_KEY = 'streal-comment-inbox-workflow-v1';
const MANUAL_TAG_STORAGE_KEY = 'streal-comment-manual-tags-v1';

function readWorkflowStore() {
  if (typeof window === 'undefined') return { processed: [] as string[], starred: [] as string[] };
  try {
    const raw = window.localStorage.getItem(WORKFLOW_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      processed: Array.isArray(parsed.processed) ? parsed.processed.filter(Boolean) : [],
      starred: Array.isArray(parsed.starred) ? parsed.starred.filter(Boolean) : [],
    };
  } catch {
    return { processed: [] as string[], starred: [] as string[] };
  }
}

function readManualTagStore() {
  if (typeof window === 'undefined') return {} as Record<string, string[]>;
  try {
    const raw = window.localStorage.getItem(MANUAL_TAG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string[]> : {};
  } catch {
    return {};
  }
}

function templateRows(rows?: ReplyTemplate[]) {
  const source = Array.isArray(rows) && rows.length ? rows : QUICK_REPLIES;
  return source.map((item, index) => ({
    id: String(item.id || item.trigger || item.title || index),
    trigger: String(item.trigger || item.title || '').replace(/^\//, '').trim().toLowerCase(),
    title: String(item.title || item.trigger || 'Mẫu câu'),
    text: String(item.text || ''),
    system: Boolean(item.system),
  })).filter((item) => item.text);
}

function tagRows(rows?: (Partial<TagMeta> & { id?: string; color?: string })[]) {
  const source: (Partial<TagMeta> & { id?: string; color?: string })[] = Array.isArray(rows) && rows.length ? rows : TAGS;
  return source.map((item, index) => {
    const key = String(item.key || item.id || item.label || index);
    const color = String((item as { color?: string }).color || '').toLowerCase();
    return {
      key,
      label: String(item.label || key),
      icon: String(item.icon || '🏷️'),
      className: String(item.className || `tag-${color || key}`),
      system: Boolean(item.system),
    };
  });
}

function normalizeText(value?: string) {
  return (value || '').toLowerCase();
}

function sourceKey(row: StoredPostComment): SourceKey {
  const source = normalizeText(row.source);
  if (source.includes('page')) return 'fb-page';
  if (source.includes('tiktok')) return 'tiktok';
  if (source.includes('instagram') || source === 'ig') return 'instagram';
  if (source.includes('facebook')) return 'fb-group';
  return 'fb-group';
}

function channelFilterKey(row: StoredPostComment): ChannelFilter {
  const key = sourceKey(row);
  if (key === 'tiktok') return 'tiktok';
  if (key === 'instagram') return 'instagram';
  return 'facebook';
}

function matchesChannelFilter(row: StoredPostComment, filter: ChannelFilter) {
  if (filter === 'all') return true;
  return channelFilterKey(row) === filter;
}

function workflowId(row: StoredPostComment) {
  return row.comment_id || commentKey(row);
}

function isRowProcessed(row: StoredPostComment, processedSet: Set<string>) {
  return Boolean(row.processed) || processedSet.has(workflowId(row)) || processedSet.has(commentKey(row));
}

function isRowStarred(row: StoredPostComment, starredSet: Set<string>) {
  return Boolean(row.starred) || starredSet.has(workflowId(row)) || starredSet.has(commentKey(row));
}

function sourceLabel(row: StoredPostComment) {
  const key = sourceKey(row);
  return SOURCE_META[key];
}

function commentText(row: StoredPostComment) {
  return row.message || '';
}

function commentKey(row: StoredPostComment) {
  return (
    row.comment_id ||
    [
      row.source || 'comment',
      row.post_id || row.group_id || 'post',
      row.author_id || row.author_name || 'author',
      row.created_time || row.fetched_at || 'time',
      (row.message || '').slice(0, 80),
    ].join('|')
  );
}

function commentTags(row: StoredPostComment, tagOptions: TagMeta[] = TAGS, manualTagIds: string[] = []): TagMeta[] {
  const text = normalizeText(commentText(row));
  const matched = new Set((row.matched_keywords || []).map((item) => normalizeText(item)));
  const phones = row.phones || (row.phone ? [row.phone] : []);
  const tags = new Set<TagKey>();

  if (phones.length || /gấp|ngay|inbox|ib|nhắn|zalo|sđt|sdt|phone/.test(text)) tags.add('hot');
  if (/chốt|đặt|mua|lấy|order|đơn|ship/.test(text)) tags.add('closed');
  if (row.is_matched || matched.size || /quan tâm|cần|tư vấn|hỗ trợ|muốn|có không|còn không/.test(text)) tags.add('need');
  if (/giá|bao nhiêu|báo giá|quote|phí|tiền/.test(text)) tags.add('price');
  if (phones.length && tags.has('need')) tags.add('vip');
  if (!tags.size || /\?/.test(text)) tags.add('review');

  manualTagIds.forEach((item) => item && tags.add(item));
  return tagOptions.filter((item) => tags.has(item.key));
}

function commentTime(row: StoredPostComment) {
  const raw = row.created_time || row.fetched_at;
  if (!raw) return '-';
  try {
    return new Date(raw).toLocaleString('vi-VN');
  } catch {
    return raw;
  }
}

function commentTimeShort(row: StoredPostComment) {
  const raw = row.created_time || row.fetched_at;
  if (!raw) return '-';
  try {
    const date = new Date(raw);
    const diff = Date.now() - date.getTime();
    if (diff > 86400000 * 2) return date.toLocaleDateString('vi-VN');
    if (diff > 86400000) return 'Hôm qua';
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return raw;
  }
}

function authorInitials(name?: string) {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function tagMaterialIcon(key: string) {
  const map: Record<string, { icon: string; filled?: boolean; color?: string }> = {
    hot: { icon: 'local_fire_department', filled: true, color: '#ef4444' },
    closed: { icon: 'verified', color: '#16a34a' },
    need: { icon: 'stars', filled: true, color: '#f97316' },
    price: { icon: 'payments', color: '#3b82f6' },
    review: { icon: 'search', color: '#64748b' },
    vip: { icon: 'workspace_premium', color: '#9333ea' },
  };
  return map[key] || { icon: 'label', color: '#64748b' };
}

function MaterialIcon({ name, filled, className, style }: { name: string; filled?: boolean; className?: string; style?: CSSProperties }) {
  return <span className={`material-symbols-outlined${filled ? ' filled' : ''}${className ? ` ${className}` : ''}`} style={style}>{name}</span>;
}

function channelName(row: StoredPostComment) {
  if (row.channel_name) return row.channel_name;
  if (row.video_title) return row.video_title;
  if (row.group_id) return row.group_id;
  return row.post_id || '-';
}

export function CommentLeadInboxPanel() {
  const [tab, setTab] = useState<TabKey>('inbox');
  const [comments, setComments] = useState<StoredPostComment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [sourceFilter, setSourceFilter] = useState<ChannelFilter>('all');
  const [tagFilter, setTagFilter] = useState<TagKey | ''>('');
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyStatus, setReplyStatus] = useState('');
  const [templates, setTemplates] = useState<ReplyTemplate[]>(() => templateRows(QUICK_REPLIES));
  const [templateForm, setTemplateForm] = useState({ title: '', trigger: '', text: '' });
  const [tagOptions, setTagOptions] = useState<TagMeta[]>(() => tagRows(TAGS));
  const [newTagLabel, setNewTagLabel] = useState('');
  const [manualTagsByComment, setManualTagsByComment] = useState<Record<string, string[]>>(() => readManualTagStore());
  const [tiktokBridgeReady, setTiktokBridgeReady] = useState(false);
  const [tiktokBridgeVersion, setTiktokBridgeVersion] = useState('');
  const [processedIds, setProcessedIds] = useState<string[]>(() => readWorkflowStore().processed);
  const [starredIds, setStarredIds] = useState<string[]>(() => readWorkflowStore().starred);

  const processedSet = useMemo(() => new Set(processedIds), [processedIds]);
  const starredSet = useMemo(() => new Set(starredIds), [starredIds]);

  const loadWorkflow = useCallback(async () => {
    try {
      const r = await api('/api/post-comments/workflow');
      if (!r.ok) return;
      const data = await r.json().catch(() => ({}));
      if (!data.ok) return;
      const processed = Array.isArray(data.processed) ? data.processed.filter(Boolean) : [];
      const starred = Array.isArray(data.starred) ? data.starred.filter(Boolean) : [];
      setProcessedIds(processed);
      setStarredIds(starred);
    } catch {
      const local = readWorkflowStore();
      setProcessedIds(local.processed);
      setStarredIds(local.starred);
    }
  }, []);

  const persistWorkflow = async (row: StoredPostComment, patch: { processed?: boolean; starred?: boolean }) => {
    const commentId = row.comment_id || '';
    if (!commentId) return;
    try {
      const r = await api('/api/post-comments/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_id: commentId, ...patch }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) {
        setProcessedIds(Array.isArray(data.processed) ? data.processed : []);
        setStarredIds(Array.isArray(data.starred) ? data.starred : []);
      }
    } catch {
      // localStorage fallback handled by useEffect
    }
  };

  const loadComments = useCallback(async () => {
    setBusy(true);
    setStatus('Đang tải inbox bình luận...');
    try {
      const params = new URLSearchParams({ limit: '1000' });
      if (sourceFilter === 'tiktok') params.set('source', 'tiktok');
      else if (sourceFilter === 'instagram') params.set('source', 'instagram');
      else if (sourceFilter === 'facebook') params.set('source', 'facebook');

      const r = await api(`/api/post-comments?${params.toString()}`);
      if (r.status === 401) {
        setStatus('❌ Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
        setComments([]);
        return;
      }
      const data: CommentPayload = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (!r.ok || data.ok === false) {
        setStatus(`❌ ${data.error || `Không tải được bình luận (${r.status})`}`);
        return;
      }
      const rows = Array.isArray(data.comments) ? data.comments : [];
      setComments(rows);

      const tagMap: Record<string, string[]> = {};
      const processedFromRows: string[] = [];
      const starredFromRows: string[] = [];
      rows.forEach((row) => {
        const key = commentKey(row);
        if (Array.isArray(row.manual_tags) && row.manual_tags.length) {
          tagMap[key] = row.manual_tags;
        }
        const wid = workflowId(row);
        if (row.processed) processedFromRows.push(wid);
        if (row.starred) starredFromRows.push(wid);
      });
      setManualTagsByComment((current) => ({ ...current, ...tagMap }));
      setProcessedIds((current) => Array.from(new Set([...current, ...processedFromRows])));
      setStarredIds((current) => Array.from(new Set([...current, ...starredFromRows])));

      setSelectedId((current) => {
        if (current && rows.some((row) => commentKey(row) === current)) return current;
        return rows[0] ? commentKey(rows[0]) : '';
      });
      setStatus(data.warning ? `⚠️ ${data.warning}` : rows.length ? `✅ Đã tải ${rows.length} bình luận` : 'Chưa có bình luận. Hãy lấy CMT từ bài Facebook/TikTok trước.');
    } catch {
      setStatus('❌ Lỗi kết nối khi tải bình luận');
    } finally {
      setBusy(false);
    }
  }, [sourceFilter]);

  async function loadTemplateConfig() {
    try {
      const [templateRes, tagRes] = await Promise.all([
        api('/api/comment-templates'),
        api('/api/comment-tags'),
      ]);
      const templateData = await templateRes.json().catch(() => ({}));
      const tagData = await tagRes.json().catch(() => ({}));
      if (templateData.ok) setTemplates(templateRows(templateData.templates));
      if (tagData.ok) setTagOptions(tagRows(tagData.tags));
    } catch {
      // Giữ bộ mặc định nếu backend chưa sẵn sàng.
    }
  }

  const reloadInbox = useCallback(async () => {
    await loadWorkflow();
    await loadComments();
  }, [loadComments, loadWorkflow]);

  useEffect(() => {
    void loadWorkflow();
    void loadTemplateConfig();
  }, [loadWorkflow]);

  useEffect(() => {
    if (tab !== 'inbox') return;
    void loadComments();
  }, [sourceFilter, tab, loadComments]);

  useEffect(() => {
    if (tab === 'stats' && !comments.length && !busy) void reloadInbox();
  }, [tab, comments.length, busy, reloadInbox]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      WORKFLOW_STORAGE_KEY,
      JSON.stringify({ processed: processedIds, starred: starredIds }),
    );
  }, [processedIds, starredIds]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MANUAL_TAG_STORAGE_KEY, JSON.stringify(manualTagsByComment));
  }, [manualTagsByComment]);

  useEffect(() => {
    setReplyStatus('');
  }, [selectedId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleBridgeMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data.source !== 'streal-tiktok-extension') return;
      if (data.type === 'STREAL_TIKTOK_BRIDGE_READY') {
        setTiktokBridgeReady(true);
        setTiktokBridgeVersion(data.version || '');
      }
    };

    const pingBridge = () => {
      window.postMessage(
        {
          source: 'streal-web-page',
          type: 'STREAL_TIKTOK_BRIDGE_PING',
          requestId: `comment_inbox_ping_${Date.now()}`,
        },
        window.location.origin,
      );
    };

    window.addEventListener('message', handleBridgeMessage);
    pingBridge();
    const pingTimer = window.setInterval(pingBridge, 2500);
    const stopTimer = window.setTimeout(() => window.clearInterval(pingTimer), 15000);
    return () => {
      window.removeEventListener('message', handleBridgeMessage);
      window.clearInterval(pingTimer);
      window.clearTimeout(stopTimer);
    };
  }, []);

  const tagsForRow = useCallback((row: StoredPostComment) => {
    const key = commentKey(row);
    const manual = manualTagsByComment[key] || row.manual_tags || [];
    return commentTags(row, tagOptions, manual);
  }, [manualTagsByComment, tagOptions]);

  const filtered = useMemo(() => {
    const kw = normalizeText(query);
    return comments.filter((row) => {
      const key = commentKey(row);
      if (!matchesChannelFilter(row, sourceFilter)) return false;
      if (workflowFilter === 'open' && isRowProcessed(row, processedSet)) return false;
      if (workflowFilter === 'done' && !isRowProcessed(row, processedSet)) return false;
      if (workflowFilter === 'starred' && !isRowStarred(row, starredSet)) return false;
      const tags = tagsForRow(row);
      if (tagFilter && !tags.some((tag) => tag.key === tagFilter)) return false;
      if (!kw) return true;
      return [row.author_name, row.message, row.post_id, row.channel_name, row.video_title, row.phone, ...(row.phones || [])]
        .filter(Boolean)
        .some((value) => normalizeText(String(value)).includes(kw));
    });
  }, [comments, query, sourceFilter, tagFilter, workflowFilter, processedSet, starredSet, tagsForRow]);

  const selected = filtered.find((row) => commentKey(row) === selectedId) || filtered[0] || null;

  const workflowCounts = useMemo(() => {
    let done = 0;
    let starred = 0;
    comments.forEach((row) => {
      if (isRowProcessed(row, processedSet)) done += 1;
      if (isRowStarred(row, starredSet)) starred += 1;
    });
    return { all: comments.length, done, open: Math.max(comments.length - done, 0), starred };
  }, [comments, processedSet, starredSet]);

  const channelCounts = useMemo(() => {
    const counts: Record<ChannelFilter, number> = { all: comments.length, facebook: 0, tiktok: 0, instagram: 0 };
    comments.forEach((row) => {
      counts[channelFilterKey(row)] += 1;
    });
    return counts;
  }, [comments]);

  const tagCounts = useMemo(() => {
    const counts: Record<TagKey, number> = {};
    tagOptions.forEach((tag) => { counts[tag.key] = 0; });
    comments.forEach((row) => {
      tagsForRow(row).forEach((tag) => {
        counts[tag.key] = (counts[tag.key] || 0) + 1;
      });
    });
    return counts;
  }, [comments, tagOptions, tagsForRow]);

  const customers = useMemo(() => comments
    .map((row) => {
      const tags = tagsForRow(row);
      const phones = row.phones || (row.phone ? [row.phone] : []);
      const isLead = phones.length || tags.some((tag) => ['hot', 'closed', 'need', 'price', 'vip'].includes(tag.key));
      return isLead ? { row, tags, phones } : null;
    })
    .filter(Boolean) as { row: StoredPostComment; tags: TagMeta[]; phones: string[] }[], [comments, tagsForRow]);

  const statsDashboard = useMemo(() => {
    const withPhone = customers.filter((item) => item.phones.length).length;
    const hotCount = comments.filter((row) => tagsForRow(row).some((tag) => tag.key === 'hot')).length;
    const processRate = comments.length ? Math.round((workflowCounts.done / comments.length) * 100) : 0;
    const leadRate = comments.length ? Math.round((customers.length / comments.length) * 100) : 0;

    const channelRows = CHANNEL_FILTERS
      .filter((channel) => channel.key !== 'all')
      .map((channel) => ({
        ...channel,
        count: channelCounts[channel.key],
        pct: comments.length ? Math.round((channelCounts[channel.key] / comments.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const tagRows = tagOptions
      .map((tag) => ({
        tag,
        count: tagCounts[tag.key] || 0,
        pct: comments.length ? Math.round(((tagCounts[tag.key] || 0) / comments.length) * 100) : 0,
        meta: tagMaterialIcon(tag.key),
      }))
      .sort((a, b) => b.count - a.count);

    const dailyMap: Record<string, number> = {};
    comments.forEach((row) => {
      const raw = row.created_time || row.fetched_at;
      if (!raw) return;
      try {
        const label = new Date(raw).toLocaleDateString('vi-VN');
        dailyMap[label] = (dailyMap[label] || 0) + 1;
      } catch {
        /* ignore */
      }
    });
    const parseViDate = (value: string) => {
      const [d, m, y] = value.split('/').map((part) => Number(part));
      return new Date(y || 1970, (m || 1) - 1, d || 1).getTime();
    };
    const dailyRows = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => parseViDate(b.date) - parseViDate(a.date))
      .slice(0, 7);
    const dailyMax = dailyRows.reduce((max, row) => Math.max(max, row.count), 1);

    const authorMap: Record<string, number> = {};
    comments.forEach((row) => {
      const name = row.author_name || 'Ẩn danh';
      authorMap[name] = (authorMap[name] || 0) + 1;
    });
    const topAuthors = Object.entries(authorMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const authorMax = topAuthors.reduce((max, row) => Math.max(max, row.count), 1);

    return {
      withPhone,
      hotCount,
      processRate,
      leadRate,
      channelRows,
      tagRows,
      dailyRows,
      dailyMax,
      topAuthors,
      authorMax,
      workflow: workflowCounts,
    };
  }, [comments, customers, channelCounts, tagCounts, tagOptions, workflowCounts, tagsForRow]);

  const syncLead = async (row?: StoredPostComment | null) => {
    const body = row?.post_id ? { source: row.source || '', post_id: row.post_id } : {};
    setStatus('Đang đưa SĐT/comment tiềm năng vào bảng Lead...');
    try {
      const r = await api('/api/leads/from-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      setStatus(data.ok ? `✅ Đã đồng bộ ${data.count || 0} lead vào bảng Lead` : `❌ ${data.error || 'Không đồng bộ được lead'}`);
    } catch {
      setStatus('❌ Lỗi kết nối khi đồng bộ lead');
    }
  };

  const slashMatch = replyText.match(/(^|\s)\/([^\s/]*)$/);
  const slashQuery = normalizeText(slashMatch?.[2] || '');
  const templateSuggestions = useMemo(() => {
    if (!slashMatch) return [];
    return templates
      .filter((item) => !slashQuery || normalizeText(item.trigger).includes(slashQuery) || normalizeText(item.title).includes(slashQuery))
      .slice(0, 8);
  }, [slashMatch, slashQuery, templates]);

  const insertTemplate = (template: ReplyTemplate) => {
    setReplyText((current) => {
      const match = current.match(/(^|\s)\/([^\s/]*)$/);
      if (!match || match.index === undefined) return template.text;
      const prefix = current.slice(0, match.index) + match[1];
      return `${prefix}${template.text}`.trimStart();
    });
    setReplyStatus(`Đã chèn /${template.trigger}`);
  };

  const copyTemplate = async (template: ReplyTemplate) => {
    try {
      await navigator.clipboard.writeText(template.text);
      setStatus(`✅ Đã sao chép mẫu /${template.trigger}`);
    } catch {
      setStatus('❌ Không sao chép được. Hãy thử lại.');
    }
  };

  const createTemplate = async () => {
    if (!templateForm.title.trim() || !templateForm.text.trim()) {
      setStatus('Nhập tên và nội dung mẫu câu trước');
      return;
    }
    try {
      const r = await api('/api/comment-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateForm),
      });
      const data = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (data.ok) {
        setTemplates(templateRows(data.templates));
        setTemplateForm({ title: '', trigger: '', text: '' });
        setStatus('✅ Đã thêm mẫu câu mới');
      } else {
        setStatus(`❌ ${data.error || 'Không thêm được mẫu câu'}`);
      }
    } catch {
      setStatus('❌ Lỗi kết nối khi thêm mẫu câu');
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const r = await api(`/api/comment-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (data.ok) {
        setTemplates(templateRows(data.templates));
        setStatus('Đã xoá mẫu câu');
      } else {
        setStatus(`❌ ${data.error || 'Không xoá được mẫu câu'}`);
      }
    } catch {
      setStatus('❌ Lỗi kết nối khi xoá mẫu câu');
    }
  };

  const createTag = async () => {
    const label = newTagLabel.trim();
    if (!label) return;
    try {
      const r = await api('/api/comment-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, icon: '🏷️', color: 'blue' }),
      });
      const data = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (data.ok) {
        setTagOptions(tagRows(data.tags));
        setNewTagLabel('');
        setStatus('✅ Đã thêm tag mới');
      } else {
        setStatus(`❌ ${data.error || 'Không thêm được tag'}`);
      }
    } catch {
      setStatus('❌ Lỗi kết nối khi thêm tag');
    }
  };

  const toggleManualTag = async (row: StoredPostComment, tagKey: string) => {
    const key = commentKey(row);
    const current = manualTagsByComment[key] || row.manual_tags || [];
    const next = current.includes(tagKey) ? current.filter((item) => item !== tagKey) : [...current, tagKey];
    setManualTagsByComment((state) => ({ ...state, [key]: next }));
    try {
      await api('/api/post-comments/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_id: row.comment_id, tags: next }),
      });
    } catch {
      // localStorage vẫn giữ tag để sale lọc trong phiên web hiện tại.
    }
    setStatus(next.includes(tagKey) ? '✅ Đã gắn tag cho comment' : 'Đã bỏ tag khỏi comment');
  };

  const markProcessed = useCallback((row: StoredPostComment) => {
    const key = commentKey(row);
    const wid = workflowId(row);
    setProcessedIds((current) => Array.from(new Set([...current, wid, key])));
    setComments((current) => current.map((item) => (commentKey(item) === key ? { ...item, processed: true } : item)));
    void persistWorkflow(row, { processed: true });
  }, []);

  const toggleWorkflow = (row: StoredPostComment, type: 'processed' | 'starred') => {
    const key = commentKey(row);
    const wid = workflowId(row);
    if (type === 'processed') {
      const next = !isRowProcessed(row, processedSet);
      setProcessedIds((current) => (next ? Array.from(new Set([...current, wid, key])) : current.filter((item) => item !== wid && item !== key)));
      setComments((current) => current.map((item) => (commentKey(item) === key ? { ...item, processed: next } : item)));
      void persistWorkflow(row, { processed: next });
      setStatus(next ? '✅ Đã đánh dấu comment đã xử lý' : 'Đã chuyển comment về trạng thái chưa xử lý');
      return;
    }
    const next = !isRowStarred(row, starredSet);
    setStarredIds((current) => (next ? Array.from(new Set([...current, wid, key])) : current.filter((item) => item !== wid && item !== key)));
    setComments((current) => current.map((item) => (commentKey(item) === key ? { ...item, starred: next } : item)));
    void persistWorkflow(row, { starred: next });
    if (next) {
      const tags = manualTagsByComment[key] || row.manual_tags || [];
      if (!tags.includes('vip')) void toggleManualTag(row, 'vip');
    }
    setStatus(next ? '⭐ Đã ghim/VIP comment để ưu tiên xử lý' : 'Đã bỏ ghim/VIP comment');
  };

  function requestTiktokExtensionComment(payload: Record<string, unknown>): Promise<TikTokBridgeResult> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: 'Chỉ gửi được TikTok trên Chrome có cài extension' });
        return;
      }

      const requestId = `comment_inbox_tiktok_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({ ok: false, error: 'Không thấy extension phản hồi. Hãy cài/bật Lead Hunter Bridge rồi tải lại trang.' });
      }, 120000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== 'streal-tiktok-extension') return;
        if (data.type !== 'STREAL_TIKTOK_COMMENT_RESPONSE') return;
        if (data.requestId !== requestId) return;
        cleanup();
        resolve(data as TikTokBridgeResult);
      };

      function cleanup() {
        window.removeEventListener('message', handleMessage);
        window.clearTimeout(timer);
      }

      window.addEventListener('message', handleMessage);
      window.postMessage(
        {
          source: 'streal-web-page',
          type: 'STREAL_TIKTOK_COMMENT_REQUEST',
          requestId,
          payload,
        },
        window.location.origin,
      );
    });
  }

  function requestTiktokOpenComment(payload: Record<string, unknown>): Promise<TikTokOpenCommentResult> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: 'Chỉ mở được comment TikTok trên Chrome có cài extension' });
        return;
      }

      const requestId = `comment_inbox_tiktok_open_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({
          ok: false,
          error: 'Không thấy extension phản hồi khi mở comment. Hãy cập nhật Lead Hunter Bridge rồi tải lại trang.',
        });
      }, 120000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== 'streal-tiktok-extension') return;
        if (data.type !== 'STREAL_TIKTOK_OPEN_COMMENT_RESPONSE') return;
        if (data.requestId !== requestId) return;
        cleanup();
        resolve(data as TikTokOpenCommentResult);
      };

      function cleanup() {
        window.removeEventListener('message', handleMessage);
        window.clearTimeout(timer);
      }

      window.addEventListener('message', handleMessage);
      window.postMessage(
        {
          source: 'streal-web-page',
          type: 'STREAL_TIKTOK_OPEN_COMMENT_REQUEST',
          requestId,
          payload,
        },
        window.location.origin,
      );
    });
  }

  async function recordTiktokExtensionResult(row: StoredPostComment, statusValue: 'success' | 'failed', message: string, result: TikTokBridgeResult) {
    const r = await api('/api/tiktok/comment/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: statusValue,
        post_id: row.post_id,
        post_url: row.post_url || row.comment_url || result.url,
        video_title: row.video_title,
        channel_name: row.channel_name,
        message,
        comment_id: result.comment_id || result.cid || result.id,
        error: result.error,
        extension_result: result,
      }),
    });
    return r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
  }

  async function requestTiktokPlaywrightComment(row: StoredPostComment, message: string): Promise<TikTokBridgeResult> {
    try {
      const r = await api('/api/tiktok/comment/playwright', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: row.post_id || '',
          post_url: row.post_url || row.comment_url || '',
          comment_url: row.comment_url || '',
          comment_id: row.comment_id || '',
          comment_text: row.message || '',
          author_name: row.author_name || '',
          channel_name: row.channel_name || '',
          video_title: row.video_title || '',
          message,
        }),
      });
      return r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
    } catch {
      return { ok: false, error: 'Không kết nối được Playwright backend' };
    }
  }

  async function prepareManualTikTokReply(row: StoredPostComment, message: string, fallbackReason = '') {
    const targetUrl = row.comment_url || row.post_url || '';
    if (!targetUrl) {
      setReplyStatus('Comment TikTok này chưa có link video để mở.');
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    let openResult: TikTokOpenCommentResult = { ok: false, url: targetUrl };
    if (tiktokBridgeReady) {
      openResult = await requestTiktokOpenComment({
        post_url: row.post_url || targetUrl,
        comment_url: row.comment_url || '',
        post_id: row.post_id || '',
        comment_id: row.comment_id || '',
        comment_text: row.message || '',
        author_name: row.author_name || '',
        channel_name: row.channel_name || '',
        video_title: row.video_title || '',
        reply_text: message,
      });
      if (!openResult.ok) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }
    } else {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
    const result: TikTokBridgeResult = {
      ok: true,
      manual: true,
      method: openResult.ok ? 'manual-copy-open-context' : 'manual-copy-open',
      url: openResult.url || targetUrl,
      comment_id: `manual_${row.comment_id || Date.now()}`,
    };
    await recordTiktokExtensionResult(row, 'success', message, result).catch(() => null);
    markProcessed(row);
    const prefix = fallbackReason ? `TikTok chưa nhận gửi trực tiếp (${fallbackReason}). ` : '';
    if (openResult.ok && openResult.target_found) {
      setReplyStatus(`✅ ${prefix}Đã copy câu trả lời, mở video, tô xanh comment đang hiển thị và ghim bảng xử lý. Dán Ctrl+V rồi gửi thủ công.`);
    } else if (openResult.ok) {
      setReplyStatus(`✅ ${prefix}Đã copy câu trả lời và mở TikTok kèm bảng comment cần xử lý. Không tự cuộn để tránh TikTok nhảy video.`);
    } else {
      setReplyStatus(`✅ ${prefix}Đã copy câu trả lời và mở video TikTok. Nếu chưa thấy comment, dùng Ctrl+F tìm: "${(row.message || '').slice(0, 80)}"${openResult.error ? ` · ${openResult.error}` : ''}`);
    }
  }

  function openDirectMessage(row: StoredPostComment) {
    const src = sourceKey(row);
    const author = (row.author_name || row.author_id || '').trim();
    let url = row.comment_url || row.post_url || '';
    if (src === 'tiktok') {
      url = author
        ? `https://www.tiktok.com/search/user?q=${encodeURIComponent(author)}`
        : (row.post_url || row.comment_url || 'https://www.tiktok.com/messages');
      setReplyStatus('Đã mở TikTok để tìm tài khoản khách. Nếu TikTok chưa mở chat trực tiếp, vào profile khách và bấm Message.');
    } else if (src === 'fb-page' || src === 'fb-group') {
      url = row.comment_url || row.post_url || 'https://www.facebook.com/messages';
      setReplyStatus('Đã mở Facebook theo comment/bài viết để nhắn khách thủ công nếu cần.');
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function sendDirectTikTokReply(row: StoredPostComment, message: string) {
    if (!tiktokBridgeReady) {
      return { ok: false, error: 'Chưa thấy extension Lead Hunter Bridge' } as TikTokBridgeResult;
    }

    const result = await requestTiktokExtensionComment({
      post_url: row.post_url || row.comment_url || '',
      comment_url: row.comment_url || '',
      post_id: row.post_id || '',
      comment_id: row.comment_id || '',
      comment_text: row.message || '',
      author_name: row.author_name || '',
      channel_name: row.channel_name || '',
      video_title: row.video_title || '',
      message,
    });
    return result;
  }

  const sendReply = async () => {
    if (!selected) {
      setReplyStatus('Chọn bình luận trước khi trả lời');
      return;
    }
    const message = replyText.trim();
    if (!message) {
      setReplyStatus('Nhập nội dung trả lời');
      return;
    }

    const src = sourceKey(selected);
    setReplyBusy(true);
    setReplyStatus(src === 'tiktok' ? 'Đang thử gửi TikTok bằng Playwright backend...' : 'Đang gửi trả lời...');
    try {
      if (src === 'tiktok') {
        const playwrightResult = await requestTiktokPlaywrightComment(selected, message);
        if (playwrightResult.ok) {
          markProcessed(selected);
          setReplyText('');
          setReplyStatus(`✅ Đã gửi comment TikTok bằng Playwright browser${playwrightResult.warning ? ` · ${playwrightResult.warning}` : ''}`);
          await loadComments();
          return;
        }

        setReplyStatus(`Playwright chưa gửi được (${playwrightResult.error || 'không rõ lỗi'}). Đang thử Chrome extension...`);
        const directResult = await sendDirectTikTokReply(selected, message);
        if (directResult.ok) {
          await recordTiktokExtensionResult(selected, 'success', message, directResult).catch(() => null);
          markProcessed(selected);
          setReplyText('');
          setReplyStatus('✅ Đã gửi comment TikTok trực tiếp từ UI qua Chrome extension và lưu lịch sử.');
          await loadComments();
          return;
        }

        await recordTiktokExtensionResult(selected, 'failed', message, directResult).catch(() => null);
        await prepareManualTikTokReply(selected, message, directResult.error || 'TikTok chặn phiên gửi tự động');
        setReplyText('');
        await loadComments();
        return;
      }

      if (src === 'instagram') {
        setReplyStatus('Instagram chưa hỗ trợ trả lời comment trong bản này');
        return;
      }

      const r = await api('/api/post-comments/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: selected.source,
          post_id: selected.post_id,
          group_id: selected.group_id,
          post_url: selected.post_url || selected.comment_url,
          comment_id: selected.comment_id,
          depth: selected.depth || 0,
          message,
        }),
      });
      const data = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (data.ok) {
        setReplyText('');
        setReplyStatus(data.warning ? `✅ Đã trả lời Facebook, nhưng ${data.warning}` : '✅ Đã trả lời comment Facebook và lưu lịch sử');
        await loadComments();
      } else {
        setReplyStatus(`❌ ${data.error || 'Không gửi được trả lời'}`);
      }
    } catch {
      setReplyStatus('❌ Lỗi kết nối khi gửi trả lời');
    } finally {
      setReplyBusy(false);
    }
  };

  const exportCustomers = () => {
    const rows = [['Tên', 'Kênh', 'SĐT', 'Nội dung', 'Link']];
    customers.forEach(({ row, phones }) => {
      rows.push([row.author_name || 'Ẩn danh', sourceLabel(row).label, phones.join(', '), row.message || '', row.comment_url || row.post_url || '']);
    });
    const csv = rows.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `comment_leads_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.csv`;
    link.click();
    setStatus('✅ Đã xuất danh sách lead comment');
  };

  const selectedMeta = selected ? sourceLabel(selected) : null;
  const selectedSrc = selected ? sourceKey(selected) : null;

  return (
    <section className="omni-inbox module-panel">
      <header className="omni-topbar">
        <div className="omni-topbar-left">
          <span className="omni-brand">OmniInbox</span>
          <nav className="omni-nav">
            <button type="button" className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>Inbox</button>
            <button type="button" className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>Khách hàng</button>
            <button type="button" className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>Thống kê</button>
            <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Mẫu câu</button>
          </nav>
        </div>
        <div className="omni-topbar-right">
          <div className="omni-search">
            <MaterialIcon name="search" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm lead, SĐT, nội dung..." type="text" />
          </div>
          <button type="button" className="omni-btn-ghost" onClick={() => void reloadInbox()} disabled={busy}>
            {busy ? 'Đang tải...' : 'Tải lại'}
          </button>
          <button type="button" className="omni-btn-primary" onClick={() => void syncLead(selected)}>Tách lead</button>
        </div>
      </header>

      {tab === 'inbox' ? (
        <div className="omni-body">
          <aside className="omni-sidebar">
            <div className="omni-sidebar-head">
              <p>OmniChannel</p>
              <p>Bộ lọc đang dùng</p>
            </div>
            <div className="omni-sidebar-scroll">
              <p className="omni-section-label">Kênh</p>
              {CHANNEL_FILTERS.map((channel) => (
                <button
                  key={channel.key}
                  type="button"
                  className={`omni-filter-btn ${sourceFilter === channel.key ? 'active' : ''}`}
                  onClick={() => setSourceFilter(channel.key)}
                >
                  <MaterialIcon name={channel.materialIcon} />
                  <span>{channel.label}</span>
                  <b>{channelCounts[channel.key]}</b>
                </button>
              ))}

              <p className="omni-section-label" style={{ marginTop: 24 }}>Tags</p>
              {tagOptions.map((tag) => {
                const meta = tagMaterialIcon(tag.key);
                return (
                  <button
                    key={tag.key}
                    type="button"
                    className={`omni-filter-btn ${tagFilter === tag.key ? 'active' : ''}`}
                    onClick={() => setTagFilter((current) => (current === tag.key ? '' : tag.key))}
                  >
                    <MaterialIcon name={meta.icon} filled={meta.filled} style={{ color: meta.color, fontSize: 16 }} />
                    <span>{tag.label}</span>
                    <b>{tagCounts[tag.key] || 0}</b>
                  </button>
                );
              })}
            </div>
            <div className="omni-sidebar-foot">
              <div className="omni-add-filter">
                <MaterialIcon name="add_circle" style={{ fontSize: 16 }} />
                <input value={newTagLabel} onChange={(e) => setNewTagLabel(e.target.value)} placeholder="Thêm tag mới" onKeyDown={(e) => { if (e.key === 'Enter') void createTag(); }} />
                <button type="button" onClick={() => void createTag()} aria-label="Thêm tag">+</button>
              </div>
              <div className="omni-workflow-icons">
                <button type="button" className={workflowFilter === 'open' ? 'active' : ''} title="Chưa xử lý" onClick={() => setWorkflowFilter((c) => (c === 'open' ? 'all' : 'open'))}>
                  <MaterialIcon name="pending_actions" />
                </button>
                <button type="button" className={workflowFilter === 'starred' ? 'active' : ''} title="VIP" onClick={() => setWorkflowFilter((c) => (c === 'starred' ? 'all' : 'starred'))}>
                  <MaterialIcon name="stars" />
                </button>
                <button type="button" className={workflowFilter === 'done' ? 'active' : ''} title="Đã xử lý" onClick={() => setWorkflowFilter((c) => (c === 'done' ? 'all' : 'done'))}>
                  <MaterialIcon name="done_all" />
                </button>
              </div>
            </div>
          </aside>

          <div className="omni-main">
            <section className="omni-stream">
              <div className="omni-stream-head">
                <div className="omni-stream-head-top">
                  <h2>Inbox Stream</h2>
                  <span className="omni-unread-badge">{workflowCounts.open} chưa xử lý</span>
                </div>
                <div className="omni-pills">
                  <button type="button" className={!tagFilter && workflowFilter === 'all' ? 'active' : ''} onClick={() => { setTagFilter(''); setWorkflowFilter('all'); }}>Tất cả</button>
                  <button type="button" className={workflowFilter === 'open' ? 'active' : ''} onClick={() => setWorkflowFilter((c) => (c === 'open' ? 'all' : 'open'))}>Chưa xử lý</button>
                  <button type="button" className={workflowFilter === 'starred' ? 'active' : ''} onClick={() => setWorkflowFilter((c) => (c === 'starred' ? 'all' : 'starred'))}>VIP</button>
                </div>
              </div>
              <div className="omni-stream-list">
                {filtered.length ? filtered.map((row) => {
                  const meta = sourceLabel(row);
                  const tags = tagsForRow(row);
                  const key = commentKey(row);
                  const isProcessed = isRowProcessed(row, processedSet);
                  const isStarred = isRowStarred(row, starredSet);
                  const hotTag = tags.find((t) => t.key === 'hot');
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`omni-stream-item ${selected && commentKey(selected) === key ? 'active' : ''}`}
                      onClick={() => setSelectedId(key)}
                    >
                      <div className="omni-stream-item-top">
                        <CommentAuthorLink row={row} className="omni-author-link" />
                        <small>{commentTimeShort(row)}</small>
                      </div>
                      <span className={`omni-channel-chip ${meta.chipClass}`}>
                        <MaterialIcon name={meta.materialIcon} style={{ fontSize: 10 }} />
                        {meta.label}
                      </span>
                      <p>{commentText(row) || '(Không có nội dung)'}</p>
                      <div className="omni-stream-item-foot">
                        {isStarred ? (
                          <span className="omni-status-chip vip">VIP</span>
                        ) : hotTag ? (
                          <span className="omni-status-chip hot">{hotTag.label}</span>
                        ) : (
                          <span className={`omni-status-chip ${isProcessed ? 'done' : 'open'}`}>{isProcessed ? 'Đã xử lý' : 'Chưa xử lý'}</span>
                        )}
                        <span
                          role="button"
                          tabIndex={0}
                          className="omni-dm-link"
                          onClick={(event) => { event.stopPropagation(); openDirectMessage(row); }}
                          onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); openDirectMessage(row); } }}
                        >
                          <MaterialIcon name="chat_bubble" style={{ fontSize: 14 }} />
                          Nhắn tin
                        </span>
                      </div>
                    </button>
                  );
                }) : (
                  <div className="omni-empty">Chưa có bình luận phù hợp bộ lọc.</div>
                )}
              </div>
            </section>

            <section className="omni-thread">
              {selected && selectedMeta ? (
                <>
                  <header className="omni-thread-head">
                    <div className="omni-thread-user">
                      <div className="omni-avatar">{authorInitials(selected.author_name)}</div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                          <CommentAuthorHeading row={selected} />
                          <span className="omni-thread-channel">
                            <MaterialIcon name={selectedMeta.materialIcon} style={{ fontSize: 12 }} />
                            {selectedMeta.label}
                          </span>
                        </div>
                        <p>{channelName(selected)}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="omni-btn-ghost" style={{ padding: 8, borderRadius: 999 }} onClick={() => void loadComments()} title="Tải lại">
                        <MaterialIcon name="history" />
                      </button>
                    </div>
                  </header>

                  <div className="omni-thread-scroll">
                    <div className="omni-message-card">
                      <p className="omni-message-text">{selected.message || '(Không có nội dung)'}</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                        <span className={`omni-status-chip ${isRowProcessed(selected, processedSet) ? 'done' : 'open'}`}>
                          {isRowProcessed(selected, processedSet) ? 'ĐÃ XỬ LÝ' : 'CHƯA XỬ LÝ'}
                        </span>
                        {isRowStarred(selected, starredSet) ? <span className="omni-status-chip vip">VIP</span> : null}
                      </div>

                      <div className="omni-tag-row">
                        {tagOptions.map((tag) => {
                          const meta = tagMaterialIcon(tag.key);
                          const active = (manualTagsByComment[commentKey(selected)] || selected.manual_tags || []).includes(tag.key);
                          return (
                            <button
                              key={tag.key}
                              type="button"
                              className={`omni-tag-pill ${active ? 'active' : ''}`}
                              onClick={() => void toggleManualTag(selected, tag.key)}
                            >
                              <MaterialIcon name={meta.icon} filled={meta.filled} style={{ fontSize: 14, color: meta.color }} />
                              {tag.label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="omni-meta-grid">
                        <div><span>Post ID</span><b className="mono">{selected.post_id || '-'}</b></div>
                        <div><span>Comment ID</span><b className="mono">{selected.comment_id || '-'}</b></div>
                        <div><span>SĐT</span><b>{(selected.phones || (selected.phone ? [selected.phone] : [])).join(', ') || '-- Chưa có --'}</b></div>
                        <div><span>Thời gian</span><b>{commentTime(selected)}</b></div>
                      </div>

                      <div className="omni-action-row">
                        {(selected.comment_url || selected.post_url) ? (
                          <a className="omni-btn-ghost" href={selected.comment_url || selected.post_url} target="_blank" rel="noreferrer" style={{ textAlign: 'center', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Mở link</a>
                        ) : (
                          <button type="button" className="omni-btn-ghost" disabled>Mở link</button>
                        )}
                        <button type="button" className="omni-btn-primary" onClick={() => void syncLead(selected)}>Đưa vào Lead</button>
                        <button type="button" className="omni-btn-ghost" onClick={() => toggleWorkflow(selected, 'processed')}>
                          {isRowProcessed(selected, processedSet) ? 'Bỏ xử lý' : 'Đã xử lý'}
                        </button>
                        <button type="button" className="omni-btn-ghost" onClick={() => toggleWorkflow(selected, 'starred')}>
                          <MaterialIcon name="stars" filled style={{ fontSize: 16, color: '#9333ea' }} />
                          {isRowStarred(selected, starredSet) ? 'Bỏ VIP' : 'Ghim VIP'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <footer className="omni-composer">
                    <div className="omni-composer-inner">
                      <div className="omni-quick-replies">
                        <label>Trả lời nhanh</label>
                        {templates.slice(0, 6).map((item) => (
                          <button key={item.id} type="button" onClick={() => insertTemplate(item)}>/{item.trigger || item.title}</button>
                        ))}
                      </div>
                      <div className="omni-textarea-wrap">
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Nhập tin nhắn hoặc gõ / để chèn mẫu câu..."
                        />
                        {templateSuggestions.length ? (
                          <div className="omni-slash-menu">
                            {templateSuggestions.map((item) => (
                              <button key={item.id} type="button" onClick={() => insertTemplate(item)}>
                                <b>/{item.trigger}</b>
                                <span>{item.title}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="omni-composer-foot">
                        <p>
                          {selectedSrc === 'tiktok'
                            ? (tiktokBridgeReady ? 'Gửi qua TikTok extension hoặc Playwright' : 'Cần Chrome extension để gửi TikTok tự động')
                            : 'Trả lời trực tiếp vào comment Facebook'}
                          {replyStatus ? ` · ${replyStatus}` : ''}
                        </p>
                        <button type="button" className="omni-send-btn" disabled={replyBusy || !replyText.trim()} onClick={() => void sendReply()}>
                          {replyBusy ? 'Đang gửi...' : selectedSrc === 'tiktok' ? 'Gửi TikTok Reply' : 'Gửi trả lời'}
                          <MaterialIcon name="send" style={{ fontSize: 18 }} />
                        </button>
                      </div>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="omni-empty">
                  <MaterialIcon name="forum" style={{ fontSize: 48, marginBottom: 12 }} />
                  <div>Chọn bình luận để xem chi tiết</div>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {tab === 'customers' ? (
        <div className="omni-tab-panel">
          <div className="omni-topbar-right" style={{ marginBottom: 16 }}>
            <div className="omni-search" style={{ display: 'block' }}>
              <MaterialIcon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm khách hàng, SĐT..." type="text" />
            </div>
            <button type="button" className="omni-btn-ghost" onClick={exportCustomers}>Xuất CSV</button>
            <button type="button" className="omni-btn-primary" onClick={() => void syncLead(null)}>Đồng bộ Lead</button>
          </div>
          <div className="omni-table-wrap">
            <table className="omni-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Kênh</th>
                  <th>SĐT</th>
                  <th>Tags</th>
                  <th>Nội dung</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {customers.length ? customers.map(({ row, tags, phones }) => (
                  <tr key={row.comment_id || `${row.post_id}-${row.author_name}`}>
                    <td><CommentAuthorLink row={row} /><br /><small>{channelName(row)}</small></td>
                    <td>{sourceLabel(row).label}</td>
                    <td>{phones.join(', ') || '-'}</td>
                    <td>{tags.map((tag) => tag.label).join(', ') || '-'}</td>
                    <td>{row.message || '-'}</td>
                    <td>{(row.comment_url || row.post_url) ? <a href={row.comment_url || row.post_url} target="_blank" rel="noreferrer">Mở</a> : '-'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="omni-empty">Chưa có khách hàng/lead từ comment.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'stats' ? (
        <div className="omni-tab-panel omni-stats-page">
          <div className="omni-stats-hero">
            <div>
              <p className="omni-stats-kicker">Báo cáo Inbox</p>
              <h2>Thống kê đa kênh</h2>
              <p>Tổng hợp comment Facebook, TikTok và tín hiệu lead từ dữ liệu thật đang lưu trong hệ thống.</p>
            </div>
            <button type="button" className="omni-btn-ghost" onClick={() => void reloadInbox()} disabled={busy}>
              <MaterialIcon name="refresh" style={{ fontSize: 18 }} />
              {busy ? 'Đang tải...' : 'Làm mới'}
            </button>
          </div>

          <div className="omni-stats-kpi-grid">
            <div className="omni-stat-card omni-stat-primary">
              <MaterialIcon name="forum" />
              <b>{comments.length}</b>
              <span>Tổng comment</span>
            </div>
            <div className="omni-stat-card omni-stat-warn">
              <MaterialIcon name="pending_actions" />
              <b>{statsDashboard.workflow.open}</b>
              <span>Chưa xử lý</span>
            </div>
            <div className="omni-stat-card omni-stat-success">
              <MaterialIcon name="done_all" />
              <b>{statsDashboard.workflow.done}</b>
              <span>Đã xử lý ({statsDashboard.processRate}%)</span>
            </div>
            <div className="omni-stat-card omni-stat-vip">
              <MaterialIcon name="stars" filled />
              <b>{statsDashboard.workflow.starred}</b>
              <span>Ghim VIP</span>
            </div>
            <div className="omni-stat-card">
              <MaterialIcon name="person_search" />
              <b>{customers.length}</b>
              <span>Lead tiềm năng ({statsDashboard.leadRate}%)</span>
            </div>
            <div className="omni-stat-card omni-stat-hot">
              <MaterialIcon name="local_fire_department" filled />
              <b>{statsDashboard.hotCount}</b>
              <span>Comment nóng</span>
            </div>
            <div className="omni-stat-card">
              <MaterialIcon name="call" />
              <b>{statsDashboard.withPhone}</b>
              <span>Có SĐT</span>
            </div>
          </div>

          <div className="omni-stats-columns">
            <section className="omni-stats-panel">
              <div className="omni-stats-panel-head">
                <h3>Phân bổ kênh</h3>
                <span>{comments.length} comment</span>
              </div>
              {statsDashboard.channelRows.length ? statsDashboard.channelRows.map((channel) => (
                <div key={channel.key} className="omni-bar-row">
                  <div className="omni-bar-label">
                    <MaterialIcon name={channel.materialIcon} style={{ fontSize: 16 }} />
                    <span>{channel.label}</span>
                    <b>{channel.count}</b>
                  </div>
                  <div className="omni-bar-track">
                    <div className="omni-bar-fill" style={{ width: `${channel.pct}%` }} />
                  </div>
                  <small>{channel.pct}%</small>
                </div>
              )) : (
                <div className="omni-empty">Chưa có dữ liệu kênh.</div>
              )}
            </section>

            <section className="omni-stats-panel">
              <div className="omni-stats-panel-head">
                <h3>Trạng thái xử lý</h3>
                <span>{statsDashboard.processRate}% hoàn thành</span>
              </div>
              <div
                className="omni-workflow-ring"
                style={{ background: `conic-gradient(#059669 0 ${statsDashboard.processRate}%, #fef3c7 ${statsDashboard.processRate}% 100%)` }}
              >
                <div className="omni-workflow-ring-center">
                  <b>{statsDashboard.processRate}%</b>
                  <small>đã xử lý</small>
                </div>
              </div>
              <div className="omni-workflow-legend">
                <div><i className="dot open" /> Chưa xử lý <b>{statsDashboard.workflow.open}</b></div>
                <div><i className="dot done" /> Đã xử lý <b>{statsDashboard.workflow.done}</b></div>
                <div><i className="dot vip" /> VIP <b>{statsDashboard.workflow.starred}</b></div>
              </div>
            </section>
          </div>

          <div className="omni-stats-columns">
            <section className="omni-stats-panel">
              <div className="omni-stats-panel-head">
                <h3>Tags phổ biến</h3>
                <span>{tagOptions.length} tag</span>
              </div>
              {statsDashboard.tagRows.filter((row) => row.count > 0).length ? statsDashboard.tagRows.filter((row) => row.count > 0).map(({ tag, count, pct, meta }) => (
                <div key={tag.key} className="omni-bar-row">
                  <div className="omni-bar-label">
                    <MaterialIcon name={meta.icon} filled={meta.filled} style={{ fontSize: 16, color: meta.color }} />
                    <span>{tag.label}</span>
                    <b>{count}</b>
                  </div>
                  <div className="omni-bar-track">
                    <div className="omni-bar-fill tag" style={{ width: `${pct}%` }} />
                  </div>
                  <small>{pct}%</small>
                </div>
              )) : (
                <div className="omni-empty">Chưa có tag nào được gắn.</div>
              )}
            </section>

            <section className="omni-stats-panel">
              <div className="omni-stats-panel-head">
                <h3>7 ngày gần nhất</h3>
                <span>Theo ngày comment</span>
              </div>
              {statsDashboard.dailyRows.length ? statsDashboard.dailyRows.map((row) => (
                <div key={row.date} className="omni-bar-row">
                  <div className="omni-bar-label">
                    <MaterialIcon name="calendar_today" style={{ fontSize: 16 }} />
                    <span>{row.date}</span>
                    <b>{row.count}</b>
                  </div>
                  <div className="omni-bar-track">
                    <div
                      className="omni-bar-fill daily"
                      style={{ width: `${Math.round((row.count / statsDashboard.dailyMax) * 100)}%` }}
                    />
                  </div>
                </div>
              )) : (
                <div className="omni-empty">Chưa có dữ liệu theo ngày.</div>
              )}
            </section>
          </div>

          <section className="omni-stats-panel omni-stats-wide">
            <div className="omni-stats-panel-head">
              <h3>Top khách hàng comment nhiều nhất</h3>
              <span>Top 5</span>
            </div>
            {statsDashboard.topAuthors.length ? (
              <div className="omni-top-authors">
                {statsDashboard.topAuthors.map((row, index) => (
                  <div key={row.name} className="omni-top-author-row">
                    <span className="omni-top-rank">#{index + 1}</span>
                    <div className="omni-avatar sm">{authorInitials(row.name)}</div>
                    <div className="omni-top-author-meta">
                      <b>{row.name}</b>
                      <small>{row.count} comment</small>
                    </div>
                    <div className="omni-bar-track compact">
                      <div
                        className="omni-bar-fill"
                        style={{ width: `${Math.round((row.count / statsDashboard.authorMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="omni-empty">Chưa có dữ liệu khách hàng.</div>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'templates' ? (
        <div className="omni-tab-panel">
          <div className="omni-template-editor">
            <input value={templateForm.title} onChange={(e) => setTemplateForm((s) => ({ ...s, title: e.target.value }))} placeholder="Tên mẫu câu" />
            <input value={templateForm.trigger} onChange={(e) => setTemplateForm((s) => ({ ...s, trigger: e.target.value }))} placeholder="Lệnh /, ví dụ baogia" />
            <textarea value={templateForm.text} onChange={(e) => setTemplateForm((s) => ({ ...s, text: e.target.value }))} placeholder="Nội dung trả lời nhanh..." rows={4} />
            <button type="button" className="omni-btn-primary" onClick={() => void createTemplate()}>+ Thêm mẫu câu</button>
          </div>
          <div className="omni-template-grid">
            {templates.map((item) => (
              <div key={item.id} className="omni-template-card">
                <b>{item.title}</b>
                <small>/{item.trigger}</small>
                <p style={{ margin: '12px 0', fontSize: 13, color: 'var(--omni-on-surface-variant)' }}>{item.text}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="omni-btn-ghost" onClick={() => void copyTemplate(item)}>Sao chép</button>
                  {!item.system ? <button type="button" className="omni-btn-ghost" onClick={() => void deleteTemplate(item.id)}>Xoá</button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {status ? <div className="omni-status-bar">{status}</div> : null}
    </section>
  );
}
