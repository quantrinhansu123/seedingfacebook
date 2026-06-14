'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, AI_TIMEOUT_MS, PUBLISH_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, formatFetchError } from '@/lib/api';
import type { ContentPipelinePost, FbPage, GroupRow } from '@/lib/types';
import { PostPublishPreview } from '@/components/PostPublishPreview';

type PipelinePayload = {
  posts?: ContentPipelinePost[];
};

type Props = {
  data: PipelinePayload;
  busy: boolean;
  status: string;
  onReload: () => Promise<void>;
  onResearch: (sourceFilter: string) => Promise<void>;
  initialGroups?: GroupRow[];
  initialPages?: FbPage[];
};

type PublishTarget = {
  type: 'group' | 'page';
  id: string;
  name: string;
};

type PublishResult = {
  ok: boolean;
  target: PublishTarget;
  post_id?: string;
  error?: string;
  delivery?: string;
};

type PostMediaItem = { url: string; type?: 'image' | 'video'; name?: string };

type HistoryRow = {
  id: string;
  title: string;
  content: string;
  mediaUrl: string;
  mediaUrls?: string[];
  hashtags: string;
  scheduledAt: string;
  targets: PublishTarget[];
  status: string;
  results?: PublishResult[];
  createdAt: string;
};

const HISTORY_KEY = 'seeding-post-history-v2';

const PARTNER_POST_PRESETS = [
  {
    title: 'Hướng dẫn điều chỉnh ty đàn guitar xử lý rè dây',
    content: 'Video bài nói hướng dẫn người mới kiểm tra cần đàn, nhận biết tiếng rè và cách mang đàn tới shop để được cân chỉnh an toàn.',
    mediaUrl: 'https://www.tiktok.com/@guitarsaithanh/video/7350012345678901234',
    scheduledAt: '2026-06-11T09:00',
  },
  {
    title: 'Review đàn acoustic tầm 3 triệu – đáng mua không?',
    content: 'Bài review có hook ngắn, demo âm thanh, điểm mạnh/yếu và CTA inbox để nhận bảng giá/clip test từng cây.',
    mediaUrl: 'https://example.com/video/review-acoustic-3tr.mp4',
    scheduledAt: '2026-06-11T19:30',
  },
  {
    title: 'Chương trình Thanh Lý Đàn Tận Xưởng – Acoustic giảm đến 30%',
    content: 'Bài khuyến mãi ngắn, nêu rõ số lượng còn lại, ưu đãi theo khung giờ và lời kêu gọi đặt lịch đến thử đàn.',
    mediaUrl: 'https://example.com/images/thanh-ly-dan-acoustic.jpg',
    scheduledAt: '2026-06-12T10:15',
  },
];

function targetKey(target: PublishTarget) {
  return `${target.type}:${target.id}`;
}

function safeList<T>(payload: unknown): T[] {
  return Array.isArray(payload) ? payload as T[] : [];
}

function detectVideoMedia(url: string) {
  const cleanUrl = url.trim();
  if (!cleanUrl) return { mediaUrl: '', nativeVideoUrl: '' };
  const isDirectVideo = /\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv|3gp|ogv)(\?|$)/i.test(cleanUrl);
  return isDirectVideo
    ? { mediaUrl: '', nativeVideoUrl: cleanUrl }
    : { mediaUrl: cleanUrl, nativeVideoUrl: '' };
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('vi-VN');
}

