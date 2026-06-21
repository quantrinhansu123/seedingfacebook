'use client';

import React, { useState } from 'react';
import { api } from '@/lib/api';
import { catBg, catFg } from '@/lib/constants';
import { LeadBlock } from '@/components/LeadBlock';
import { CommentSummaryBlock } from '@/components/CommentSummaryBlock';
import type { CommentSummary, FbComment, FbPage, FbPost, FbReaction, Lead } from '@/lib/types';
import { avatarColor, escRegex, initials, timeAgo } from '@/lib/utils';

function HighlightText({ text, keywords }: { text: string; keywords: string[] }) {
  if (!keywords.length) return <>{text}</>;
  let nodes: React.ReactNode[] = [text];
  keywords.forEach((kw, kwi) => {
    if (!kw.trim()) return;
    const next: React.ReactNode[] = [];
    const re = new RegExp(`(${escRegex(kw)})`, 'gi');
    nodes.forEach((node, ni) => {
      if (typeof node !== 'string') {
        next.push(node);
        return;
      }
      node.split(re).forEach((part, pi) => {
        if (!part) return;
        if (pi % 2 === 1) {
          next.push(
            <span key={`h-${kwi}-${ni}-${pi}`} className="hl">
              {part}
            </span>,
          );
        } else {
          next.push(<React.Fragment key={`t-${kwi}-${ni}-${pi}`}>{part}</React.Fragment>);
        }
      });
    });
    nodes = next;
  });
  return <>{nodes}</>;
}

function reactionEmoji(type?: string): string {
  const key = String(type || 'LIKE').toUpperCase();
  if (key === 'LOVE') return '❤️';
  if (key === 'HAHA') return '😆';
  if (key === 'WOW') return '😮';
  if (key === 'SAD') return '😢';
  if (key === 'ANGRY') return '😡';
  if (key === 'CARE') return '🥰';
  return '👍';
}

type EngagementTab = 'comments' | 'likes' | 'shares';

function postShortId(post: FbPost): string {
  const parts = post.id.split('_');
  return parts[1] || post.id;
}

function formatSchedule(value?: string): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

