'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { StoredPostComment } from '@/lib/types';

type TabKey = 'inbox' | 'customers' | 'stats' | 'templates';
type SourceKey = 'all' | 'fb-page' | 'fb-group' | 'tiktok' | 'instagram';
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

const SOURCE_META: Record<SourceKey, { label: string; icon: string; className: string }> = {
  all: { label: 'Tất cả', icon: '●', className: 'src-all' },
  'fb-page': { label: 'FB Page', icon: '📘', className: 'src-page' },
  'fb-group': { label: 'FB Group', icon: '👥', className: 'src-group' },
  tiktok: { label: 'TikTok', icon: '🎵', className: 'src-tiktok' },
  instagram: { label: 'Instagram', icon: '📷', className: 'src-instagram' },
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
  const [sourceFilter, setSourceFilter] = useState<SourceKey>('all');
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

  const loadComments = async () => {
    setBusy(true);
    setStatus('Đang tải inbox bình luận...');
    try {
      const r = await api('/api/post-comments?limit=1000');
      const data: CommentPayload = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (data.ok) {
        const rows = Array.isArray(data.comments) ? data.comments : [];
        setComments(rows);
        setSelectedId((current) => current || (rows[0] ? commentKey(rows[0]) : ''));
        setStatus(data.warning ? `⚠️ ${data.warning}` : rows.length ? `✅ Đã tải ${rows.length} bình luận thật` : 'Chưa có bình luận. Hãy lấy CMT từ bài Facebook/TikTok trước.');
      } else {
        setStatus(`❌ ${data.error || 'Không tải được bình luận'}`);
      }
    } catch {
      setStatus('❌ Lỗi kết nối khi tải bình luận');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadComments();
    void loadTemplateConfig();
  }, []);

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
      if (sourceFilter !== 'all' && sourceKey(row) !== sourceFilter) return false;
      if (workflowFilter === 'open' && processedSet.has(key)) return false;
      if (workflowFilter === 'done' && !processedSet.has(key)) return false;
      if (workflowFilter === 'starred' && !starredSet.has(key)) return false;
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
      const key = commentKey(row);
      if (processedSet.has(key)) done += 1;
      if (starredSet.has(key)) starred += 1;
    });
    return { all: comments.length, done, open: Math.max(comments.length - done, 0), starred };
  }, [comments, processedSet, starredSet]);

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceKey, number> = { all: comments.length, 'fb-page': 0, 'fb-group': 0, tiktok: 0, instagram: 0 };
    comments.forEach((row) => {
        counts[sourceKey(row)] += 1;
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

  const toggleWorkflow = (row: StoredPostComment, type: 'processed' | 'starred') => {
    const key = commentKey(row);
    if (type === 'processed') {
      setProcessedIds((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
      setStatus(processedSet.has(key) ? 'Đã chuyển comment về trạng thái chưa xử lý' : '✅ Đã đánh dấu comment đã xử lý');
      return;
    }
    setStarredIds((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
    setStatus(starredSet.has(key) ? 'Đã bỏ ghim/VIP comment' : '⭐ Đã ghim/VIP comment để ưu tiên xử lý');
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
    setProcessedIds((current) => (current.includes(commentKey(row)) ? current : [...current, commentKey(row)]));
    const prefix = fallbackReason ? `TikTok chưa nhận gửi trực tiếp (${fallbackReason}). ` : '';
    if (openResult.ok && openResult.target_found) {
      setReplyStatus(`✅ ${prefix}Đã copy câu trả lời, mở video, tô xanh comment đang hiển thị và ghim bảng xử lý. Dán Ctrl+V rồi gửi thủ công.`);
    } else if (openResult.ok) {
      setReplyStatus(`✅ ${prefix}Đã copy câu trả lời và mở TikTok kèm bảng comment cần xử lý. Không tự cuộn để tránh TikTok nhảy video.`);
    } else {
      setReplyStatus(`✅ ${prefix}Đã copy câu trả lời và mở video TikTok. Nếu chưa thấy comment, dùng Ctrl+F tìm: "${(row.message || '').slice(0, 80)}"${openResult.error ? ` · ${openResult.error}` : ''}`);
    }
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
          setProcessedIds((current) => (current.includes(commentKey(selected)) ? current : [...current, commentKey(selected)]));
          setReplyText('');
          setReplyStatus(`✅ Đã gửi comment TikTok bằng Playwright browser${playwrightResult.warning ? ` · ${playwrightResult.warning}` : ''}`);
          await loadComments();
          return;
        }

        setReplyStatus(`Playwright chưa gửi được (${playwrightResult.error || 'không rõ lỗi'}). Đang thử Chrome extension...`);
        const directResult = await sendDirectTikTokReply(selected, message);
        if (directResult.ok) {
          await recordTiktokExtensionResult(selected, 'success', message, directResult).catch(() => null);
          setProcessedIds((current) => (current.includes(commentKey(selected)) ? current : [...current, commentKey(selected)]));
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

  return (
    <section className="comment-studio module-panel">
      <div className="comment-studio-head">
        <div>
          <div className="module-kicker">Bình luận & Lead</div>
          <h2>Inbox đa kênh</h2>
          <p>Gom comment Facebook Page, Facebook Group, TikTok và các lead có SĐT vào một màn hình xử lý.</p>
        </div>
        <div className="module-actions">
          <button type="button" className="btn-cancel" onClick={() => void loadComments()} disabled={busy}>
            {busy ? 'Đang tải...' : 'Tải lại'}
          </button>
          <button type="button" className="btn-submit" onClick={() => void syncLead(selected)}>
            Tách lead
          </button>
        </div>
      </div>

      <div className="comment-tabs">
        <button type="button" className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
          💬 Inbox <span>{filtered.length}</span>
        </button>
        <button type="button" className={tab === 'customers' ? 'active' : ''} onClick={() => setTab('customers')}>
          👤 Khách hàng
        </button>
        <button type="button" className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          📊 Thống kê
        </button>
        <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
          ⚡ Mẫu câu
        </button>
      </div>

      {tab === 'inbox' ? (
        <div className="comment-inbox-layout">
          <aside className="comment-filter-pane">
            <div className="comment-filter-title">Kênh</div>
            {(Object.keys(SOURCE_META) as SourceKey[]).map((key) => (
              <button key={key} type="button" className={`comment-filter-row ${sourceFilter === key ? 'active' : ''}`} onClick={() => setSourceFilter(key)}>
                <span className={`source-dot ${SOURCE_META[key].className}`} />
                <span>{SOURCE_META[key].icon} {SOURCE_META[key].label}</span>
                <b>{sourceCounts[key]}</b>
              </button>
            ))}

            <div className="comment-filter-title tag-title">Tags</div>
            {tagOptions.map((tag) => (
              <button
                key={tag.key}
                type="button"
                className={`comment-filter-row ${tagFilter === tag.key ? 'active' : ''}`}
                onClick={() => setTagFilter((current) => (current === tag.key ? '' : tag.key))}
              >
                <span className={`comment-tag ${tag.className}`}>{tag.icon} {tag.label}</span>
                <b>{tagCounts[tag.key]}</b>
                </button>
              ))}
            <div className="comment-add-tag">
              <input value={newTagLabel} onChange={(e) => setNewTagLabel(e.target.value)} placeholder="+ Tag mới" />
              <button type="button" onClick={() => void createTag()}>+</button>
            </div>
          </aside>

          <div className="comment-list-pane">
            <div className="comment-list-toolbar">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Tìm tên, SĐT, nội dung..." />
              <button
                type="button"
                className={!tagFilter && workflowFilter === 'all' ? 'active' : ''}
                onClick={() => {
                  setTagFilter('');
                  setWorkflowFilter('all');
                }}
              >
                Tất cả
              </button>
              <button type="button" className={workflowFilter === 'open' ? 'active' : ''} onClick={() => setWorkflowFilter((current) => (current === 'open' ? 'all' : 'open'))}>
                Chưa xử lý {workflowCounts.open}
              </button>
              <button type="button" className={workflowFilter === 'done' ? 'active' : ''} onClick={() => setWorkflowFilter((current) => (current === 'done' ? 'all' : 'done'))}>
                Đã xử lý {workflowCounts.done}
              </button>
              <button type="button" className={workflowFilter === 'starred' ? 'active' : ''} onClick={() => setWorkflowFilter((current) => (current === 'starred' ? 'all' : 'starred'))}>
                ⭐ {workflowCounts.starred}
              </button>
            </div>

            <div className="comment-list">
              {filtered.length ? filtered.map((row) => {
                const meta = sourceLabel(row);
                const tags = tagsForRow(row);
                const key = commentKey(row);
                const isProcessed = processedSet.has(key);
                const isStarred = starredSet.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`comment-card ${selected && commentKey(selected) === key ? 'active' : ''} ${isProcessed ? 'processed' : ''}`}
                    onClick={() => setSelectedId(key)}
                  >
                    <div className="comment-avatar">{(row.author_name || '?').trim().charAt(0).toUpperCase()}</div>
                    <div className="comment-card-body">
                      <div className="comment-card-top">
                        <b>{row.author_name || 'Ẩn danh'}</b>
                        <small>{commentTime(row)}</small>
                      </div>
                      <span className={`source-pill ${meta.className}`}>{meta.icon} {meta.label}</span>
                      <p>{commentText(row) || '(Không có nội dung chữ)'}</p>
                      <div className="comment-tags">
                        {isStarred ? <span className="comment-state-pill starred">⭐ VIP</span> : null}
                        <span className={`comment-state-pill ${isProcessed ? 'done' : 'open'}`}>{isProcessed ? 'Đã xử lý' : 'Chưa xử lý'}</span>
                        {tags.map((tag) => <span key={tag.key} className={`comment-tag ${tag.className}`}>{tag.icon} {tag.label}</span>)}
                      </div>
                    </div>
                  </button>
                );
              }) : (
                <div className="comment-empty">Chưa có bình luận phù hợp bộ lọc.</div>
              )}
            </div>
          </div>

          <div className="comment-detail-pane">
            {selected ? (
              <>
                <div className="comment-detail-title">
                  <div>
                    <b>{selected.author_name || 'Ẩn danh'}</b>
                    <small>{channelName(selected)}</small>
                  </div>
                  <span className={`source-pill ${sourceLabel(selected).className}`}>{sourceLabel(selected).icon} {sourceLabel(selected).label}</span>
                </div>
                <div className="comment-detail-message">{selected.message || '(Không có nội dung chữ)'}</div>
                <div className="comment-detail-tags">
                  {starredSet.has(commentKey(selected)) ? <span className="comment-state-pill starred">⭐ VIP</span> : null}
                  <span className={`comment-state-pill ${processedSet.has(commentKey(selected)) ? 'done' : 'open'}`}>
                    {processedSet.has(commentKey(selected)) ? 'Đã xử lý' : 'Chưa xử lý'}
                  </span>
                  {tagsForRow(selected).map((tag) => <span key={tag.key} className={`comment-tag ${tag.className}`}>{tag.icon} {tag.label}</span>)}
                </div>
                <div className="comment-manual-tags">
                  {tagOptions.map((tag) => {
                    const active = (manualTagsByComment[commentKey(selected)] || selected.manual_tags || []).includes(tag.key);
                    return (
                      <button
                        key={tag.key}
                        type="button"
                        className={active ? 'active' : ''}
                        onClick={() => void toggleManualTag(selected, tag.key)}
                      >
                        {tag.icon} {tag.label}
                      </button>
                    );
                  })}
                </div>
                <div className="comment-detail-grid">
                  <span>Bài viết</span><b className="mono-cell">{selected.post_id || '-'}</b>
                  <span>Comment ID</span><b className="mono-cell">{selected.comment_id || '-'}</b>
                  <span>SĐT</span><b>{(selected.phones || (selected.phone ? [selected.phone] : [])).join(', ') || '-'}</b>
                  <span>Thời gian</span><b>{commentTime(selected)}</b>
                </div>
                <div className="comment-detail-actions">
                  {(selected.comment_url || selected.post_url) ? <a className="btn-cancel" href={selected.comment_url || selected.post_url} target="_blank" rel="noreferrer">Mở link</a> : null}
                  <button type="button" className="btn-submit" onClick={() => void syncLead(selected)}>Đưa vào Lead</button>
                  <button type="button" className="btn-cancel" onClick={() => toggleWorkflow(selected, 'processed')}>
                    {processedSet.has(commentKey(selected)) ? 'Bỏ xử lý' : 'Đã xử lý'}
                  </button>
                  <button type="button" className="btn-cancel" onClick={() => toggleWorkflow(selected, 'starred')}>
                    {starredSet.has(commentKey(selected)) ? 'Bỏ VIP' : 'Ghim VIP'}
                  </button>
                </div>
                <div className="reply-box">
                  <label>Trả lời comment ngay tại đây</label>
                  {sourceKey(selected) === 'tiktok' ? (
                    <div className="reply-hint">
                      Hệ thống sẽ thử gửi trực tiếp qua Chrome extension đang đăng nhập TikTok. Nếu TikTok chặn phiên tự động, web sẽ tự copy câu trả lời và mở video để sale gửi thủ công.
                    </div>
                  ) : (
                    <div className="reply-hint">Facebook sẽ reply trực tiếp vào Comment ID đang chọn.</div>
                  )}
                  <div className="reply-template-row">
                    {templates.slice(0, 6).map((item) => (
                      <button key={item.id} type="button" onClick={() => insertTemplate(item)}>/{item.trigger || item.title}</button>
                    ))}
                  </div>
                  <div className="reply-textarea-wrap">
                    <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Gõ / để chèn mẫu câu, ví dụ /baogia hoặc /diachi..." />
                    {templateSuggestions.length ? (
                      <div className="slash-template-menu">
                        {templateSuggestions.map((item) => (
                          <button key={item.id} type="button" onClick={() => insertTemplate(item)}>
                            <b>/{item.trigger}</b><span>{item.title}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="reply-send-row">
                    <button type="button" className="btn-submit" disabled={replyBusy || !replyText.trim()} onClick={() => void sendReply()}>
                      {replyBusy ? 'Đang gửi...' : sourceKey(selected) === 'tiktok' ? 'Gửi CMT TikTok' : 'Gửi trả lời'}
                    </button>
                    <span>{replyStatus}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="comment-empty detail-empty">💬<br />Chọn bình luận</div>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'customers' ? (
        <div className="comment-tab-panel">
          <div className="table-toolbar">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm khách hàng, SĐT, nội dung..." />
            <button type="button" className="btn-cancel" onClick={exportCustomers}>Xuất CSV</button>
            <button type="button" className="btn-submit" onClick={() => void syncLead(null)}>Đồng bộ Lead</button>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
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
                    <td><b>{row.author_name || 'Ẩn danh'}</b><small>{channelName(row)}</small></td>
                    <td><span className={`source-pill ${sourceLabel(row).className}`}>{sourceLabel(row).icon} {sourceLabel(row).label}</span></td>
                    <td>{phones.join(', ') || '-'}</td>
                    <td><div className="comment-tags">{tags.map((tag) => <span key={tag.key} className={`comment-tag ${tag.className}`}>{tag.icon} {tag.label}</span>)}</div></td>
                    <td>{row.message || '-'}</td>
                    <td>{(row.comment_url || row.post_url) ? <a href={row.comment_url || row.post_url} target="_blank" rel="noreferrer">Mở</a> : '-'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="table-empty">Chưa có khách hàng/lead từ comment.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'stats' ? (
        <div className="comment-tab-panel">
          <div className="comment-stats-grid">
            <div className="comment-stat-card"><b>{comments.length}</b><span>Tổng comment</span></div>
            <div className="comment-stat-card"><b>{customers.length}</b><span>Comment có tín hiệu lead</span></div>
            <div className="comment-stat-card"><b>{customers.filter((item) => item.phones.length).length}</b><span>Có SĐT</span></div>
            <div className="comment-stat-card"><b>{sourceCounts['fb-page'] + sourceCounts['fb-group']}</b><span>Facebook</span></div>
          </div>
          <div className="comment-stats-columns">
            <div>
              <h3>Kênh</h3>
              {(Object.keys(SOURCE_META) as SourceKey[]).filter((key) => key !== 'all').map((key) => (
                <div key={key} className="stat-line"><span>{SOURCE_META[key].icon} {SOURCE_META[key].label}</span><b>{sourceCounts[key]}</b></div>
              ))}
            </div>
            <div>
              <h3>Tags</h3>
              {tagOptions.map((tag) => <div key={tag.key} className="stat-line"><span className={`comment-tag ${tag.className}`}>{tag.icon} {tag.label}</span><b>{tagCounts[tag.key] || 0}</b></div>)}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'templates' ? (
        <div className="comment-tab-panel template-manager">
          <div className="template-editor">
            <input value={templateForm.title} onChange={(e) => setTemplateForm((s) => ({ ...s, title: e.target.value }))} placeholder="Tên mẫu câu" />
            <input value={templateForm.trigger} onChange={(e) => setTemplateForm((s) => ({ ...s, trigger: e.target.value }))} placeholder="Lệnh /, ví dụ diachi" />
            <textarea value={templateForm.text} onChange={(e) => setTemplateForm((s) => ({ ...s, text: e.target.value }))} placeholder="Nội dung trả lời nhanh..." />
            <button type="button" className="btn-submit" onClick={() => void createTemplate()}>+ Thêm mẫu câu</button>
          </div>
          <div className="template-grid">
          {templates.map((item) => (
            <div key={item.id} className="template-card">
              <b>{item.title}</b>
              <small>/{item.trigger}</small>
              <p>{item.text}</p>
              <button type="button" className="btn-cancel" onClick={() => insertTemplate(item)}>Chèn thử</button>
              {!item.system ? <button type="button" className="btn-danger-soft" onClick={() => void deleteTemplate(item.id)}>Xoá</button> : null}
            </div>
          ))}
          </div>
        </div>
      ) : null}

      {status ? <div className="comment-studio-status">{status}</div> : null}
    </section>
  );
}
