'use client';

import { useEffect, useMemo, useState } from 'react';
import { APP_BRAND } from '@/lib/app-brand';
import { resolveMediaPreview } from '@/lib/post-media-preview';

type MediaItem = { url: string; type?: 'image' | 'video'; name?: string };

type Props = {
  authorName: string;
  authorHint?: string;
  title: string;
  content: string;
  hashtags: string;
  mediaUrl: string;
  postMedia: MediaItem[];
  scheduledAt?: string;
};

function formatSchedule(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('vi-VN');
}

export function PostPublishPreview({
  authorName,
  authorHint = 'Facebook',
  title,
  content,
  hashtags,
  mediaUrl,
  postMedia,
  scheduledAt,
}: Props) {
  const [brokenImage, setBrokenImage] = useState(false);

  const previewText = useMemo(() => {
    const chunks = [title.trim(), content.trim(), hashtags.trim()].filter(Boolean);
    return chunks.join('\n\n');
  }, [title, content, hashtags]);

  const primaryUpload = postMedia[0];
  const linkPreview = useMemo(() => resolveMediaPreview(mediaUrl), [mediaUrl]);

  const mediaKind = primaryUpload
    ? (primaryUpload.type === 'video' ? 'video' : 'image')
    : linkPreview.kind;

  const mediaSrc = primaryUpload?.url || linkPreview.src || '';
  const embedUrl = linkPreview.embedUrl;

  useEffect(() => {
    setBrokenImage(false);
  }, [mediaSrc, primaryUpload?.url]);

  return (
    <div className="seeding-fb-preview">
      <div className="seeding-fb-preview-label">
        <span>👁 Xem trước bài đăng</span>
        <em>{authorHint}</em>
      </div>

      <article className="seeding-fb-post-card">
        <header className="seeding-fb-post-head">
          <div className="seeding-fb-avatar" aria-hidden="true">
            {(authorName || 'S').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <b>{authorName || APP_BRAND.name}</b>
            <small>{scheduledAt ? `Lên lịch · ${formatSchedule(scheduledAt)}` : 'Vừa xong · 🌐'}</small>
          </div>
        </header>

        {previewText ? (
          <div className="seeding-fb-post-text">{previewText}</div>
        ) : (
          <div className="seeding-fb-post-text seeding-fb-post-placeholder">
            Tiêu đề và nội dung bài viết sẽ hiển thị ở đây…
          </div>
        )}

        <div className="seeding-media-preview">
          <div className="seeding-media-preview-head">
            <b>Ảnh / video</b>
            {mediaKind === 'none' ? <span>Chưa có media</span> : null}
          </div>
          <div className="seeding-media-preview-body">
            {primaryUpload && primaryUpload.type === 'video' ? (
              <video src={primaryUpload.url} controls playsInline />
            ) : null}
            {primaryUpload && primaryUpload.type !== 'video' ? (
              brokenImage ? (
                <div className="seeding-media-preview-fallback">Không tải được preview ảnh upload.</div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={primaryUpload.url} alt="" onError={() => setBrokenImage(true)} />
              )
            ) : null}
            {!primaryUpload && mediaKind === 'youtube' && embedUrl ? (
              <iframe
                src={embedUrl}
                title="YouTube preview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : null}
            {!primaryUpload && mediaKind === 'video' && mediaSrc ? (
              <video src={mediaSrc} controls playsInline />
            ) : null}
            {!primaryUpload && mediaKind === 'image' && mediaSrc ? (
              brokenImage ? (
                <div className="seeding-media-preview-fallback">
                  Không tải được preview ảnh.
                  {' '}
                  <a href={mediaSrc} target="_blank" rel="noreferrer">Mở link</a>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaSrc} alt="" onError={() => setBrokenImage(true)} />
              )
            ) : null}
            {!primaryUpload && mediaKind === 'link' && mediaSrc ? (
              <div className="seeding-media-link-card">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <div>
                  <b>Link preview video</b>
                  <a href={mediaSrc} target="_blank" rel="noreferrer">{mediaSrc}</a>
                </div>
              </div>
            ) : null}
            {mediaKind === 'none' ? (
              <div className="seeding-media-preview-empty">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                <span>Ảnh / video sẽ hiển thị ở đây</span>
              </div>
            ) : null}
          </div>
        </div>

        {postMedia.length > 1 ? (
          <div className="seeding-fb-media-grid">
            {postMedia.slice(1, 5).map((item, index) => (
              <div className="seeding-fb-media-thumb" key={`${item.url}-${index}`}>
                {item.type === 'video' ? <video src={item.url} muted /> : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt="" />
                )}
              </div>
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}