export function PostCard({
  post,
  groupNames,
  category,
  keywords,
  pages,
  leads,
  commentSummary,
  onOpenLightbox,
  onSummarizeComments,
  onExploreComments,
  onCommentSent,
  onMarkProcessed,
}: {
  post: FbPost;
  groupNames: Record<string, string>;
  category?: string;
  keywords: string[];
  pages: FbPage[];
  leads?: Lead[];
  commentSummary?: CommentSummary;
  onOpenLightbox: (src: string) => void;
  onSummarizeComments?: (post: FbPost) => Promise<string>;
  onExploreComments?: (post: FbPost) => void;
  onCommentSent?: (postId: string) => Promise<void>;
  onMarkProcessed?: (post: FbPost) => Promise<void>;
}) {
  const authorName = post.from?.name || 'Ẩn danh';
  const reactions = post.reactions?.summary?.total_count ?? 0;
  const shares = post.shares?.count ?? 0;
  const cData = post.comments || {};
  const cList = cData.data || [];
  const cCount = cData.summary?.total_count ?? cList.length;
  const text = post.message || '';
  const long = text.length > 300;
  const pid = postShortId(post);
  const gid = post._group_id || '';
  const pageIdFromPost = post._page_id || '';
  const gName = gid && groupNames[gid] ? groupNames[gid] : gid;
  const pageName = post._page_name || pageIdFromPost;

  // ── Bài viết chuẩn: structured fields ──
  const structuredTitle = (post.title || '').trim();
  const structuredContent = (post.content || '').trim();
  const bodyText = structuredContent || text;
  const bodyLong = bodyText.length > 300;
  const mediaUrl = (post.image_url || '').trim();
  const scheduleStr = formatSchedule(post.scheduled_at);
  const videoUrls = (post.video_urls || []).filter(Boolean);

  const [expanded, setExpanded] = useState(false);
  const [cmtOpen, setCmtOpen] = useState(false);
  const [cmtMsg, setCmtMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [pageId, setPageId] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState('');
  const [markBusy, setMarkBusy] = useState(false);
  const [markMsg, setMarkMsg] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [engagementTab, setEngagementTab] = useState<EngagementTab>('comments');
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [engagementError, setEngagementError] = useState('');
  const [engagementWarning, setEngagementWarning] = useState('');
  const [engagementComments, setEngagementComments] = useState<FbComment[]>([]);
  const [engagementReactions, setEngagementReactions] = useState<FbReaction[]>([]);
  const [engagementShareCount, setEngagementShareCount] = useState<number | null>(null);
  const [replyOpenById, setReplyOpenById] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replySendingById, setReplySendingById] = useState<Record<string, boolean>>({});
  const [replyStatusById, setReplyStatusById] = useState<Record<string, string>>({});
  const postLeads = leads || [];
  const visibleCommentSummary =
    commentSummary &&
    (Boolean(commentSummary.summary?.trim()) ||
      !((commentSummary.fetched_comment_count ?? 0) === 0 && cCount > 0))
      ? commentSummary
      : undefined;

  const atts = (post.attachments?.data || []).map((a, i) => {
    if (a.type === 'photo') {
      const src = a.media?.image?.src || '';
      return src ? (
        <div key={i} className="attachment">
          <img src={src} alt="" loading="lazy" onClick={() => onOpenLightbox(src)} />
        </div>
      ) : null;
    }
    if (a.type === 'video') {
      const src = a.media?.source || '';
      return src ? (
        <div key={i} className="attachment attachment-link">
          🎥{' '}
          <a href={src} target="_blank" rel="noreferrer">
            Xem video
          </a>
        </div>
      ) : null;
    }
    if (a.type === 'share' || a.type === 'link') {
      const url = a.url || '';
      return url ? (
        <div key={i} className="attachment attachment-link">
          🔗{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url.substring(0, 60)}…
          </a>
        </div>
      ) : null;
    }
    return null;
  });

  async function sendComment() {
    const ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-cmt="${post.id}"]`);
    const message = ta?.value.trim() || '';
    const image = imageUrl.trim();
    if (!message && !image) return;
    setSending(true);
    setCmtMsg('⏳ Đang gửi…');
    try {
      const r = await api('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: post.id,
          group_id: gid || pageIdFromPost,
          post_url: post.permalink_url || '',
          message,
          image_url: image,
          page_id: pageId || pageIdFromPost,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        if (ta) ta.value = '';
        setImageUrl('');
        setCmtMsg(image ? '✅ Đã bình luận kèm ảnh!' : '✅ Đã bình luận — đã xử lý');
        await onCommentSent?.(post.id);
      } else setCmtMsg('❌ ' + (d.error || 'Lỗi'));
    } catch {
      setCmtMsg('❌ Lỗi kết nối');
    }
    setSending(false);
    setTimeout(() => setCmtMsg(''), 4000);
  }

  async function uploadCommentImage(file?: File) {
    if (!file) return;
    setUploadingImage(true);
    setCmtMsg('⏳ Đang upload ảnh...');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await api('/api/uploads/comment-image', {
        method: 'POST',
        body: fd,
      });
      const d = await r.json();
      if (d.ok && d.image_url) {
        setImageUrl(d.image_url);
        setCmtMsg('✅ Đã upload ảnh');
      } else {
        setCmtMsg('❌ ' + (d.error || 'Upload ảnh lỗi'));
      }
    } catch {
      setCmtMsg('❌ Lỗi upload ảnh');
    }
    setUploadingImage(false);
    setTimeout(() => setCmtMsg(''), 3500);
  }

  async function openEngagement(tab: EngagementTab) {
    if (engagementOpen && engagementTab === tab) {
      setEngagementOpen(false);
      return;
    }
    setEngagementTab(tab);
    setEngagementOpen(true);
    setEngagementError('');
    setEngagementWarning('');

    if (tab === 'comments' && cList.length) {
      setEngagementComments(cList);
    }
    if (tab === 'shares') {
      setEngagementShareCount(shares);
    }

    setEngagementLoading(true);
    try {
      const r = await api('/api/post-engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post, kind: tab, limit: 100 }),
        timeoutMs: 60000,
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        if (tab === 'comments' && cList.length) {
          setEngagementComments(cList);
          setEngagementWarning(d.error || 'Không tải thêm được comment từ Facebook.');
        } else if (tab === 'shares') {
          setEngagementShareCount(shares);
        } else {
          setEngagementError(d.error || 'Không tải được dữ liệu tương tác.');
        }
        return;
      }
      if (Array.isArray(d.comments)) setEngagementComments(d.comments);
      if (Array.isArray(d.reactions)) setEngagementReactions(d.reactions);
      if (d.share_count !== undefined && d.share_count !== null) {
        setEngagementShareCount(Number(d.share_count));
      }
      if (d.warning) setEngagementWarning(String(d.warning));
    } catch {
      if (tab === 'comments' && cList.length) {
        setEngagementComments(cList);
        setEngagementWarning('Không kết nối được backend, hiển thị comment có sẵn.');
      } else if (tab === 'shares') {
        setEngagementShareCount(shares);
      } else {
        setEngagementError('Lỗi kết nối khi tải dữ liệu tương tác.');
      }
    } finally {
      setEngagementLoading(false);
    }
  }

  function appendReply(comments: FbComment[], parentId: string, reply: FbComment): FbComment[] {
    return comments.map((item) => {
      if (item.id === parentId) {
        const existingReplies = item.comments?.data || [];
        return {
          ...item,
          comments: {
            ...(item.comments || {}),
            data: [...existingReplies, reply],
            summary: {
              ...(item.comments?.summary || {}),
              total_count: (item.comments?.summary?.total_count || existingReplies.length) + 1,
            },
          },
        };
      }
      const children = item.comments?.data || [];
      if (!children.length) return item;
      return {
        ...item,
        comments: {
          ...(item.comments || {}),
          data: appendReply(children, parentId, reply),
        },
      };
    });
  }

  async function sendCommentReply(comment: FbComment, key: string, depth = 0) {
    const commentId = comment.id || '';
    const message = (replyDrafts[key] || '').trim();
    if (!commentId) {
      setReplyStatusById((prev) => ({ ...prev, [key]: 'Không có ID comment để trả lời.' }));
      return;
    }
    if (!message) {
      setReplyStatusById((prev) => ({ ...prev, [key]: 'Nhập nội dung trả lời.' }));
      return;
    }
    setReplySendingById((prev) => ({ ...prev, [key]: true }));
    setReplyStatusById((prev) => ({ ...prev, [key]: 'Đang gửi trả lời...' }));
    try {
      const r = await api('/api/post-comments/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_id: commentId,
          post_id: post.id,
          group_id: gid || pageIdFromPost,
          post_url: post.permalink_url || '',
          message,
          page_id: pageIdFromPost || pageId,
          source: pageIdFromPost ? 'facebook_page' : 'facebook',
          depth,
        }),
        timeoutMs: 60000,
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setReplyStatusById((prev) => ({ ...prev, [key]: d.error || 'Không gửi được trả lời.' }));
        return;
      }
      const reply: FbComment = {
        id: d.comment_id || `local-reply-${Date.now()}`,
        from: { name: 'Bạn' },
        message,
        created_time: new Date().toISOString(),
      };
      setEngagementComments((prev) => appendReply(prev, commentId, reply));
      setReplyDrafts((prev) => ({ ...prev, [key]: '' }));
      setReplyOpenById((prev) => ({ ...prev, [key]: false }));
      setReplyStatusById((prev) => ({ ...prev, [key]: d.warning ? `Đã gửi. ${d.warning}` : 'Đã gửi trả lời.' }));
      await onCommentSent?.(post.id);
    } catch {
      setReplyStatusById((prev) => ({ ...prev, [key]: 'Lỗi kết nối khi gửi trả lời.' }));
    } finally {
      setReplySendingById((prev) => ({ ...prev, [key]: false }));
      window.setTimeout(() => {
        setReplyStatusById((prev) => ({ ...prev, [key]: '' }));
      }, 5000);
    }
  }

  function renderFacebookComment(comment: FbComment, index: number, depth = 0) {
    const name = comment.from?.name || 'Ẩn danh';
    const key = comment.id || `cmt-${depth}-${index}`;
    const replies = comment.comments?.data || [];
    const isReplyOpen = Boolean(replyOpenById[key]);
    const isSendingReply = Boolean(replySendingById[key]);
    return (
      <div key={key} className={`comment${depth ? ' comment-reply' : ''}`}>
        <div className="comment-av">{initials(name)}</div>
        <div className="comment-content">
          <div className="comment-bubble">
            <div className="comment-name">{name}</div>
            <div className="comment-msg">{comment.message || '[Không có nội dung chữ]'}</div>
            {comment.created_time ? (
              <small style={{ color: '#64748b', fontSize: 11 }}>{timeAgo(comment.created_time)}</small>
            ) : null}
          </div>
          <div className="comment-actions">
            <button
              type="button"
              className="comment-reply-toggle"
              disabled={!comment.id}
              onClick={() => setReplyOpenById((prev) => ({ ...prev, [key]: !prev[key] }))}
            >
              Trả lời
            </button>
            {replyStatusById[key] ? <span className="comment-reply-status">{replyStatusById[key]}</span> : null}
          </div>
          {isReplyOpen ? (
            <div className="comment-inline-reply">
              <textarea
                value={replyDrafts[key] || ''}
                onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={`Trả lời ${name}...`}
                rows={2}
              />
              <div className="comment-inline-reply-actions">
                <button type="button" onClick={() => void sendCommentReply(comment, key, depth)} disabled={isSendingReply}>
                  {isSendingReply ? 'Đang gửi...' : 'Gửi trả lời'}
                </button>
                <button type="button" onClick={() => setReplyOpenById((prev) => ({ ...prev, [key]: false }))}>
                  Hủy
                </button>
              </div>
            </div>
          ) : null}
          {replies.length ? <div className="comment-replies">{replies.map((reply, i) => renderFacebookComment(reply, i, depth + 1))}</div> : null}
        </div>
      </div>
    );
  }

  function renderEngagementPanel() {
    if (!engagementOpen) return null;
    const title =
      engagementTab === 'comments'
        ? `Bình luận (${engagementComments.length || cCount})`
        : engagementTab === 'likes'
          ? `Người thích (${engagementReactions.length || reactions})`
          : `Chia sẻ (${engagementShareCount ?? shares})`;

    return (
      <div className="post-engagement-panel">
        <div className="post-engagement-head">
          <b>{title}</b>
          <button type="button" className="post-engagement-close" onClick={() => setEngagementOpen(false)}>
            Đóng
          </button>
        </div>
        {engagementLoading ? <div className="post-engagement-loading">Đang tải...</div> : null}
        {engagementError ? <div className="post-engagement-error">{engagementError}</div> : null}
        {engagementWarning ? <div className="post-engagement-note">{engagementWarning}</div> : null}
        {!engagementLoading && engagementTab === 'comments' ? (
          engagementComments.length ? (
            <div className="comments-list">
              {engagementComments.map((comment, index) => renderFacebookComment(comment, index))}
            </div>
          ) : (
            <div className="post-engagement-empty">Chưa có bình luận.</div>
          )
        ) : null}
        {!engagementLoading && engagementTab === 'likes' ? (
          engagementReactions.length ? (
            <div className="reaction-list">
              {engagementReactions.map((item, index) => (
                <div key={item.id || `like-${index}`} className="reaction-item">
                  <span className="reaction-type">{reactionEmoji(item.type)}</span>
                  <span className="reaction-name">{item.name || 'Ẩn danh'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="post-engagement-empty">Không lấy được danh sách người thích.</div>
          )
        ) : null}
        {!engagementLoading && engagementTab === 'shares' ? (
          <div className="post-engagement-note">
            Tổng lượt chia sẻ: <b>{engagementShareCount ?? shares}</b>.
            <br />
            Facebook thường không cung cấp danh sách người share qua API.
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="avatar" style={{ background: avatarColor(authorName) }}>
          {initials(authorName)}
        </div>
        <div className="author-info">
          <div className="author-name">{authorName}</div>
          <div className="post-meta">
            <span className="meta-time">{timeAgo(post.created_time)}</span>
            <span className="meta-dot" />
            {post.is_hidden ? (
              <span className="badge badge-pending">⏳ Chờ duyệt</span>
            ) : (
              <span className="badge badge-ok">✅ Đã đăng</span>
            )}
            {gid ? (
              <>
                <span className="meta-dot" />
                <span className="badge badge-group" title={`${gName}\nID: ${gid}`}>
                  📋 {gName}
                </span>
              </>
            ) : null}
            {pageIdFromPost ? (
              <>
                <span className="meta-dot" />
                <span className="badge badge-group" title={`${pageName}\nID: ${pageIdFromPost}`}>
                  📄 {pageName}
                </span>
              </>
            ) : null}
            {category ? (
              <>
                <span className="meta-dot" />
                <span className="badge badge-cat" style={{ background: catBg(category), color: catFg(category) }}>
                  🏷️ {category}
                </span>
              </>
            ) : null}
            {postLeads.length ? (
              <>
                <span className="meta-dot" />
                <span className="badge badge-lead">🧲 {postLeads.length} lead</span>
              </>
            ) : null}
            {visibleCommentSummary ? (
              <>
                <span className="meta-dot" />
                <span className="badge badge-reply">📊 Đã tóm tắt</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {structuredTitle ? (
        <div className="card-body" style={{ paddingBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Tiêu đề
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35, color: '#111827' }}>{structuredTitle}</div>
        </div>
      ) : null}
      {bodyText ? (
        <div className="card-body">
          {structuredContent ? (
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Nội dung
            </div>
          ) : null}
          <div className={`post-text${bodyLong && !expanded ? ' collapsed' : ''}`} id={`pt-${pid}`}>
            <HighlightText text={bodyText} keywords={keywords} />
          </div>
          {bodyLong && !expanded ? (
            <span className="see-more" onClick={() => setExpanded(true)} role="button" tabIndex={0}>
              Xem thêm ▾
            </span>
          ) : null}
        </div>
      ) : null}
      {mediaUrl ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Link ảnh / media
          </div>
          <div className="attachment attachment-link">
            🖼️{' '}
            <a href={mediaUrl} target="_blank" rel="noreferrer">
              {mediaUrl}
            </a>
          </div>
        </div>
      ) : null}
      {scheduleStr ? (
        <div className="card-body" style={{ paddingTop: 0, paddingBottom: 4 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, background: '#f3f4f6', color: '#374151', fontSize: 13, fontWeight: 600 }}>
            <span>🗓️</span>
            <span>Lịch đăng: {scheduleStr}</span>
          </div>
        </div>
      ) : null}
      {videoUrls.length ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Video đi kèm
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {videoUrls.map((url, index) => (
              <div key={`${post.id}-video-${index}`} className="attachment attachment-link">
                🎥{' '}
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {atts.some(Boolean) ? <div className="card-body" style={{ paddingTop: 0 }}>{atts}</div> : null}
      <div className="card-stats">
        <button
          type="button"
          className={`stat stat-clickable${engagementOpen && engagementTab === 'likes' ? ' active' : ''}`}
          onClick={() => void openEngagement('likes')}
          title="Xem người thích"
        >
          <span className="stat-icon">❤️</span> {reactions}
        </button>
        <button
          type="button"
          className={`stat stat-clickable${engagementOpen && engagementTab === 'comments' ? ' active' : ''}`}
          onClick={() => void openEngagement('comments')}
          title="Xem bình luận"
        >
          <span className="stat-icon">💬</span> {cCount}
        </button>
        <button
          type="button"
          className={`stat stat-clickable${engagementOpen && engagementTab === 'shares' ? ' active' : ''}`}
          onClick={() => void openEngagement('shares')}
          title="Xem lượt chia sẻ"
        >
          <span className="stat-icon">↗️</span> {shares}
        </button>
      </div>
      {renderEngagementPanel()}
      <LeadBlock items={postLeads} />
      {visibleCommentSummary ? <CommentSummaryBlock item={visibleCommentSummary} /> : null}
      <div className="card-footer">
        <div className="post-link">
          <a href={post.permalink_url || '#'} target="_blank" rel="noreferrer">
            🔗 Xem trên Facebook
          </a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {onSummarizeComments ? (
            <button
              type="button"
              className="btn-reply-ai"
              disabled={summaryBusy}
              onClick={async () => {
                setSummaryBusy(true);
                setSummaryMsg('⏳ Đang đọc comment và gọi AI...');
                try {
                  const msg = await onSummarizeComments(post);
                  setSummaryMsg(msg || '');
                } catch {
                  setSummaryMsg('❌ Lỗi kết nối server');
                } finally {
                  setSummaryBusy(false);
                  setTimeout(() => setSummaryMsg(''), 9000);
                }
              }}
            >
              {summaryBusy ? '⏳ Đang tóm tắt...' : pageIdFromPost ? '📊 Tóm tắt CMT Page' : '📊 Tóm tắt CMT'}
            </button>
          ) : null}
          {onExploreComments ? (
            <button type="button" className="btn-reply-ai" onClick={() => onExploreComments(post)}>
              {pageIdFromPost ? '📥 Lấy CMT Page' : '🔎 Lọc CMT'}
            </button>
          ) : null}
          {onMarkProcessed ? (
            <button
              type="button"
              className="btn-mark-processed"
              disabled={markBusy}
              onClick={async () => {
                setMarkBusy(true);
                setMarkMsg('');
                try {
                  await onMarkProcessed(post);
                  setMarkMsg('✅ Đã xử lý');
                } catch {
                  setMarkMsg('❌ Không lưu được');
                } finally {
                  setMarkBusy(false);
                  window.setTimeout(() => setMarkMsg(''), 4000);
                }
              }}
            >
              {markBusy ? '⏳...' : '✅ Đã xử lý'}
            </button>
          ) : null}
          <button type="button" className="btn-write-comment" onClick={() => setCmtOpen((o) => !o)}>
            {cmtOpen ? '✖ Đóng' : '✏️ Bình luận'}
          </button>
        </div>
        {summaryMsg ? <div className="comment-msg-result">{summaryMsg}</div> : null}
        {markMsg ? <div className="comment-msg-result">{markMsg}</div> : null}
      </div>
      <div className={`comment-box${cmtOpen ? ' open' : ''}`}>
        <textarea className="comment-textarea" rows={2} placeholder="Nhập bình luận..." data-cmt={post.id} />
        <div className="comment-file-row">
          <label className={`btn-image-upload${uploadingImage ? ' disabled' : ''}`}>
            📎 Upload ảnh
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploadingImage}
              onChange={(e) => void uploadCommentImage(e.target.files?.[0])}
            />
          </label>
          <span className="comment-file-hint">JPG, PNG, WEBP, GIF tối đa 8MB</span>
        </div>
        <input
          className="comment-image-input"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="URL ảnh public sau khi upload hoặc dán link ảnh"
        />
        {imageUrl ? (
          <div className="comment-image-preview">
            <img src={imageUrl} alt="Ảnh bình luận" />
            <button type="button" onClick={() => setImageUrl('')}>
              Gỡ ảnh
            </button>
          </div>
        ) : null}
        <div className="comment-row">
          <select className="comment-as" value={pageId} onChange={(e) => setPageId(e.target.value)}>
            <option value="">👤 Cá nhân</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                📄 {p.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-send" disabled={sending} onClick={() => void sendComment()}>
            Gửi
          </button>
          <span className="comment-msg-result">{cmtMsg}</span>
        </div>
      </div>
    </div>
  );
}