async function readPayload(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function apiErrorMessage(res: Response, payload: Record<string, unknown>): string {
  if (payload.auth_required) return 'Phiên đăng nhập hết hạn. Hãy tải lại trang và đăng nhập lại.';
  if (payload.error) return String(payload.error);
  if (!res.ok) return `Lỗi server (${res.status})`;
  return '';
}

function applyTargetRows(
  groupRows: GroupRow[],
  pageRows: FbPage[],
  setGroups: (rows: GroupRow[]) => void,
  setPages: (rows: FbPage[]) => void,
  setSelectedGroups: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void,
  setSelectedPages: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void,
) {
  setGroups(groupRows);
  setPages(pageRows);
  setSelectedGroups((prev) => {
    const next: Record<string, boolean> = {};
    groupRows.forEach((group) => {
      next[group.id] = prev[group.id] ?? true;
    });
    return next;
  });
  setSelectedPages((prev) => {
    const next: Record<string, boolean> = {};
    pageRows.forEach((page) => {
      next[page.id] = prev[page.id] ?? false;
    });
    return next;
  });
}

export function MarketingPipelinePanel({
  data,
  busy,
  status,
  onReload,
  initialGroups = [],
  initialPages = [],
}: Props) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [postMedia, setPostMedia] = useState<PostMediaItem[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [hashtags, setHashtags] = useState('#guitar #guitarsaithanh');
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [pages, setPages] = useState<FbPage[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>({});
  const [selectedPages, setSelectedPages] = useState<Record<string, boolean>>({});
  const [captionVariants, setCaptionVariants] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [localStatus, setLocalStatus] = useState('');
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(safeList<HistoryRow>(JSON.parse(raw)));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadTargets();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 80)));
    } catch {
      // Local history is a convenience only; posting flow must not fail because storage is full.
    }
  }, [history]);

  const selectedTargets = useMemo<PublishTarget[]>(() => {
    const groupTargets = groups
      .filter((group) => group.id && selectedGroups[group.id])
      .map((group) => ({ type: 'group' as const, id: group.id, name: group.name || group.id }));
    const pageTargets = pages
      .filter((page) => page.id && selectedPages[page.id])
      .map((page) => ({ type: 'page' as const, id: page.id, name: page.name || page.id }));
    return [...groupTargets, ...pageTargets];
  }, [groups, pages, selectedGroups, selectedPages]);

  const importedHistory = useMemo<HistoryRow[]>(() => {
    return (data.posts || []).map((post) => ({
      id: `pipeline-${post.id}`,
      title: post.article_title || 'Bản nháp content',
      content: post.content || '',
      mediaUrl: post.article_url || '',
      mediaUrls: post.media_urls || [],
      hashtags: post.hashtags || '',
      scheduledAt: post.scheduled_at || '',
      targets: (post.scheduled_targets || []).map((target) => ({
        type: target.type === 'page' ? 'page' : 'group',
        id: target.id || '-',
        name: target.name || target.id || '-',
      })),
      status: post.status || 'draft',
      createdAt: post.created_at || post.updated_at || '',
    }));
  }, [data.posts]);

  const visibleHistory = useMemo(() => {
    const seen = new Set<string>();
    return [...history, ...importedHistory].filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [history, importedHistory]);

  async function loadTargets() {
    setLoadingTargets(true);
    setLocalStatus('');
    const errors: string[] = [];
    let groupRows: GroupRow[] = [];
    let pageRows: FbPage[] = [];

    try {
      const res = await api('/api/channels/publish-targets', { timeoutMs: 30000 });
      const payload = await readPayload(res);
      let storageLabel = '';
      if (!res.ok || payload.auth_required) {
        const msg = apiErrorMessage(res, payload);
        errors.push(msg || 'Không tải được nhóm/Page từ DB.');
      } else if (payload.ok === false) {
        errors.push(String(payload.error || 'Không tải được nhóm/Page từ DB.'));
      } else {
        groupRows = safeList<GroupRow>(payload.groups).filter((item) => item?.id);
        pageRows = safeList<FbPage>(payload.pages).filter((item) => item?.id);
        storageLabel = payload.storage === 'supabase' ? 'Supabase' : 'local';
        if (payload.storage === 'local' && !groupRows.length && !pageRows.length) {
          errors.push('Chưa có kênh trong DB. Vào Quản lý nhóm để thêm nhóm/Page.');
        }
      }

      if (groupRows.length || pageRows.length) {
        applyTargetRows(groupRows, pageRows, setGroups, setPages, setSelectedGroups, setSelectedPages);
        const parts = [
          groupRows.length ? `${groupRows.length} nhóm` : '',
          pageRows.length ? `${pageRows.length} Page` : '',
        ].filter(Boolean);
        setLocalStatus(parts.length && storageLabel ? `Đã tải ${parts.join(', ')} từ ${storageLabel}.` : parts.length ? `Đã tải ${parts.join(', ')}.` : '');
      } else if (initialGroups.length || initialPages.length) {
        applyTargetRows(
          initialGroups.filter((item) => item?.id),
          initialPages.filter((item) => item?.id),
          setGroups,
          setPages,
          setSelectedGroups,
          setSelectedPages,
        );
      } else {
        setGroups([]);
        setPages([]);
      }

      if (errors.length) {
        setLocalStatus(errors.join(' '));
      }
    } catch (error) {
      if (initialGroups.length || initialPages.length) {
        applyTargetRows(
          initialGroups.filter((item) => item?.id),
          initialPages.filter((item) => item?.id),
          setGroups,
          setPages,
          setSelectedGroups,
          setSelectedPages,
        );
      } else {
        setGroups([]);
        setPages([]);
      }
      setLocalStatus(formatFetchError(error, 'Lỗi kết nối khi tải nhóm/Page từ DB.'));
    } finally {
      setLoadingTargets(false);
    }
  }

  function loadPreset(item: typeof PARTNER_POST_PRESETS[number]) {
    setTitle(item.title);
    setContent(item.content);
    setMediaUrl(item.mediaUrl);
    setPostMedia([]);
    setScheduledAt(item.scheduledAt);
    setLocalStatus('Đã nạp bài mẫu từ đối tác vào form. Có thể chỉnh lại rồi Đăng ngay hoặc Đặt lịch.');
  }

  function setAllTargets(checked: boolean) {
    setSelectedGroups(Object.fromEntries(groups.map((group) => [group.id, checked])));
    setSelectedPages(Object.fromEntries(pages.map((page) => [page.id, checked])));
  }

  function buildMessage(target?: PublishTarget) {
    const variant = target ? captionVariants[targetKey(target)] : '';
    const body = (variant || content).trim();
    return [
      title.trim(),
      body,
      hashtags.trim(),
    ].filter(Boolean).join('\n\n');
  }

  function appendHistory(row: Omit<HistoryRow, 'id' | 'createdAt'>) {
    setHistory((prev) => [{
      ...row,
      id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
    }, ...prev].slice(0, 80));
  }

  async function generatePostCaptions() {
    const base = content.trim() || title.trim();
    if (!base) {
      setLocalStatus('Nhập tiêu đề hoặc nội dung gốc trước khi dùng AI viết bài.');
      return;
    }
    if (!selectedTargets.length) {
      setLocalStatus('Chọn ít nhất một nhóm hoặc Page để AI tạo biến thể theo nơi đăng.');
      return;
    }
    setGenerating(true);
    setLocalStatus('');
    try {
      const res = await api('/api/ai/caption-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: base,
          targets: selectedTargets.map((target) => ({ id: target.id, name: target.name, type: target.type })),
        }),
        timeoutMs: AI_TIMEOUT_MS,
      });
      const payload = await readPayload(res);
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'AI chưa tạo được biến thể');
      const next: Record<string, string> = {};
      safeList<{ id?: string; type?: string; caption?: string }>(payload.captions).forEach((item) => {
        const type = item.type === 'page' ? 'page' : 'group';
        if (item.id && item.caption) next[`${type}:${item.id}`] = item.caption;
      });
      setCaptionVariants(next);
      setLocalStatus(`Đã tạo ${Object.keys(next).length} biến thể nội dung.${payload.warning ? ` ${payload.warning}` : ''}`);
    } catch (err: any) {
      setLocalStatus(`Lỗi AI viết bài: ${err?.message || 'Không tạo được biến thể'}`);
    } finally {
      setGenerating(false);
    }
  }

  async function publishNow() {
    const baseMessage = buildMessage();
    if (!baseMessage) {
      setLocalStatus('Nhập nội dung bài viết trước khi đăng.');
      return;
    }
    if (!selectedTargets.length) {
      setLocalStatus('Chọn ít nhất một nhóm hoặc Page để đăng.');
      return;
    }
    setPublishing(true);
    setLocalStatus(`Đang đăng tới ${selectedTargets.length} nơi...`);
    try {
      // Tự động phát hiện video URL để gửi native_video_url thay vì link preview
      const mediaUrls = postMedia.map((item) => item.url).filter(Boolean);
      const detectedMedia = detectVideoMedia(mediaUrl);
      const body = {
        message: baseMessage,
        media_url: mediaUrls.length ? '' : detectedMedia.mediaUrl,
        native_video_url: mediaUrls.length ? '' : detectedMedia.nativeVideoUrl,
        media_urls: mediaUrls,
        targets: selectedTargets.map((t) => ({ type: t.type, id: t.id, name: t.name })),
      };
      const res = await api('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: PUBLISH_TIMEOUT_MS,
      });
      const payload = await readPayload(res);

      if (payload.results) {
        const results: PublishResult[] = payload.results.map((r: any) => ({
          ok: !!r.ok,
          target: { type: r.type || 'group', id: r.id || '', name: r.name || '' },
          post_id: r.post_id,
          error: r.error,
        }));
        const okCount = results.filter((item) => item.ok).length;
        const failCount = results.length - okCount;
        const errorLines = results
          .filter((item) => !item.ok)
          .map((item) => `${item.target.name || item.target.id}: ${item.error || 'Lỗi không xác định'}`);
        appendHistory({
          title,
          content,
          mediaUrl,
          mediaUrls,
          hashtags,
          scheduledAt: '',
          targets: selectedTargets,
          status: failCount ? `Đã đăng ${okCount}, lỗi ${failCount}` : 'Đã đăng',
          results,
        });
        setLocalStatus(
          failCount
            ? `Đã đăng ${okCount}/${results.length} nơi, lỗi ${failCount}. ${errorLines.join(' · ')}`
            : `Đã đăng ${okCount}/${results.length} nơi.`
        );
      } else {
        setLocalStatus(payload.error || 'Lỗi không xác định từ server.');
      }
    } catch (err: unknown) {
      setLocalStatus(`Lỗi kết nối: ${formatFetchError(err)}`);
    } finally {
      setPublishing(false);
      void onReload();
    }
  }

  async function scheduleDraft() {
    const message = buildMessage();
    if (!message || !title.trim() || !content.trim()) {
      setLocalStatus('Nhập đủ tiêu đề và nội dung bài viết trước khi đặt lịch.');
      return;
    }
    if (!scheduledAt) {
      setLocalStatus('Chọn ngày giờ cần đăng.');
      return;
    }
    if (!selectedTargets.length) {
      setLocalStatus('Chọn ít nhất một nhóm hoặc Page để đặt lịch.');
      return;
    }
    setPublishing(true);
    setLocalStatus('Đang lưu lịch đăng lên backend...');
    try {
      const mediaUrls = postMedia.map((item) => item.url).filter(Boolean);
      const detectedMedia = detectVideoMedia(mediaUrl);
      const res = await api('/api/content-pipeline/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          media_url: mediaUrls.length ? '' : detectedMedia.mediaUrl,
          native_video_url: mediaUrls.length ? '' : detectedMedia.nativeVideoUrl,
          media_urls: mediaUrls,
          hashtags,
          scheduled_at: scheduledAt,
          targets: selectedTargets.map((t) => ({ type: t.type, id: t.id, name: t.name })),
          status: 'scheduled',
        }),
        timeoutMs: 60000,
      });
      const payload = await readPayload(res);
      if (!res.ok || !payload.ok) throw new Error(payload.error || 'Không lưu được lịch đăng');
      appendHistory({ title, content, mediaUrl, mediaUrls, hashtags, scheduledAt, targets: selectedTargets, status: 'Đã lưu lịch' });
      setLocalStatus('Đã lưu lịch đăng lên backend. Cron/worker có thể gọi /api/content-pipeline/scheduled/run để tự đăng khi tới giờ.');
      void onReload();
    } catch (err: unknown) {
      setLocalStatus(`Lỗi đặt lịch: ${formatFetchError(err)}`);
    } finally {
      setPublishing(false);
    }
  }

  async function uploadImageFile(files?: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (postMedia.length + selected.length > 10) {
      setLocalStatus('Tối đa 10 file cho một bài đăng.');
      return;
    }
    setUploadingImage(true);
    setLocalStatus(`Đang upload ${selected.length} file ảnh/video...`);
    try {
      const form = new FormData();
      selected.forEach((file) => form.append('media', file));
      const res = await api('/api/uploads/post-media', { method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
      const payload = await readPayload(res);
      if (!res.ok || !payload.ok || !Array.isArray(payload.media)) throw new Error(payload.error || 'Không upload được ảnh/video');
      const uploaded: PostMediaItem[] = payload.media.map((item: PostMediaItem) => ({
        url: item.url,
        type: item.type === 'video' ? 'video' : 'image',
        name: item.name || '',
      }));
      setPostMedia((prev) => [...prev, ...uploaded].slice(0, 10));
      setLocalStatus('Đã upload media. Bấm Đăng ngay để đăng ảnh/video thật lên Facebook.');
    } catch (err: unknown) {
      setLocalStatus(`Lỗi upload ảnh/video: ${formatFetchError(err)}`);
    } finally {
      setUploadingImage(false);
    }
  }

  function checkLinks() {
    if (postMedia.length) {
      setLocalStatus(`Đã có ${postMedia.length} media upload từ máy. Khi đăng, Facebook sẽ nhận dạng ảnh/video thật, không phải link preview.`);
      return;
    }
    const url = mediaUrl.trim();
    if (!url) {
      setLocalStatus('Chưa nhập link ảnh/video để kiểm tra.');
      return;
    }
    try {
      const parsed = new URL(url);
      const isVideo = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(parsed.pathname) || /youtube|youtu\.be|tiktok|facebook|fb\.watch|fb\.gg|reel|short/i.test(parsed.hostname);
      setLocalStatus(
        isVideo
          ? 'Link video hợp lệ. Hệ thống sẽ tự động đăng native video nếu backend có quyền upload; nếu không sẽ fallback link preview.'
          : 'Link hợp lệ. Khi đăng link dán tay, Facebook sẽ hiển thị dạng link preview.'
      );
    } catch {
      setLocalStatus('Link ảnh/video chưa đúng định dạng URL.');
    }
  }

  const targetCount = selectedTargets.length;
  const previewAuthor = selectedTargets[0]?.name || 'Seeding Fsolution';
  const previewHint = selectedTargets[0]
    ? (selectedTargets[0].type === 'page' ? 'Facebook Page' : 'Facebook Group')
    : 'Facebook';

  return (
    <section className="module-panel marketing-panel seeding-studio">
      <div className="module-head">
        <div>
          <div className="module-kicker">Bài viết</div>
          <h2>Bài viết chuẩn</h2>
          <p className="module-subline">
            Đồng bộ theo khung đối tác: tiêu đề, nội dung, ảnh/video thật, lịch đăng và chọn nơi đăng trong một màn hình.
          </p>
        </div>
        <div className="module-actions">
          <button type="button" className="btn-cancel" disabled={loadingTargets || busy} onClick={() => void loadTargets()}>
            {loadingTargets ? 'Đang tải...' : 'Tải nhóm/Page'}
          </button>
          <button type="button" className="btn-cancel" disabled={busy} onClick={() => void onReload()}>
            Tải lịch sử
          </button>
        </div>
      </div>

      <div className="seeding-layout">
        <div className="seeding-compose-card">
          <div className="seeding-section-title">📄 Bài viết chuẩn</div>

          <div className="seeding-compose-split">
            <div className="seeding-compose-form">
          <label className="seeding-field">
            <span>Tiêu đề bài viết</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="VD: Review đàn guitar acoustic tầm 3 triệu"
            />
          </label>

          <label className="seeding-field">
            <span>Nội dung</span>
            <textarea
              className="seeding-textarea"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Nội dung bài đăng..."
            />
          </label>

          <label className="seeding-field">
            <span>Ảnh/video từ máy hoặc link preview</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
              multiple
              disabled={uploadingImage}
              onChange={(event) => {
                void uploadImageFile(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            <input
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              placeholder="Dán YouTube/TikTok/link nếu muốn đăng dạng link preview"
            />
            {postMedia.length ? (
              <div className="post-media-grid">
                {postMedia.map((item, idx) => (
                  <div className="post-media-item" key={`${item.url}-${idx}`}>
                    {item.type === 'video' ? <video src={item.url} muted controls /> : <img src={item.url} alt="" />}
                    <button
                      type="button"
                      aria-label="Xoá media"
                      disabled={publishing}
                      onClick={() => setPostMedia((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {mediaUrl ? <small className="seeding-media-hint">Link preview hiện tại: <a href={mediaUrl} target="_blank" rel="noreferrer">Mở link</a></small> : null}
          </label>

          <div className="seeding-form-grid">
            <label className="seeding-field">
              <span>Đặt lịch đăng</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            <label className="seeding-field">
              <span>Hashtags</span>
              <input
                value={hashtags}
                onChange={(event) => setHashtags(event.target.value)}
                placeholder="#guitar #guitarsaithanh"
              />
            </label>
          </div>

          <div className="seeding-toolbar">
            <button type="button" className="btn-submit" disabled={publishing} onClick={() => void publishNow()}>
              {publishing ? 'Đang đăng...' : '📣 Đăng ngay'}
            </button>
            <button type="button" className="btn-cancel" disabled={publishing} onClick={() => void scheduleDraft()}>
              ⏰ Đặt lịch
            </button>
            <button type="button" className="btn-cancel" disabled={generating || !targetCount} onClick={() => void generatePostCaptions()}>
              {generating ? 'AI đang viết...' : '🤖 AI viết bài'}
            </button>
            <button type="button" className="btn-cancel" onClick={checkLinks}>
              🔗 Check links
            </button>
          </div>

          {Object.keys(captionVariants).length ? (
            <div className="seeding-caption-variants">
              <div className="seeding-section-title">Biến thể nội dung theo từng nơi đăng</div>
              {selectedTargets.map((target) => (
                <label key={targetKey(target)} className="caption-variant-card">
                  <span>{target.type === 'page' ? 'Page' : 'Nhóm'} · {target.name}</span>
                  <textarea
                    value={captionVariants[targetKey(target)] || ''}
                    onChange={(event) => setCaptionVariants((prev) => ({
                      ...prev,
                      [targetKey(target)]: event.target.value,
                    }))}
                    placeholder="AI sẽ tạo caption riêng cho nơi đăng này"
                  />
                </label>
              ))}
            </div>
          ) : null}
            </div>

            <aside className="seeding-compose-preview">
              <PostPublishPreview
                authorName={previewAuthor}
                authorHint={previewHint}
                title={title}
                content={content}
                hashtags={hashtags}
                mediaUrl={mediaUrl}
                postMedia={postMedia}
                scheduledAt={scheduledAt}
              />
            </aside>
          </div>
        </div>

        <aside className="seeding-target-card">
          <div className="seeding-target-head">
            <div>
              <b>Chọn nhóm/Page để đăng</b>
              <span>{targetCount} nơi đang chọn</span>
            </div>
            <div className="seeding-target-actions">
              <button type="button" onClick={() => setAllTargets(true)}>Tất cả</button>
              <button type="button" onClick={() => setAllTargets(false)}>Bỏ chọn</button>
            </div>
          </div>

          <div className="seeding-target-list">
            {groups.map((group) => (
              <label key={`group-${group.id}`} className="seeding-target-row">
                <input
                  type="checkbox"
                  checked={!!selectedGroups[group.id]}
                  onChange={(event) => setSelectedGroups((prev) => ({ ...prev, [group.id]: event.target.checked }))}
                />
                <span>
                  <b>{group.name || group.id}</b>
                  <small>Facebook Group</small>
                </span>
              </label>
            ))}
            {pages.map((page) => (
              <label key={`page-${page.id}`} className="seeding-target-row">
                <input
                  type="checkbox"
                  checked={!!selectedPages[page.id]}
                  onChange={(event) => setSelectedPages((prev) => ({ ...prev, [page.id]: event.target.checked }))}
                />
                <span>
                  <b>{page.name || page.id}</b>
                  <small>Facebook Page</small>
                </span>
              </label>
            ))}
            {loadingTargets && !groups.length && !pages.length ? (
              <div className="seeding-empty-target">Đang tải nhóm/Page...</div>
            ) : null}
            {!loadingTargets && !groups.length && !pages.length ? (
              <div className="seeding-empty-target">
                Chưa có nhóm/Page trong DB. Vào mục <b>Kênh</b> để thêm nhóm/Page, rồi bấm Tải nhóm/Page.
              </div>
            ) : null}
          </div>

          <div className="target-note">
            File ảnh/video upload từ máy sẽ đăng dạng media thật; link YouTube/TikTok hoặc link dán tay sẽ đăng dạng link preview.
          </div>
        </aside>
      </div>

      <div className="seeding-history">
        <div className="seeding-section-title">📋 Lịch sử đăng bài</div>
        <div className="data-table-wrap">
          <table className="data-table seeding-history-table">
            <thead>
              <tr>
                <th>Tiêu đề</th>
                <th>Nội dung</th>
                <th>Link ảnh/video</th>
                <th>Lịch đăng</th>
                <th>Nơi đăng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {visibleHistory.length ? visibleHistory.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.title || 'Bài đăng'}</b>
                    <small>{formatDateTime(row.createdAt)}</small>
                  </td>
                  <td>{row.content || '-'}</td>
                  <td>
                    {row.mediaUrls?.length
                      ? `${row.mediaUrls.length} media`
                      : row.mediaUrl ? <a href={row.mediaUrl} target="_blank" rel="noreferrer">Mở link</a> : '-'}
                  </td>
                  <td>{formatDateTime(row.scheduledAt)}</td>
                  <td>{row.targets.length ? row.targets.map((target) => target.name).join(', ') : '-'}</td>
                  <td>
                    <span className={row.status.includes('lỗi') || row.status.includes('failed') ? 'pill-danger' : 'pill-ok'}>
                      {row.status}
                    </span>
                    {row.results?.some((item) => !item.ok) ? (
                      <small className="publish-error-detail">
                        {row.results.filter((item) => !item.ok).map((item) => `${item.target.name}: ${item.error || 'lỗi'}`).join(' · ')}
                      </small>
                    ) : null}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="table-empty">Chưa có bài đăng nào</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="seeding-status-line">{localStatus || status}</div>
    </section>
  );
}
