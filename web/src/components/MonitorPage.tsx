'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthPanel } from '@/components/AuthPanel';
import { ChannelManagerPanel } from '@/components/ChannelManagerPanel';
import { CommentLeadInboxPanel } from '@/components/CommentLeadInboxPanel';
import { ConsoleHome } from '@/components/ConsoleHome';
import { HistoryPanel } from '@/components/HistoryPanel';
import { LeadManagerPanel } from '@/components/LeadManagerPanel';
import { ManageDashboardPanel } from '@/components/ManageDashboardPanel';
import { MarketingPipelinePanel } from '@/components/MarketingPipelinePanel';
import { ScriptWriterPanel } from '@/components/ScriptWriterPanel';
import '@/components/standard-post-panel.css';
import { StaffCookiePanel, type StaffPayload } from '@/components/StaffCookiePanel';
import { api } from '@/lib/api';
import { LEGACY_PATH_REDIRECTS, pathToView, viewToPath, type ViewKey } from '@/lib/app-routes';
import { CONSOLE_NAV_ITEMS } from '@/lib/console-nav';
import { ConsoleRail } from '@/components/ConsoleRail';
import type {
  CommentLog,
  CommentSummary,
  ContentPipelineArticle,
  ContentPipelinePost,
  FbPage,
  FbPost,
  GroupRow,
  Lead,
  ManagedChannel,
  StaffAccount,
  StoredPostComment,
  TikTokCommentStat,
} from '@/lib/types';
import { CommentAuthorLink } from '@/components/CommentAuthorLink';
import { classifyFacebookFeedError, extractSlug } from '@/lib/utils';

type AiProviders = Record<string, { default_model?: string }>;
type AiConfig = {
  provider?: string;
  model?: string;
  keys_masked?: Record<string, string>;
  auto_classify?: boolean;
};

type JoinPrompt = { id: string; name: string };
type PostMediaItem = { url: string; type?: 'image' | 'video'; name?: string };
type ContentPipelineData = {
  articles?: ContentPipelineArticle[];
  posts?: ContentPipelinePost[];
  stats?: { sources?: number; articles?: number; new_articles?: number; draft_posts?: number };
};
type TikTokCookieConfig = {
  has_cookie?: boolean;
  has_login_cookie?: boolean;
  cookie_masked?: string;
  source?: string;
  updated_at?: string;
  updated_by?: string;
  can_manage?: boolean;
};

type TikTokBridgeResult = {
  ok?: boolean;
  final?: boolean;
  error?: string;
  message?: string;
  comment_id?: string;
  post_id?: string;
  post_url?: string;
  url?: string;
  version?: string;
  manual?: boolean;
  method?: string;
  fallback_allowed?: boolean;
  warning?: string;
};
type PostFetchReport = {
  group_id?: string;
  target_type?: 'group' | 'page' | string;
  target_id?: string;
  group_name?: string;
  ok?: boolean;
  count?: number;
  source?: string;
  error?: string;
};

export function MonitorPage() {
  const [groups, setGroups] = useState<string[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInp, setKwInp] = useState('');
  const [tgIds, setTgIds] = useState<string[]>([]);
  const [tgInp, setTgInp] = useState('');
  const [tgStatus, setTgStatus] = useState('');
  const [pages, setPages] = useState<FbPage[]>([]);
  const [allPosts, setAllPosts] = useState<FbPost[]>([]);
  const [classifications, setClassifications] = useState<Record<string, string>>({});
  const [leads, setLeads] = useState<Record<string, Lead[]>>({});
  const [commentSummaries, setCommentSummaries] = useState<Record<string, CommentSummary>>({});
  const [leadsBusy, setLeadsBusy] = useState(false);
  const [aiProviders, setAiProviders] = useState<AiProviders>({});
  const [aiConfig, setAiConfig] = useState<AiConfig>({});
  const [aiProvider, setAiProvider] = useState('gemini');
  const [aiAutoClassify, setAiAutoClassify] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiKeyEdit, setAiKeyEdit] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authStatus, setAuthStatus] = useState('');
  const [currentStaff, setCurrentStaff] = useState<StaffAccount | null>(null);
  const [staffRows, setStaffRows] = useState<StaffAccount[]>([]);
  const [canManageStaff, setCanManageStaff] = useState(false);
  const [staffStatus, setStaffStatus] = useState('');
  const [activeView, setActiveView] = useState<ViewKey>('home');
  const pathname = usePathname();
  const router = useRouter();

  const openView = useCallback((view: ViewKey) => {
    const nextPath = viewToPath(view);
    if (pathname !== nextPath) router.push(nextPath);
    setActiveView(view);
  }, [pathname, router]);

  useEffect(() => {
    const normalized = pathname.replace(/\/$/, '') || '/';
    const legacyTarget = LEGACY_PATH_REDIRECTS[normalized];
    if (legacyTarget) {
      router.replace(legacyTarget);
      return;
    }
    setActiveView(pathToView(pathname));
  }, [pathname, router]);
  const [channels, setChannels] = useState<ManagedChannel[]>([]);
  const [channelStatus, setChannelStatus] = useState('');
  const [channelBusy, setChannelBusy] = useState(false);
  const [pipelineData, setPipelineData] = useState<ContentPipelineData>({});
  const [pipelineStatus, setPipelineStatus] = useState('');
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [commentLogs, setCommentLogs] = useState<CommentLog[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [todayCommentCount, setTodayCommentCount] = useState<number | null>(null);

  const [limit, setLimit] = useState(10);
  const [intervalMin, setIntervalMin] = useState(5);
  const [autoOn, setAutoOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [postFetchReport, setPostFetchReport] = useState<PostFetchReport[]>([]);
  const [toolStatus, setToolStatus] = useState('');
  const statusBaseRef = useRef('');
  const [headerSub, setHeaderSub] = useState('Đang tải...');

  const [catFilter, setCatFilter] = useState('');
  const [groupInp, setGroupInp] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [joinPrompt, setJoinPrompt] = useState<JoinPrompt | null>(null);
  const [joinMsg, setJoinMsg] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState('');
  const [groupMembership, setGroupMembership] = useState<Record<string, boolean | null>>({});
  const [membershipCheckingIds, setMembershipCheckingIds] = useState<string[]>([]);

  const [postModal, setPostModal] = useState(false);
  const [postSelected, setPostSelected] = useState<Record<string, boolean>>({});
  const [postPageId, setPostPageId] = useState('');
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [postMedia, setPostMedia] = useState<PostMediaItem[]>([]);
  const [postUploadingMedia, setPostUploadingMedia] = useState(false);
  const [postSchedule, setPostSchedule] = useState('');
  const [postCaptions, setPostCaptions] = useState<Record<string, string>>({});
  const [postResult, setPostResult] = useState('');
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postCaptionBusy, setPostCaptionBusy] = useState(false);

  const [fbCommentModalPost, setFbCommentModalPost] = useState<FbPost | null>(null);
  const [fbCommentKeywords, setFbCommentKeywords] = useState('quan tâm, đặt hàng, sđt, địa chỉ, ib, giá');
  const [fbCommentRows, setFbCommentRows] = useState<StoredPostComment[]>([]);
  const [fbCommentStatus, setFbCommentStatus] = useState('');
  const [fbCommentBusy, setFbCommentBusy] = useState(false);

  const [tiktokModal, setTiktokModal] = useState(false);
  const [tiktokMode, setTiktokMode] = useState<'channel' | 'video' | 'managed'>('managed');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [tiktokManagedChannelId, setTiktokManagedChannelId] = useState('');
  const [tiktokMaxVideos, setTiktokMaxVideos] = useState(8);
  const [tiktokLimitPerVideo, setTiktokLimitPerVideo] = useState(150);
  const [tiktokChannelName, setTiktokChannelName] = useState('');
  const [tiktokVideoTitle, setTiktokVideoTitle] = useState('');
  const [tiktokKeywords, setTiktokKeywords] = useState('quan tâm, đặt hàng, sđt, địa chỉ, ib, giá');
  const [tiktokRows, setTiktokRows] = useState<StoredPostComment[]>([]);
  const [tiktokStatus, setTiktokStatus] = useState('');
  const [tiktokBusy, setTiktokBusy] = useState(false);
  const [tiktokStatsModal, setTiktokStatsModal] = useState(false);
  const [tiktokStats, setTiktokStats] = useState<TikTokCommentStat[]>([]);
  const [tiktokStatsStatus, setTiktokStatsStatus] = useState('');
  const [tiktokStatsBusy, setTiktokStatsBusy] = useState(false);
  const [tiktokSelectedPostId, setTiktokSelectedPostId] = useState('');
  const [tiktokOnlyPhone, setTiktokOnlyPhone] = useState(false);
  const [tiktokCommentText, setTiktokCommentText] = useState('');
  const [tiktokCommentStatus, setTiktokCommentStatus] = useState('');
  const [tiktokCommentBusy, setTiktokCommentBusy] = useState(false);
  const [tiktokCookieConfig, setTiktokCookieConfig] = useState<TikTokCookieConfig>({});
  const [tiktokCookieInput, setTiktokCookieInput] = useState('');
  const [tiktokCookieStatus, setTiktokCookieStatus] = useState('');
  const [tiktokCookieBusy, setTiktokCookieBusy] = useState(false);
  const [tiktokBridgeReady, setTiktokBridgeReady] = useState(false);
  const [tiktokBridgeVersion, setTiktokBridgeVersion] = useState('');

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [classifyBusy, setClassifyBusy] = useState(false);

  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupsRef = useRef<string[]>([]);
  const channelsRef = useRef<ManagedChannel[]>([]);
  const limitRef = useRef(10);
  const autoOnRef = useRef(false);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);
  useEffect(() => {
    limitRef.current = limit;
  }, [limit]);
  useEffect(() => {
    autoOnRef.current = autoOn;
  }, [autoOn]);

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
          requestId: `ping_${Date.now()}`,
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

  const checkAuth = useCallback(async () => {
    try {
      const r = await api('/api/auth/status');
      const d = await r.json();
      setSetupRequired(!!d.setup_required && !d.simple_login);
      setAuthenticated(!!d.authenticated);
      setCurrentStaff(d.staff || null);
      setAuthStatus('');
    } catch (err: unknown) {
      setSetupRequired(false);
      setAuthenticated(false);
      setCurrentStaff(null);
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setAuthStatus(
        aborted
          ? 'Backend không phản hồi. Hãy chạy Flask (port 5000) rồi tải lại trang.'
          : 'Không kết nối được server',
      );
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const loadStaffCookies = useCallback(async () => {
    try {
      const r = await api('/api/staff-cookies');
      const d = await r.json();
      setStaffRows(d.staff || []);
      setCanManageStaff(!!d.can_manage);
      if (d.warning) setStaffStatus(`⚠️ ${d.warning}`);
    } catch {
      setStaffStatus('Không tải được cookie nhân sự');
    }
  }, []);

  const loadTiktokCookieConfig = useCallback(async () => {
    try {
      const r = await api('/api/tiktok/config');
      const d = await r.json();
      if (d.ok) {
        setTiktokCookieConfig(d.config || {});
        setTiktokCookieStatus('');
      } else {
        setTiktokCookieStatus('Không tải được TikTok cookie');
      }
    } catch {
      setTiktokCookieStatus('Không kết nối được backend khi tải TikTok cookie');
    }
  }, []);

  const loadChannels = useCallback(async () => {
    try {
      const r = await api('/api/channels');
      const d = await r.json();
      if (d.ok) {
        const rows = d.channels || [];
        channelsRef.current = rows;
        setChannels(rows);
        setChannelStatus('');
        return rows as ManagedChannel[];
      } else {
        setChannelStatus('❌ ' + (d.error || 'Không tải được danh sách kênh'));
      }
    } catch {
      setChannelStatus('❌ Lỗi kết nối khi tải kênh');
    }
    return [] as ManagedChannel[];
  }, []);

  const loadContentPipeline = useCallback(async () => {
    setPipelineBusy(true);
    setPipelineStatus('Đang tải lịch sử bài viết...');
    try {
      const r = await api('/api/content-pipeline');
      const d = await r.json();
      if (d.ok) {
        const postCount = Array.isArray(d.posts) ? d.posts.length : 0;
        setPipelineData({ articles: d.articles || [], posts: d.posts || [], stats: d.stats || {} });
        setPipelineStatus(postCount ? `Đã tải ${postCount} bản ghi lịch sử.` : '');
      } else if (d.auth_required) {
        setPipelineStatus('❌ Phiên đăng nhập hết hạn. Hãy đăng nhập lại.');
      } else {
        setPipelineStatus('❌ ' + (d.error || 'Không tải được pipeline content'));
      }
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setPipelineStatus(
        aborted
          ? '❌ Backend không phản hồi khi tải lịch sử. Kiểm tra Flask (port 5000).'
          : '❌ Lỗi kết nối khi tải pipeline content',
      );
    } finally {
      setPipelineBusy(false);
    }
  }, []);

  const runContentPipelineResearch = useCallback(async (sourceFilter: string) => {
    setPipelineBusy(true);
    setPipelineStatus('Đang lấy dữ liệu thật từ nguồn RSS...');
    try {
      const r = await api('/api/content-pipeline/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_filter: sourceFilter }),
      });
      const d = await r.json();
      if (d.ok) {
        setPipelineStatus(`✅ Đã thêm ${d.added || 0} tin mới.${d.warning ? ` Lưu ý: ${d.warning}` : ''}`);
        await loadContentPipeline();
      } else {
        setPipelineStatus('❌ ' + (d.error || 'Không scan được dữ liệu'));
      }
    } catch {
      setPipelineStatus('❌ Lỗi kết nối khi scan content');
    } finally {
      setPipelineBusy(false);
    }
  }, [loadContentPipeline]);

  const saveChannel = useCallback(async (payload: {
    platform: string;
    channel_name: string;
    channel_type: string;
    link: string;
    target_id: string;
    note: string;
  }, id?: string) => {
    if (!payload.platform.trim() || !payload.channel_name.trim()) {
      setChannelStatus('Nhập đủ nền tảng và tên kênh');
      return false;
    }
    setChannelBusy(true);
    setChannelStatus(id ? 'Đang cập nhật kênh...' : 'Đang thêm kênh...');
    try {
      const r = await api(id ? `/api/channels/${id}` : '/api/channels', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (d.ok) {
        const rows = d.channels || [];
        channelsRef.current = rows;
        setChannels(rows);
        setChannelStatus(id ? '✅ Đã cập nhật kênh' : '✅ Đã thêm kênh');
        const saved = d.channel || payload;
        if ((saved.platform || '').toLowerCase() === 'facebook' && ['Nhóm', 'Nhom', 'Group'].includes(saved.channel_type || '') && saved.target_id) {
          setGroups((prev) => (prev.includes(saved.target_id) ? prev : [...prev, saved.target_id]));
          setGroupNames((prev) => ({ ...prev, [saved.target_id]: saved.channel_name || saved.target_id }));
        }
        return true;
      }
      setChannelStatus('❌ ' + (d.error || 'Không lưu được kênh'));
      return false;
    } catch {
      setChannelStatus('❌ Lỗi kết nối khi lưu kênh');
      return false;
    } finally {
      setChannelBusy(false);
    }
  }, []);

  const deleteChannel = useCallback(async (id: string) => {
    if (!confirm('Xoá kênh này?')) return;
    setChannelStatus('Đang xoá kênh...');
    try {
      const r = await api(`/api/channels/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.ok) {
        const rows = d.channels || [];
        channelsRef.current = rows;
        setChannels(rows);
        setChannelStatus('✅ Đã xoá kênh');
      } else {
        setChannelStatus('❌ ' + (d.error || 'Không xoá được kênh'));
      }
    } catch {
      setChannelStatus('❌ Lỗi kết nối khi xoá kênh');
    }
  }, []);

  const loadGroupMembership = useCallback(async (gIds: string[]) => {
    const ids = [...new Set(gIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return;
    setMembershipCheckingIds((prev) => [...new Set([...prev, ...ids])]);
    try {
      const r = await api(`/api/group-membership?ids=${encodeURIComponent(ids.join(','))}`, {
        timeoutMs: 120000,
      });
      const d = await r.json();
      if (d.ok && d.membership && typeof d.membership === 'object') {
        setGroupMembership((prev) => ({ ...prev, ...d.membership }));
      }
    } catch {
      /* ignore */
    } finally {
      setMembershipCheckingIds((prev) => prev.filter((id) => !ids.includes(id)));
    }
  }, []);

  const syncFacebookPages = useCallback(async () => {
    setChannelBusy(true);
    setChannelStatus('Đang đồng bộ Page Facebook từ cookie hiện tại...');
    try {
      const r = await api('/api/channels/sync-facebook-pages', { method: 'POST' });
      const d = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (d.ok) {
        const rows = Array.isArray(d.channels) ? d.channels : [];
        channelsRef.current = rows;
        setChannels(rows);
        setChannelStatus(`✅ Đã đồng bộ Page Facebook: thêm ${d.added || 0}, cập nhật ${d.updated || 0}`);
      } else {
        setChannelStatus('❌ ' + (d.error || 'Không đồng bộ được Page Facebook'));
      }
    } catch {
      setChannelStatus('❌ Lỗi kết nối khi đồng bộ Page Facebook');
    } finally {
      setChannelBusy(false);
    }
  }, []);

  const loadCommentLogs = useCallback(async () => {
    setHistoryStatus('Đang tải lịch sử...');
    try {
      const r = await api('/api/comment-logs');
      const d = await r.json();
      setCommentLogs(Array.isArray(d) ? d.reverse() : []);
      setHistoryStatus('');
    } catch {
      setHistoryStatus('Không tải được lịch sử thao tác');
    }
  }, []);

  const loadTodayCommentStats = useCallback(async () => {
    try {
      const r = await api('/api/comment-stats/today');
      const d = await r.json();
      if (d.ok) setTodayCommentCount(d.success_count ?? 0);
    } catch {
      setTodayCommentCount(null);
    }
  }, []);

  const handleCommentSent = useCallback(async (postId: string) => {
    await loadTodayCommentStats();
    if (postId) {
      setAllPosts((prev) => prev.filter((p) => p.id !== postId));
    }
  }, [loadTodayCommentStats]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const loadPages = useCallback(async () => {
    try {
      const r = await api('/api/pages');
      const d = await r.json();
      if (Array.isArray(d)) setPages(d);
    } catch {
      /* ignore */
    }
  }, []);

  const loadGroupName = useCallback(async (gid: string) => {
    try {
      const r = await api('/api/groups/resolve?slug=' + encodeURIComponent(gid));
      const d = await r.json();
      if (d.ok && d.name) {
        setGroupNames((prev) => ({ ...prev, [gid]: d.name }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadTg = useCallback(async () => {
    try {
      const r = await api('/api/telegram/chatids');
      setTgIds(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  const loadPosts = useCallback(async (): Promise<FbPost[] | null> => {
    const gids = groupsRef.current;
    const pageIds = channelsRef.current
      .filter((item) => (item.platform || '').toLowerCase() === 'facebook')
      .filter((item) => ['page', 'fanpage', 'trang'].includes((item.channel_type || '').trim().toLowerCase()))
      .map((item) => item.target_id || '')
      .filter(Boolean);
    const lim = limitRef.current;
    if (!gids.length && !pageIds.length) return null;
    setLoading(true);
    setFeedError('');
    setPostFetchReport([]);
    setToolStatus('Đang tải...');
    try {
      const params = new URLSearchParams({
        debug: '1',
        limit: String(lim),
        groups: gids.join(','),
        pages: pageIds.join(','),
      });
      const res = await api(`/api/posts?${params.toString()}`, { timeoutMs: 120000 });
      const data = await res.json();
      if (!res.ok || data.error) {
        setPostFetchReport(Array.isArray(data.report) ? data.report : []);
        const msg =
          data.error ||
          (res.status === 401
            ? 'Cookie/token Facebook hết hạn hoặc nhân sự chưa có quyền đọc nhóm'
            : `Lỗi tải bài (${res.status})`);
        setAllPosts([]);
        setFeedError(msg);
        const errKind = classifyFacebookFeedError(msg);
        setToolStatus(
          errKind === 'network'
            ? 'Lỗi mạng/DNS Facebook'
            : data.ok === false
              ? 'Không đọc được Facebook'
              : 'Lỗi xác thực',
        );
        statusBaseRef.current = '';
        return null;
      }
      const rows: FbPost[] = Array.isArray(data) ? data : data.posts || [];
      const report: PostFetchReport[] = Array.isArray(data.report) ? data.report : [];
      setPostFetchReport(report);
      setAllPosts(rows);
      const now = new Date().toLocaleTimeString('vi-VN');
      let known: string[] = [];
      try {
        known = JSON.parse(typeof window !== 'undefined' ? localStorage.getItem('seenIds') || '[]' : '[]');
      } catch {
        known = [];
      }
      const knownSet = new Set(known);
      const fresh = rows.filter((p: FbPost) => !knownSet.has(p.id));
      rows.forEach((p: FbPost) => knownSet.add(p.id));
      const nextKnown = [...knownSet].slice(-500);
      if (typeof window !== 'undefined') localStorage.setItem('seenIds', JSON.stringify(nextKnown));
      const okTargets = report.filter((item) => item.ok).length;
      const failedTargets = report.filter((item) => !item.ok).length;
      const pageCount = report.filter((item) => item.target_type === 'page').length;
      const groupCount = report.filter((item) => item.target_type !== 'page').length;
      const targetText = [groupCount ? `${groupCount} nhóm` : '', pageCount ? `${pageCount} page` : ''].filter(Boolean).join(', ');
      const reportText = report.length ? ` · Facebook thật · ${okTargets}/${report.length} nguồn đọc được${targetText ? ` (${targetText})` : ''}${failedTargets ? ` · ${failedTargets} nguồn lỗi` : ''}` : '';
      const skippedProcessed = Number(data.skipped_processed || 0);
      const skippedText = skippedProcessed > 0 ? ` · ẩn ${skippedProcessed} bài đã xử lý` : '';
      const base = `${rows.length} bài · ${now}${reportText}${skippedText}`;
      statusBaseRef.current = base;
      const nb = fresh.length && knownSet.size > fresh.length ? ` +${fresh.length} mới` : '';
      setToolStatus(base + nb);
      return rows as FbPost[];
    } catch (err) {
      setAllPosts([]);
      setPostFetchReport([]);
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setFeedError(aborted ? 'Backend không phản hồi kịp (timeout). Thử lại hoặc giảm số nhóm/Page.' : 'Không kết nối được backend. Kiểm tra Flask trên cổng 5000.');
      setToolStatus(aborted ? 'Timeout' : 'Lỗi kết nối');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (groups.length === 1) {
      const n = groupNames[groups[0]!] || groups[0];
      setHeaderSub(n || '...');
    } else {
      const pageCount = channels.filter((item) => (item.platform || '').toLowerCase() === 'facebook' && ['page', 'fanpage', 'trang'].includes((item.channel_type || '').trim().toLowerCase())).length;
      const parts = [groups.length ? `${groups.length} nhóm` : '', pageCount ? `${pageCount} page` : ''].filter(Boolean);
      setHeaderSub(parts.length ? `${parts.join(' · ')} đang theo dõi` : '...');
    }
  }, [channels, groups, groupNames]);

  const matchKw = useCallback(
    (post: FbPost) => {
      if (!keywords.length) return true;
      const hay = `${post.message || ''} ${post.from?.name || ''}`.toLowerCase();
      return keywords.some((k) => hay.includes(k.toLowerCase()));
    },
    [keywords],
  );

  const filteredPosts = allPosts.filter((p) => {
    if (!matchKw(p)) return false;
    if (catFilter && classifications[p.id] !== catFilter) return false;
    return true;
  });

  const catOptions = [...new Set(Object.values(classifications))].sort();

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const sr = await api('/api/settings');
        const s = await sr.json();
        if (!cancelled) {
          setIntervalMin(s.interval || 5);
          setAutoOn(s.auto_refresh ?? true);
        }
      } catch {
        if (!cancelled) setAutoOn(true);
      }

      let autoClassify = false;
      try {
        const [pRes, cRes, clRes, lRes, csRes] = await Promise.all([
          api('/api/ai/providers'),
          api('/api/ai/config'),
          api('/api/ai/classifications'),
          api('/api/ai/leads'),
          api('/api/ai/comment-summaries'),
        ]);
        if (cancelled) return;
        setAiProviders(await pRes.json());
        const cfg = await cRes.json();
        setAiConfig(cfg);
        setAiProvider(cfg.provider || 'gemini');
        autoClassify = !!cfg.auto_classify;
        setAiAutoClassify(autoClassify);
        setClassifications(await clRes.json());
        setLeads(await lRes.json());
        setCommentSummaries(await csRes.json());
      } catch {
        /* ignore */
      }

      let rows: GroupRow[] = [];
      try {
        const r = await api('/api/groups');
        rows = await r.json();
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      const gIds = rows.map((x) => x.id);
      const gn: Record<string, string> = {};
      rows.forEach((row) => {
        if (row.name) gn[row.id] = row.name;
      });
      groupsRef.current = gIds;
      setGroups(gIds);
      setGroupNames((prev) => ({ ...prev, ...gn }));

      await Promise.allSettled(gIds.map((g) => loadGroupName(g)));
      await Promise.allSettled(
        gIds.map((g) =>
          api('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: g, name: gn[g] || '' }),
          }),
        ),
      );
      await loadTg();
      await loadPages();
      await loadStaffCookies();
      await loadTiktokCookieConfig();
      await loadChannels();
      await loadContentPipeline();
      await loadTodayCommentStats();

      const posts = await loadPosts();
      if (cancelled) return;
      if (autoClassify && posts?.length) {
        try {
          const r = await api('/api/ai/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ posts }),
          });
          const d = await r.json();
          if (d.ok && !cancelled) {
            setClassifications((c) => ({ ...c, ...d.classifications }));
          }
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authChecked, authenticated, loadChannels, loadContentPipeline, loadGroupName, loadPages, loadPosts, loadStaffCookies, loadTg, loadTiktokCookieConfig, loadTodayCommentStats]);

  useEffect(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (!autoOn) {
      setToolStatus((t) => statusBaseRef.current || t);
      return;
    }
    const ms = Math.max(1, intervalMin) * 60 * 1000;
    const schedule = () => {
      autoTimerRef.current = setTimeout(() => {
        void loadPosts().finally(() => {
          if (autoOnRef.current) schedule();
        });
      }, ms);
    };
    schedule();
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, [autoOn, intervalMin, loadPosts]);

  function saveSettings(auto: boolean, interval: number) {
    void api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_refresh: auto, interval }),
    });
  }

  function toggleAuto() {
    const next = !autoOn;
    setAutoOn(next);
    saveSettings(next, intervalMin);
    if (!next) setToolStatus(statusBaseRef.current || '');
  }

  function addKw() {
    const v = kwInp.trim();
    if (!v || keywords.includes(v)) {
      setKwInp('');
      return;
    }
    setKeywords((k) => [...k, v]);
    setKwInp('');
  }

  function removeKw(kw: string) {
    setKeywords((k) => k.filter((x) => x !== kw));
  }

  async function addGroup() {
    const raw = groupInp.trim();
    if (!raw) return;
    setGroupInp('');
    setGroupBusy(true);
    const slug = extractSlug(raw);
    const prev = statusBaseRef.current || toolStatus;
    setToolStatus(`🔍 Đang tìm "${slug}"...`);
    try {
      const r = await api('/api/groups/resolve?slug=' + encodeURIComponent(slug));
      const d = await r.json();
      if (d.ok) {
        if (d.name) setGroupNames((g) => ({ ...g, [d.id]: d.name }));
        if (!d.is_member) {
          setToolStatus(prev);
          setJoinPrompt({ id: d.id, name: d.name || d.id });
        } else {
          await api('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: d.id, name: d.name || '' }),
          });
          setGroups((g) => (g.includes(d.id) ? g : [...g, d.id]));
          setToolStatus(`✅ Đã thêm: ${d.name || d.id}`);
          setTimeout(() => setToolStatus(prev), 5000);
        }
      } else {
        if (/^\d{10,}$/.test(slug)) {
          setToolStatus(prev);
          setJoinPrompt({ id: slug, name: slug });
        } else {
          setToolStatus(`❌ Không tìm được: ${d.error}`);
          setTimeout(() => setToolStatus(prev), 4000);
        }
      }
    } catch {
      setToolStatus('❌ Lỗi kết nối');
      setTimeout(() => setToolStatus(prev), 4000);
    }
    setGroupBusy(false);
  }

  async function forceAddGroup(gid: string, gname: string) {
    await api('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: gid, name: gname }),
    });
    setGroups((g) => (g.includes(gid) ? g : [...g, gid]));
    setGroupNames((prev) => ({ ...prev, [gid]: gname }));
    setJoinPrompt(null);
    setJoinMsg('');
  }

  async function joinGroupAct(gid: string, gname: string) {
    setJoiningGroupId(gid);
    setJoinBusy(true);
    setJoinMsg('');
    try {
      const r = await api(`/api/groups/${gid}/join`, { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        if (d.already_member) {
          await api('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: gid, name: gname }),
          });
          setGroups((g) => (g.includes(gid) ? g : [...g, gid]));
          setGroupMembership((prev) => ({ ...prev, [gid]: true }));
          setJoinPrompt(null);
          setJoinMsg('✅ Đã tham gia nhóm');
        } else {
          setJoinMsg('✅ ' + d.msg + ' — Bấm Kiểm tra lại để cập nhật trạng thái.');
        }
        void loadGroupMembership([gid]);
      } else {
        setJoinMsg('❌ ' + (d.error || 'Lỗi không xác định'));
        if (d.manual_required && d.group_url && typeof window !== 'undefined') {
          window.open(String(d.group_url), '_blank', 'noopener,noreferrer');
        }
      }
    } catch {
      setJoinMsg('❌ Lỗi kết nối');
    }
    setJoinBusy(false);
    setJoiningGroupId('');
  }

  async function removeGroup(gid: string) {
    const name = groupNames[gid] || gid;
    if (typeof window !== 'undefined' && !window.confirm(`Xoá nhóm "${name}" khỏi danh sách quét?`)) {
      return;
    }
    const previousGroups = groups;
    const previousNames = groupNames;
    setGroups((g) => g.filter((x) => x !== gid));
    setGroupNames((names) => {
      const next = { ...names };
      delete next[gid];
      return next;
    });
    setGroupMembership((prev) => {
      const next = { ...prev };
      delete next[gid];
      return next;
    });
    try {
      const r = await api(`/api/groups/${gid}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({ ok: r.ok }));
      if (!r.ok || d.error) {
        setGroups(previousGroups);
        setGroupNames(previousNames);
        setToolStatus(`❌ Không xoá được nhóm: ${d.error || `Server lỗi ${r.status}`}`);
        return;
      }
      if (Number(d.removed_channels || 0) > 0) {
        await loadChannels();
      }
      setToolStatus(`✅ Đã xoá nhóm "${name}" khỏi danh sách quét`);
    } catch {
      setGroups(previousGroups);
      setGroupNames(previousNames);
      setToolStatus('❌ Lỗi kết nối khi xoá nhóm');
    }
  }

  async function addTg() {
    const cid = tgInp.trim().replace(/[^0-9-]/g, '');
    if (!cid) return;
    setTgInp('');
    const r = await api('/api/telegram/chatids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cid }),
    });
    const d = await r.json();
    if (d.ok) setTgIds(d.chat_ids);
  }

  async function removeTg(cid: string) {
    const r = await api(`/api/telegram/chatids/${cid}`, { method: 'DELETE' });
    const d = await r.json();
    setTgIds(d.chat_ids);
  }

  async function testTg(cid: string) {
    setTgStatus('⏳ Đang gửi...');
    try {
      const r = await api(`/api/telegram/test/${cid}`, { method: 'POST' });
      const d = await r.json();
      setTgStatus(d.ok ? '✅ Gửi thành công!' : '❌ ' + (d.error || 'Lỗi'));
    } catch {
      setTgStatus('❌ Lỗi kết nối');
    }
    setTimeout(() => setTgStatus(''), 3000);
  }

  function openPostModal() {
    const sel: Record<string, boolean> = {};
    groups.forEach((g) => {
      sel[g] = true;
    });
    setPostSelected(sel);
    setPostPageId('');
    setPostTitle('');
    setPostContent('');
    setPostMedia([]);
    setPostSchedule('');
    setPostCaptions({});
    setPostResult('');
    setPostModal(true);
  }

  async function generatePostCaptions() {
    const selectedGroups = groups.filter((g) => postSelected[g]);
    const message = [postTitle.trim() ? `Tiêu đề: ${postTitle.trim()}` : '', postContent.trim(), postSchedule.trim() ? `Lịch đăng: ${postSchedule.trim()}` : ''].filter(Boolean).join('\n\n');
    if (!message) {
      setPostResult('Nhập nội dung gốc trước khi tạo caption AI');
      return;
    }
    if (!selectedGroups.length) {
      setPostResult('Chọn ít nhất 1 nhóm/page để tạo caption');
      return;
    }
    setPostCaptionBusy(true);
    setPostResult('Đang tạo caption biến thể cho từng nơi đăng...');
    try {
      const targets = selectedGroups.map((id) => ({ id, name: groupNames[id] || id, type: 'group' }));
      const r = await api('/api/ai/caption-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, targets }),
      });
      const d = await r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
      if (d.ok) {
        const next: Record<string, string> = {};
        (d.captions || []).forEach((item: { id?: string; caption?: string }) => {
          if (item.id && item.caption) next[item.id] = item.caption;
        });
        setPostCaptions(next);
        setPostResult(d.warning ? `⚠️ ${d.warning}` : `✅ Đã tạo ${Object.keys(next).length} caption riêng`);
      } else {
        setPostResult(`❌ ${d.error || 'Không tạo được caption AI'}`);
      }
    } catch {
      setPostResult('❌ Lỗi kết nối khi tạo caption AI');
    } finally {
      setPostCaptionBusy(false);
    }
  }

  async function submitPost() {
    const selectedGroups = groups.filter((g) => postSelected[g]);
    const message = [postTitle.trim() ? `Tiêu đề: ${postTitle.trim()}` : '', postContent.trim(), postSchedule.trim() ? `Lịch đăng: ${postSchedule.trim()}` : ''].filter(Boolean).join('\n\n');
    const mediaUrls = postMedia.map((item) => item.url).filter(Boolean);
    if (!postTitle.trim() || !postContent.trim()) { setPostResult('? Nhập đủ Tiêu đề và Nội dung'); return; }
    if (!selectedGroups.length) {
      setPostResult('❌ Chọn ít nhất 1 nhóm');
      return;
    }
    setPostSubmitting(true);
    setPostResult(`⏳ Đang đăng vào ${selectedGroups.length} nhóm...`);
    let ok = 0;
    let fail = 0;
    for (const group_id of selectedGroups) {
      try {
        const r = await api('/api/post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id, page_id: postPageId, message: postCaptions[group_id]?.trim() || message, media_urls: mediaUrls }),
        });
        const d = await r.json();
        if (d.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
      setPostResult(`⏳ Đã đăng ${ok + fail}/${selectedGroups.length} (✅${ok} ❌${fail})`);
    }
    if (fail === 0) {
      setPostResult(`✅ Đăng thành công ${ok}/${selectedGroups.length} nhóm!`);
      setPostTitle('');
      setPostContent('');
      setPostMedia([]);
      setPostSchedule('');
      setTimeout(() => setPostModal(false), 2000);
    } else {
      setPostResult(`✅ ${ok} thành công, ❌ ${fail} thất bại`);
    }
    setPostSubmitting(false);
  }

  async function uploadPostMedia(files?: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (postMedia.length + selected.length > 10) {
      setPostResult('❌ Tối đa 10 file cho một bài đăng');
      return;
    }
    setPostUploadingMedia(true);
    setPostResult(`⏳ Đang upload ${selected.length} file...`);
    try {
      const fd = new FormData();
      selected.forEach((file) => fd.append('media', file));
      const r = await api('/api/uploads/post-media', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.ok) {
        const uploaded: PostMediaItem[] = Array.isArray(d.media)
          ? d.media.map((item: PostMediaItem) => ({
              url: item.url,
              type: item.type === 'video' ? 'video' : 'image',
              name: item.name || '',
            }))
          : (d.media_urls || []).map((url: string) => ({ url, type: 'image' }));
        setPostMedia((prev) => [...prev, ...uploaded].slice(0, 10));
        setPostResult(`✅ Đã upload ${uploaded.length} file`);
      } else {
        setPostResult('❌ ' + (d.error || 'Upload lỗi'));
      }
    } catch {
      setPostResult('❌ Lỗi upload ảnh/video');
    }
    setPostUploadingMedia(false);
  }

  function parseKeywordInput(value: string): string[] {
    return value
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  function openFbCommentExplorer(post: FbPost) {
    setFbCommentModalPost(post);
    setFbCommentRows([]);
    setFbCommentStatus('');
  }

  async function fetchFacebookCommentsForFilter() {
    if (!fbCommentModalPost) return;
    setFbCommentBusy(true);
    setFbCommentStatus('Đang lấy toàn bộ comment Facebook...');
    try {
      const r = await api('/api/post-comments/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post: fbCommentModalPost,
          keywords: parseKeywordInput(fbCommentKeywords),
          limit: 1000,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setFbCommentRows(d.comments || []);
        const warn = d.warning ? ` · ${d.warning}` : '';
        setFbCommentStatus(`Đã đọc ${d.fetched_comment_count}/${d.comment_count} comment · khớp ${d.matched_count} · lưu ${d.storage}${warn}`);
      } else {
        setFbCommentRows([]);
        setFbCommentStatus(`Lỗi: ${d.error || 'Không lấy được comment'}`);
      }
    } catch {
      setFbCommentRows([]);
      setFbCommentStatus('Lỗi kết nối backend');
    }
    setFbCommentBusy(false);
  }

  async function fetchTiktokCommentsForFilter() {
    const url = tiktokUrl.trim();
    const selectedChannel = channels.find((item) => item.id === tiktokManagedChannelId);
    if (tiktokMode === 'video' && !url) {
      setTiktokStatus('Dán link video TikTok trước');
      return;
    }
    if (tiktokMode === 'channel' && !url) {
      setTiktokStatus('Dán link kênh TikTok hoặc @username trước');
      return;
    }
    setTiktokBusy(true);
    setTiktokStatus(tiktokMode === 'video' ? 'Đang lấy comment TikTok theo video...' : 'Đang lấy comment TikTok theo kênh...');
    try {
      let endpoint = tiktokMode === 'video'
        ? '/api/tiktok/comments/fetch'
        : tiktokMode === 'managed'
          ? '/api/tiktok/channels/fetch-comments'
          : '/api/tiktok/channel-comments/fetch';
      let body: Record<string, unknown> = tiktokMode === 'video'
        ? {
            url,
            channel_name: tiktokChannelName.trim(),
            video_title: tiktokVideoTitle.trim(),
            keywords: parseKeywordInput(tiktokKeywords),
            limit: 500,
          }
        : tiktokMode === 'managed'
          ? {
              channel_ids: tiktokManagedChannelId ? [tiktokManagedChannelId] : [],
              keywords: parseKeywordInput(tiktokKeywords),
              max_videos: tiktokMaxVideos,
              limit_per_video: tiktokLimitPerVideo,
            }
          : {
              channel: url,
              keywords: parseKeywordInput(tiktokKeywords),
              max_videos: tiktokMaxVideos,
              limit_per_video: tiktokLimitPerVideo,
            };
      const collectHint = '';
      const r = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) {
        setTiktokRows(d.comments || []);
        const warn = d.warning ? ` · ${d.warning}` : '';
        const reportText = Array.isArray(d.reports) && d.reports.length
          ? ` · báo cáo: ${d.reports.slice(0, 3).map((item: Record<string, unknown>) => {
              const label = String(item.video_id || item.channel_name || item.channel_id || 'nguồn');
              const count = Number(item.comment_count || 0);
              const error = item.error ? ` (${String(item.error).slice(0, 90)})` : '';
              return `${label}: ${count} cmt${error}`;
            }).join(' | ')}`
          : '';
        const prefix = tiktokMode === 'video'
          ? 'Video'
          : tiktokMode === 'managed'
            ? `${selectedChannel?.channel_name || 'Các kênh đã lưu'}`
            : `Kênh ${url}`;
        setTiktokStatus(`${prefix}: đã đọc ${d.fetched_comment_count || d.comment_count || 0} comment · ${d.video_count ? `${d.video_count} video · ` : ''}khớp ${d.matched_count || 0} · có SĐT ${d.phone_count || 0} · lưu ${d.storage}${collectHint}${warn}${reportText}`);
        void loadTiktokStats(d.post_id || '');
      } else {
        setTiktokRows([]);
        setTiktokStatus(`Lỗi: ${d.error || 'Không lấy được comment TikTok'}`);
      }
    } catch {
      setTiktokRows([]);
      setTiktokStatus('Lỗi kết nối backend');
    }
    setTiktokBusy(false);
  }

  async function loadTiktokStats(preferredPostId = '') {
    setTiktokStatsBusy(true);
    setTiktokStatsStatus('Đang tải thống kê TikTok...');
    try {
      const r = await api('/api/tiktok/comment-stats?limit=5000');
      const d = await r.json();
      if (d.ok) {
        const rows: TikTokCommentStat[] = d.stats || [];
        setTiktokStats(rows);
        const nextSelected = preferredPostId || tiktokSelectedPostId || rows[0]?.post_id || '';
        if (nextSelected) setTiktokSelectedPostId(nextSelected);
        const warn = d.warning ? ` · ${d.warning}` : '';
        setTiktokStatsStatus(`Có ${rows.length} video · ${d.total_comments || 0} comment · ${d.total_phone_comments || 0} comment có SĐT${warn}`);
      } else {
        setTiktokStatsStatus(`Lỗi: ${d.error || 'Không tải được thống kê TikTok'}`);
      }
    } catch {
      setTiktokStatsStatus('Lỗi kết nối backend');
    }
    setTiktokStatsBusy(false);
  }

  function requestTiktokExtensionComment(payload: Record<string, unknown>): Promise<TikTokBridgeResult> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: 'Chỉ gửi được TikTok trên trình duyệt Chrome có cài extension' });
        return;
      }

      const requestId = `tiktok_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({
          ok: false,
          error: 'Không thấy extension phản hồi. Hãy cài/bật Seeding Fsolution Bridge rồi tải lại trang.',
        });
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

  async function recordTiktokExtensionResult(status: 'success' | 'failed', message: string, result: TikTokBridgeResult) {
    const r = await api('/api/tiktok/comment/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        post_id: selectedTiktokStat?.post_id,
        video_id: selectedTiktokStat?.video_id,
        post_url: selectedTiktokStat?.post_url || result.url,
        video_title: selectedTiktokStat?.video_title,
        channel_name: selectedTiktokStat?.channel_name,
        message,
        comment_id: result.comment_id,
        error: result.error,
        extension_result: result,
      }),
    });
    return r.json();
  }

  async function requestTiktokPlaywrightComment(message: string): Promise<TikTokBridgeResult> {
    if (!selectedTiktokStat) {
      return { ok: false, error: 'Chưa chọn video TikTok' };
    }
    try {
      const r = await api('/api/tiktok/comment/playwright', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: selectedTiktokStat.post_id,
          video_id: selectedTiktokStat.video_id,
          post_url: selectedTiktokStat.post_url,
          video_title: selectedTiktokStat.video_title,
          channel_name: selectedTiktokStat.channel_name,
          message,
        }),
      });
      return r.json().catch(() => ({ ok: false, error: `Server lỗi ${r.status}` }));
    } catch {
      return { ok: false, error: 'Không kết nối được Playwright backend' };
    }
  }

  async function prepareManualTikTokComment(message: string, fallbackReason = '') {
    if (!selectedTiktokStat?.post_url) {
      setTiktokCommentStatus('Video TikTok này chưa có link để mở.');
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
    window.open(selectedTiktokStat.post_url, '_blank', 'noopener,noreferrer');
    const result: TikTokBridgeResult = {
      ok: true,
      manual: true,
      method: 'manual-copy-open',
      url: selectedTiktokStat.post_url,
      comment_id: `manual_${selectedTiktokStat.video_id || Date.now()}`,
    };
    const d = await recordTiktokExtensionResult('success', message, result);
    setTiktokCommentText('');
    const prefix = fallbackReason ? `TikTok chưa nhận gửi trực tiếp (${fallbackReason}). ` : '';
    setTiktokCommentStatus(`${prefix}Đã copy nội dung và mở TikTok. Dán Ctrl+V vào ô bình luận rồi gửi thủ công${d.warning ? ` · ${d.warning}` : ''}`);
    await loadTiktokStats(d.post_id || selectedTiktokStat.post_id || '');
    await loadTodayCommentStats();
  }

  async function sendDirectTikTokComment(message: string) {
    if (!selectedTiktokStat) {
      return { ok: false, error: 'Chưa chọn video TikTok' } as TikTokBridgeResult;
    }
    if (!tiktokBridgeReady) {
      return { ok: false, error: 'Chưa thấy extension Seeding Fsolution Bridge' } as TikTokBridgeResult;
    }
    return requestTiktokExtensionComment({
      post_id: selectedTiktokStat.post_id,
      video_id: selectedTiktokStat.video_id,
      post_url: selectedTiktokStat.post_url,
      video_title: selectedTiktokStat.video_title,
      channel_name: selectedTiktokStat.channel_name,
      message,
    });
  }

  async function sendTiktokComment() {
    if (!selectedTiktokStat?.post_id && !selectedTiktokStat?.video_id) {
      setTiktokCommentStatus('Chọn video TikTok trước');
      return;
    }
    const message = tiktokCommentText.trim();
    if (!message) {
      setTiktokCommentStatus('Nhập nội dung bình luận');
      return;
    }
    setTiktokCommentBusy(true);
    setTiktokCommentStatus('Đang thử gửi TikTok bằng Playwright backend...');
    try {
      const playwrightResult = await requestTiktokPlaywrightComment(message);
      if (playwrightResult.ok) {
        setTiktokCommentText('');
        setTiktokCommentStatus(`Đã gửi comment TikTok bằng Playwright browser${playwrightResult.warning ? ` · ${playwrightResult.warning}` : ''}`);
        await loadTiktokStats(playwrightResult.post_id || selectedTiktokStat.post_id || '');
        await loadTodayCommentStats();
        setTiktokCommentBusy(false);
        return;
      }

      setTiktokCommentStatus(`Playwright chưa gửi được (${playwrightResult.error || 'không rõ lỗi'}). Đang thử Chrome extension...`);
      const directResult = await sendDirectTikTokComment(message);
      if (directResult.ok) {
        const d = await recordTiktokExtensionResult('success', message, directResult);
        setTiktokCommentText('');
        setTiktokCommentStatus(`Đã gửi comment TikTok trực tiếp từ UI qua Chrome extension${d.warning ? ` · ${d.warning}` : ''}`);
        await loadTiktokStats(d.post_id || selectedTiktokStat.post_id || '');
        await loadTodayCommentStats();
      } else {
        await recordTiktokExtensionResult('failed', message, directResult).catch(() => null);
        await prepareManualTikTokComment(message, directResult.error || 'TikTok chặn phiên gửi tự động');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Không gửi được TikTok';
      try {
        await prepareManualTikTokComment(message, reason);
      } catch {
        setTiktokCommentStatus('Không gửi/copy/mở được TikTok. Hãy bấm “Mở” video rồi dán nội dung thủ công.');
      }
    }
    setTiktokCommentBusy(false);
  }

  async function onProviderChange(next: string) {
    setAiProvider(next);
    setAiStatus('');
    try {
      await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: next,
          model: (aiProviders[next] || {}).default_model || '',
        }),
      });
    } catch {
      setAiStatus('❌ Không kết nối được backend khi đổi AI');
    }
  }

  async function saveAiKey() {
    if (!aiKeyInput.trim()) {
      setAiStatus('❌ Nhập API key');
      return;
    }
    setAiStatus('⏳ Đang lưu...');
    const model = (aiProviders[aiProvider] || {}).default_model || '';
    try {
      const r = await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: aiProvider, model, key: aiKeyInput.trim() }),
      });
      const d = await r.json();
      if (d.ok) {
        setAiStatus('✅ Đã lưu key!');
        const cRes = await api('/api/ai/config');
        setAiConfig(await cRes.json());
        setAiKeyEdit(false);
        setAiKeyInput('');
      } else setAiStatus('❌ ' + (d.error || 'Lỗi lưu key'));
    } catch {
      setAiStatus('❌ Không kết nối được backend. Kiểm tra Flask port 5000 và refresh lại trang.');
    }
    setTimeout(() => setAiStatus(''), 3000);
  }

  async function deleteAiKey() {
    if (!confirm(`Xoá API key của ${aiProvider.toUpperCase()}?`)) return;
    try {
      const r = await api(`/api/ai/key/${aiProvider}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.ok) {
        setAiStatus('✅ Đã xoá key');
        const cRes = await api('/api/ai/config');
        setAiConfig(await cRes.json());
      } else {
        setAiStatus('❌ ' + (d.error || 'Lỗi xoá key'));
      }
    } catch {
      setAiStatus('❌ Không kết nối được backend khi xoá key');
    }
    setTimeout(() => setAiStatus(''), 3000);
  }

  async function saveAiAuto(next: boolean) {
    setAiAutoClassify(next);
    try {
      await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: aiProvider, auto_classify: next }),
      });
    } catch {
      setAiStatus('❌ Không kết nối được backend khi lưu tự động AI');
    }
  }

  async function testAi() {
    setAiStatus('⏳ Đang test...');
    try {
      const r = await api('/api/ai/test', { method: 'POST' });
      const d = await r.json();
      setAiStatus(d.ok ? '✅ Kết nối OK!' : '❌ ' + (d.error || 'Lỗi'));
    } catch {
      setAiStatus('❌ Lỗi kết nối');
    }
    setTimeout(() => setAiStatus(''), 4000);
  }

  const summarizeComments = useCallback(async (post: FbPost): Promise<string> => {
    const working = 'AI đang đọc toàn bộ bình luận của bài viết...';
    setAiStatus(working);
    setToolStatus(working);
    try {
      const r = await api('/api/ai/summarize-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post, force: true }),
        timeoutMs: 120000,
      });
      const d = await r.json();
      if (d.ok && post.id) {
        setCommentSummaries((prev) => ({
          ...prev,
          [post.id]: { ...d.summary, storage: d.storage, warning: d.warning || '' },
        }));
        const count = d.summary?.comment_count ?? 0;
        const fetched = d.summary?.fetched_comment_count ?? 0;
        const msg =
          d.storage === 'supabase'
            ? `✅ Đã tóm tắt ${fetched}/${count} comment · lưu Supabase`
            : `✅ Đã tóm tắt ${fetched}/${count} comment · lưu local`;
        setAiStatus(msg);
        setToolStatus(msg);
        return msg;
      }
      const err = `❌ ${d.error || 'AI chưa tóm tắt được bình luận'}`;
      setAiStatus(err);
      setToolStatus(err);
      return err;
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const msg = aborted
        ? '⏱️ Tóm tắt quá lâu — kiểm tra API key AI hoặc thử lại'
        : '❌ Lỗi kết nối server';
      setAiStatus(msg);
      setToolStatus(msg);
      return msg;
    } finally {
      setTimeout(() => {
        setAiStatus('');
        setToolStatus(statusBaseRef.current || '');
      }, 9000);
    }
  }, []);

  async function extractLeadsAll() {
    if (!allPosts.length) return;
    setLeadsBusy(true);
    setAiStatus('⏳ Đang tách lead...');
    try {
      const r = await api('/api/ai/extract-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts: allPosts }),
      });
      const d = await r.json();
      if (d.ok) {
        setLeads((prev) => ({ ...prev, ...d.leads }));
        const count = Object.values(d.leads || {}).reduce(
          (sum: number, items) => sum + (items as Lead[]).length,
          0,
        );
        setAiStatus(count ? `✅ Tách được ${count} lead` : 'ℹ️ Chưa phát hiện lead');
        if (d.warning) setTimeout(() => setAiStatus(`⚠️ ${d.warning}`), 1200);
      } else {
        setAiStatus(`❌ ${d.error || 'Lỗi tách lead'}`);
      }
    } catch {
      setAiStatus('❌ Lỗi kết nối');
    }
    setLeadsBusy(false);
    setTimeout(() => setAiStatus(''), 7000);
  }

  async function syncPhoneLeadsFromComments() {
    setLeadsBusy(true);
    setAiStatus('⏳ Đang lấy SĐT từ comment đã lưu...');
    try {
      const r = await api('/api/leads/from-comments', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        setLeads((prev) => ({ ...prev, ...(d.leads || {}) }));
        setAiStatus(`✅ Đã đưa ${d.count || 0} lead có SĐT vào bảng Lead${d.storage ? ` · ${d.storage}` : ''}`);
        if (d.warning) setTimeout(() => setAiStatus(`⚠️ ${d.warning}`), 1200);
      } else {
        setAiStatus(`❌ ${d.error || 'Không lấy được SĐT từ comment'}`);
      }
    } catch {
      setAiStatus('❌ Lỗi kết nối khi lấy SĐT từ comment');
    }
    setLeadsBusy(false);
    setTimeout(() => setAiStatus(''), 7000);
  }

  async function classifyAll() {
    if (!allPosts.length) return;
    setClassifyBusy(true);
    try {
      const r = await api('/api/ai/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ posts: allPosts }),
      });
      const d = await r.json();
      if (d.ok) setClassifications((c) => ({ ...c, ...d.classifications }));
      else alert('Lỗi: ' + (d.error || 'Không xác định'));
    } catch {
      alert('Lỗi kết nối server');
    } finally {
      setClassifyBusy(false);
    }
  }

  async function login(username: string, password: string) {
    setAuthStatus('Đang đăng nhập...');
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const d = await r.json();
      if (d.ok) {
        setAuthenticated(true);
        setSetupRequired(false);
        setCurrentStaff(d.staff || null);
        setAuthStatus('');
        await loadStaffCookies();
        await loadTodayCommentStats();
      } else {
        setAuthStatus(d.error || 'Sai tài khoản hoặc mật khẩu');
      }
    } catch {
      setAuthStatus('Lỗi kết nối server');
    }
  }

  async function setupFirstAccount(payload: { name: string; username: string; password: string; cookie: string }) {
    setAuthStatus('Đang tạo tài khoản...');
    try {
      const r = await api('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (d.ok) {
        setAuthenticated(true);
        setSetupRequired(false);
        setCurrentStaff(d.staff || null);
        setAuthStatus('');
        await loadStaffCookies();
        await loadTiktokCookieConfig();
        await loadTodayCommentStats();
      } else {
        if (d.already_setup || d.setup_required === false) {
          setSetupRequired(false);
          setAuthenticated(false);
          setCurrentStaff(null);
        }
        setAuthStatus(d.error || 'Lỗi setup');
      }
    } catch {
      setAuthStatus('Lỗi kết nối server');
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setAuthenticated(false);
    setCurrentStaff(null);
    setStaffRows([]);
    setTiktokCookieConfig({});
    setTiktokCookieInput('');
    setAllPosts([]);
    setHeaderSub('Đã đăng xuất');
  }

  async function saveStaffCookie(payload: StaffPayload, staffId?: string) {
    if (!payload.name.trim() || !payload.username.trim()) {
      setStaffStatus('Nhập đủ tên và tài khoản đăng nhập');
      return false;
    }
    if (!staffId && (!payload.password || !payload.cookie.trim())) {
      setStaffStatus('Nhập đủ mật khẩu và cookie khi thêm nhân sự');
      return false;
    }
    setStaffStatus(staffId ? 'Đang cập nhật nhân sự...' : 'Đang lưu nhân sự...');
    try {
      const r = await api(staffId ? `/api/staff-cookies/${staffId}` : '/api/staff-cookies', {
        method: staffId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({
        ok: false,
        error: r.ok ? 'Phản hồi server không hợp lệ' : `Server lỗi ${r.status}`,
      }));
      if (d.ok) {
        setStaffRows(d.staff || []);
        setCanManageStaff(!!d.can_manage);
        const storageText = d.storage === 'supabase' ? 'Supabase' : 'local';
        setStaffStatus(`${staffId ? '✅ Đã cập nhật nhân sự' : '✅ Đã thêm nhân sự'} (${storageText})${d.warning ? ` · ${d.warning}` : ''}`);
        return true;
      } else {
        setStaffStatus('❌ ' + (d.error || 'Lỗi lưu nhân sự'));
        return false;
      }
    } catch {
      setStaffStatus('❌ Lỗi kết nối');
      return false;
    }
  }

  async function deleteStaffCookie(staffId: string) {
    if (!confirm('Xoá cookie nhân sự này?')) return;
    setStaffStatus('Đang xoá...');
    try {
      const r = await api(`/api/staff-cookies/${staffId}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({
        ok: false,
        error: r.ok ? 'Phản hồi server không hợp lệ' : `Server lỗi ${r.status}`,
      }));
      if (d.ok) {
        setStaffRows(d.staff || []);
        setCanManageStaff(!!d.can_manage);
        setStaffStatus('✅ Đã xoá cookie');
      } else {
        setStaffStatus('❌ ' + (d.error || 'Lỗi xoá cookie'));
      }
    } catch {
      setStaffStatus('❌ Lỗi kết nối');
    }
  }

  async function saveTiktokCookie() {
    const cookie = tiktokCookieInput.trim();
    if (!cookie) {
      setTiktokCookieStatus('Dán cookie TikTok trước khi lưu');
      return;
    }
    setTiktokCookieBusy(true);
    setTiktokCookieStatus('Đang lưu TikTok cookie...');
    try {
      const r = await api('/api/tiktok/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
      });
      const d = await r.json();
      if (d.ok) {
        setTiktokCookieConfig(d.config || {});
        setTiktokCookieInput('');
        setTiktokCookieStatus(`Đã lưu TikTok cookie (${d.storage === 'supabase' ? 'Supabase' : 'local'})`);
      } else {
        setTiktokCookieStatus('Lỗi: ' + (d.error || 'Không lưu được TikTok cookie'));
      }
    } catch {
      setTiktokCookieStatus('Lỗi kết nối backend');
    }
    setTiktokCookieBusy(false);
  }

  async function deleteTiktokCookie() {
    if (!confirm('Xoá TikTok cookie đang lưu?')) return;
    setTiktokCookieBusy(true);
    setTiktokCookieStatus('Đang xoá TikTok cookie...');
    try {
      const r = await api('/api/tiktok/config', { method: 'DELETE' });
      const d = await r.json();
      if (d.ok) {
        setTiktokCookieConfig(d.config || {});
        setTiktokCookieInput('');
        setTiktokCookieStatus('Đã xoá TikTok cookie');
      } else {
        setTiktokCookieStatus('Lỗi: ' + (d.error || 'Không xoá được TikTok cookie'));
      }
    } catch {
      setTiktokCookieStatus('Lỗi kết nối backend');
    }
    setTiktokCookieBusy(false);
  }

  async function testTiktokCookie() {
    setTiktokCookieBusy(true);
    setTiktokCookieStatus('Đang kiểm tra TikTok cookie...');
    try {
      const r = await api('/api/tiktok/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: tiktokCookieInput.trim() }),
      });
      const d = await r.json();
      if (d.ok) {
        if (d.config) setTiktokCookieConfig(d.config);
        setTiktokCookieStatus(`${d.valid ? '✅' : '❌'} ${d.message || 'Đã kiểm tra cookie'}`);
      } else {
        setTiktokCookieStatus('Lỗi: ' + (d.error || 'Không kiểm tra được TikTok cookie'));
      }
    } catch {
      setTiktokCookieStatus('Lỗi kết nối backend');
    }
    setTiktokCookieBusy(false);
  }

  const masked = (aiConfig.keys_masked || {})[aiProvider] || '';
  const hasKey = Boolean(masked && masked !== '***' && masked.length > 3);
  const fbMatchedRows = fbCommentRows.filter((row) => row.is_matched);
  const tiktokMatchedRows = tiktokRows.filter((row) => row.is_matched);
  const selectedTiktokStat = tiktokStats.find((item) => item.post_id === tiktokSelectedPostId) || tiktokStats[0];
  const selectedTiktokComments = (selectedTiktokStat?.comments || []).filter((row) => !tiktokOnlyPhone || !!row.phones?.length);
  const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString('vi-VN') : '-');
  const facebookPageChannels = channels.filter((item) => {
    const platform = (item.platform || '').trim().toLowerCase();
    const type = (item.channel_type || '').trim().toLowerCase();
    return platform === 'facebook' && ['page', 'fanpage', 'trang'].includes(type);
  });
  const facebookGroupChannels = channels.filter((item) => {
    const platform = (item.platform || '').trim().toLowerCase();
    const type = (item.channel_type || '').trim().toLowerCase();
    return platform === 'facebook' && ['nhóm', 'nhom', 'group'].includes(type);
  });
  const tiktokManagedChannels = channels.filter((item) => (item.platform || '').trim().toLowerCase() === 'tiktok');

  useEffect(() => {
    if (!authenticated) return;
    if (activeView === 'history') void loadCommentLogs();
    if (activeView === 'channels') void loadChannels();
    if (activeView === 'marketing') {
      void loadContentPipeline();
      void loadChannels();
    }
  }, [activeView, authenticated, loadChannels, loadCommentLogs, loadContentPipeline]);

  if (!authChecked) {
    return (
      <main className="auth-page">
        <div className="auth-loading">
          <img src="/st-real-logo.jpg" alt="Seeding Fsolution" />
          <div className="auth-loading-text">
            <b>Seeding Fsolution</b>
            <span>Đang kiểm tra phiên đăng nhập...</span>
          </div>
        </div>
      </main>
    );
  }

  if (setupRequired || !authenticated) {
    return (
      <>
        <AuthPanel
          mode={setupRequired ? 'setup' : 'login'}
          status={authStatus}
          onLogin={login}
          onSetup={setupFirstAccount}
        />
      </>
    );
  }

  return (
    <>
      <div className="console-shell">
        <ConsoleRail activeView={activeView} onNavigate={openView} />

        <main
          className={`console-content${
            activeView === 'manage' ? ' manage-active' : ''
          }${activeView === 'marketing' ? ' marketing-active' : ''}`}
        >
          {activeView !== 'manage' && activeView !== 'marketing' ? (
          <div className="console-topbar">
            <button type="button" className="rail-collapse" title="Menu">
              ☰
            </button>
            <div>
              <div className="console-page-title">{CONSOLE_NAV_ITEMS.find((item) => item.key === activeView)?.label || 'Trang chủ'}</div>
              <div className="console-page-sub" title={groups.length === 1 ? `ID: ${groups[0]}` : ''}>
                Seeding Fsolution
              </div>
            </div>
            <div className="header-spacer" />
            <div className="console-clock">{new Date().toLocaleDateString('vi-VN')}</div>
            <div className="header-user">
              {currentStaff?.name || currentStaff?.username} · {currentStaff?.role === 'admin' ? 'admin' : 'nhân sự'}
            </div>
            <button type="button" className="header-logout" onClick={() => void logout()}>
              Đăng xuất
            </button>
          </div>
          ) : null}

          {activeView === 'home' ? <ConsoleHome staffName={currentStaff?.name || currentStaff?.username} onOpen={openView} /> : null}
          {activeView === 'channels' ? (
            <ChannelManagerPanel
              channels={channels}
              status={channelStatus}
              busy={channelBusy}
              onSave={saveChannel}
              onDelete={deleteChannel}
              onReload={loadChannels}
              onSyncFacebookPages={syncFacebookPages}
            />
          ) : null}
          {activeView === 'comments' ? <CommentLeadInboxPanel /> : null}
          {activeView === 'history' ? <HistoryPanel rows={commentLogs} status={historyStatus} onReload={loadCommentLogs} /> : null}
          {activeView === 'leads' ? <LeadManagerPanel leads={leads} onExtract={extractLeadsAll} onSyncPhones={syncPhoneLeadsFromComments} /> : null}
          {activeView === 'scripts' ? <ScriptWriterPanel /> : null}
          {activeView === 'marketing' ? (
            <MarketingPipelinePanel
              data={pipelineData}
              busy={pipelineBusy}
              status={pipelineStatus}
              onReload={loadContentPipeline}
              onResearch={runContentPipelineResearch}
              initialGroups={facebookGroupChannels
                .map((item) => ({ id: item.target_id || '', name: item.channel_name || item.target_id || '' }))
                .filter((item) => item.id)}
              initialPages={facebookPageChannels
                .map((item) => ({ id: item.target_id || '', name: item.channel_name || item.target_id || '' }))
                .filter((item) => item.id)}
            />
          ) : null}
          {activeView === 'staff' ? (
            <>
              <section className="module-panel tiktok-cookie-panel">
                <div className="module-head">
                  <div>
                    <div className="module-kicker">TikTok</div>
                    <h2>Cookie TikTok</h2>
                  </div>
                  <button type="button" className="btn-cancel" onClick={() => void loadTiktokCookieConfig()}>
                    Tải lại
                  </button>
                </div>
                <div className="tiktok-cookie-status-row">
                  <span className={`status-pill ${tiktokCookieConfig.has_login_cookie ? 'ok' : 'fail'}`}>
                    {tiktokCookieConfig.has_login_cookie ? 'Cookie đăng nhập hợp lệ' : tiktokCookieConfig.has_cookie ? 'Thiếu session login' : 'Chưa có cookie'}
                  </span>
                  <span className="mono-cell">{tiktokCookieConfig.cookie_masked || '-'}</span>
                  {tiktokCookieConfig.source ? <span>Nguồn: {tiktokCookieConfig.source === 'web' ? 'Web' : '.env'}</span> : null}
                  {tiktokCookieConfig.updated_at ? <span>Cập nhật: {formatDateTime(tiktokCookieConfig.updated_at)}</span> : null}
                </div>
                <p className="tiktok-cookie-note">
                  Cookie này chỉ hỗ trợ đọc bình luận khi TikTok chặn API. Gửi bình luận TikTok dùng Chrome extension, không dùng cookie lưu trên server.
                </p>
                {canManageStaff ? (
                  <>
                    <textarea
                      className="tiktok-cookie-textarea"
                      value={tiktokCookieInput}
                      onChange={(e) => setTiktokCookieInput(e.target.value)}
                      placeholder="Dán cookie TikTok đầy đủ từ tiktok.com, ví dụ có sessionid / sid_tt / ttwid..."
                    />
                    <div className="tiktok-cookie-actions">
                      <button type="button" className="btn-submit" disabled={tiktokCookieBusy} onClick={() => void saveTiktokCookie()}>
                        {tiktokCookieBusy ? 'Đang lưu...' : 'Lưu TikTok cookie'}
                      </button>
                      <button type="button" className="btn-cancel" disabled={tiktokCookieBusy || (!tiktokCookieInput.trim() && !tiktokCookieConfig.has_cookie)} onClick={() => void testTiktokCookie()}>
                        Test cookie
                      </button>
                      <button type="button" className="btn-cancel" disabled={tiktokCookieBusy || !tiktokCookieConfig.has_cookie} onClick={() => void deleteTiktokCookie()}>
                        Xoá cookie
                      </button>
                      <span className="modal-result">{tiktokCookieStatus}</span>
                    </div>
                  </>
                ) : (
                  <div className="modal-result">Chỉ admin được nhập hoặc xoá TikTok cookie.</div>
                )}
              </section>
              <StaffCookiePanel
                staff={staffRows}
                currentStaff={currentStaff}
                canManage={canManageStaff}
                status={staffStatus}
                title="Nhân sự"
                kicker="Quản lý tài khoản"
                onSave={saveStaffCookie}
                onDelete={deleteStaffCookie}
              />
            </>
          ) : null}

      {activeView === 'manage' ? (
        <ManageDashboardPanel
          staffName={currentStaff?.name || currentStaff?.username}
          staffRole={currentStaff?.role}
          headerSub={headerSub}
          onLogout={() => void logout()}
          onOpenView={openView}
          onOpenChannels={() => openView('channels')}
          groups={groups}
          groupNames={groupNames}
          facebookPageChannels={facebookPageChannels}
          tiktokManagedChannels={tiktokManagedChannels}
          groupInp={groupInp}
          setGroupInp={setGroupInp}
          groupBusy={groupBusy}
          onAddGroup={() => void addGroup()}
          onRemoveGroup={(id) => void removeGroup(id)}
          joinPrompt={joinPrompt}
          joinBusy={joinBusy}
          joinMsg={joinMsg}
          onDismissJoin={() => setJoinPrompt(null)}
          onJoinGroup={(id, name) => void joinGroupAct(id, name)}
          onForceAddGroup={(id, name) => void forceAddGroup(id, name)}
          onRefreshMembership={(ids) => void loadGroupMembership(ids)}
          groupMembership={groupMembership}
          membershipCheckingIds={membershipCheckingIds}
          joiningGroupId={joiningGroupId}
          onSyncFacebookPages={() => void syncFacebookPages()}
          channelBusy={channelBusy}
          keywords={keywords}
          kwInp={kwInp}
          setKwInp={setKwInp}
          onAddKw={addKw}
          onRemoveKw={removeKw}
          tgIds={tgIds}
          tgInp={tgInp}
          setTgInp={setTgInp}
          onAddTg={() => void addTg()}
          onRemoveTg={(id) => void removeTg(id)}
          onTestTg={(id) => void testTg(id)}
          tgStatus={tgStatus}
          limit={limit}
          setLimit={setLimit}
          loading={loading}
          onLoadPosts={() => void loadPosts()}
          onOpenPostModal={openPostModal}
          classifyBusy={classifyBusy}
          onClassifyAll={() => void classifyAll()}
          leadsBusy={leadsBusy}
          onExtractLeads={() => void extractLeadsAll()}
          onOpenTiktokModal={() => { setTiktokModal(true); setTiktokStatus(''); }}
          onOpenTiktokStats={() => { setTiktokStatsModal(true); void loadTiktokStats(); }}
          catFilter={catFilter}
          setCatFilter={setCatFilter}
          catOptions={catOptions}
          autoOn={autoOn}
          onToggleAuto={toggleAuto}
          intervalMin={intervalMin}
          setIntervalMin={setIntervalMin}
          onSaveSettings={saveSettings}
          todayCommentCount={todayCommentCount}
          toolStatus={toolStatus}
          feedError={feedError}
          postFetchReport={postFetchReport}
          filteredPosts={filteredPosts}
          allPostsCount={allPosts.length}
          classifications={classifications}
          pages={pages}
          leads={leads}
          commentSummaries={commentSummaries}
          onSummarizeComments={summarizeComments}
          onExploreComments={openFbCommentExplorer}
          onCommentSent={handleCommentSent}
          onOpenLightbox={setLightbox}
          saleSetupProps={{
            aiProvider,
            onProviderChange: (v) => { setAiProvider(v); void onProviderChange(v); },
            aiAutoClassify,
            onAutoClassifyChange: (v) => void saveAiAuto(v),
            aiStatus,
            maskedKey: masked,
            hasKey,
            aiKeyEdit,
            aiKeyInput,
            onAiKeyInput: setAiKeyInput,
            onToggleKeyEdit: () => setAiKeyEdit((e) => !e),
            onTestAi: testAi,
            onSaveKey: saveAiKey,
            onDeleteKey: deleteAiKey,
            staff: staffRows,
            currentStaff,
            canManageStaff,
            staffStatus,
            showStaffManager: false,
            onSaveStaff: saveStaffCookie,
            onDeleteStaff: deleteStaffCookie,
          }}
        />
      ) : null}
        </main>
      </div>

      <div className={`modal-overlay${postModal ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setPostModal(false)} role="presentation">
        <div className="modal">
          <div className="modal-hd">
            ✍️ Đăng bài mới{' '}
            <span className="modal-close" onClick={() => setPostModal(false)} role="presentation">
              ✕
            </span>
          </div>
          <div className="field">
            <label>Nhóm (chọn nhiều nhóm)</label>
            <div className="multi-group-list">
              {groups.map((g) => (
                <div key={g} className="multi-group-item">
                  <input
                    type="checkbox"
                    id={`pg-${g}`}
                    checked={!!postSelected[g]}
                    onChange={(e) => setPostSelected((s) => ({ ...s, [g]: e.target.checked }))}
                  />
                  <label htmlFor={`pg-${g}`}>{groupNames[g] || g}</label>
                </div>
              ))}
            </div>
            <div className="multi-select-actions">
              <button type="button" onClick={() => setPostSelected(Object.fromEntries(groups.map((g) => [g, true])))}>
                Chọn tất cả
              </button>
              <button type="button" onClick={() => setPostSelected(Object.fromEntries(groups.map((g) => [g, false])))}>
                Bỏ chọn
              </button>
            </div>
          </div>
          <div className="field">
            <label>Đăng với tư cách</label>
            <select value={postPageId} onChange={(e) => setPostPageId(e.target.value)}>
              <option value="">👤 Cá nhân</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  📄 {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nội dung</label>
            <textarea value={postContent} onChange={(e) => setPostContent(e.target.value)} placeholder="Bạn đang nghĩ gì?" />
          </div>
          <div className="field">
            <label>Ảnh/video</label>
            <div className="post-media-upload">
              <label className={`btn-image-upload${postUploadingMedia ? ' disabled' : ''}`}>
                📎 Chọn file
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
                  multiple
                  disabled={postUploadingMedia || postSubmitting}
                  onChange={(e) => {
                    void uploadPostMedia(e.currentTarget.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <span className="comment-file-hint">JPG, PNG, GIF, MP4/MOV · tối đa 50MB/file · tối đa 10 file</span>
            </div>
            {postMedia.length ? (
              <div className="post-media-grid">
                {postMedia.map((item, idx) => (
                  <div className="post-media-item" key={`${item.url}-${idx}`}>
                    {item.type === 'video' ? <video src={item.url} muted controls /> : <img src={item.url} alt="" />}
                    <button
                      type="button"
                      aria-label="Xoá media"
                      disabled={postSubmitting}
                      onClick={() => setPostMedia((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="post-ai-row">
            <button type="button" className="btn-cancel" disabled={postCaptionBusy || postSubmitting} onClick={() => void generatePostCaptions()}>
              {postCaptionBusy ? 'AI đang viết...' : '✨ AI tạo caption từng nhóm'}
            </button>
            <span>AI nằm trong nội dung đăng bài, mỗi nhóm/page nhận một caption khác nhau để tránh trùng lặp.</span>
          </div>
          {Object.keys(postCaptions).length ? (
            <div className="post-caption-variants">
              {groups.filter((g) => postSelected[g]).map((g) => (
                <div key={g} className="post-caption-card">
                  <b>{groupNames[g] || g}</b>
                  <textarea
                    value={postCaptions[g] || postContent}
                    onChange={(e) => setPostCaptions((current) => ({ ...current, [g]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className="modal-result">{postResult}</div>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={() => setPostModal(false)}>
              Huỷ
            </button>
            <button type="button" className="btn-submit" disabled={postSubmitting || postUploadingMedia} onClick={() => void submitPost()}>
              Đăng bài
            </button>
          </div>
        </div>
      </div>

      <div
        className={`modal-overlay${fbCommentModalPost ? ' open' : ''}`}
        onClick={(e) => e.target === e.currentTarget && setFbCommentModalPost(null)}
        role="presentation"
      >
        <div className="modal modal-wide">
          <div className="modal-hd">
            🔎 Lọc bình luận Facebook
            <span className="modal-close" onClick={() => setFbCommentModalPost(null)} role="presentation">
              ✕
            </span>
          </div>
          <div className="field">
            <label>Từ khoá lọc comment</label>
            <textarea
              className="keyword-textarea"
              value={fbCommentKeywords}
              onChange={(e) => setFbCommentKeywords(e.target.value)}
              placeholder="quan tâm, đặt hàng, sđt, địa chỉ"
            />
          </div>
          <div className="modal-actions modal-actions-between">
            <div className="modal-result">{fbCommentStatus}</div>
            <button type="button" className="btn-submit" disabled={fbCommentBusy} onClick={() => void fetchFacebookCommentsForFilter()}>
              {fbCommentBusy ? 'Đang đọc...' : 'Lấy & lọc CMT'}
            </button>
          </div>
          <div className="comment-filter-summary">
            Hiển thị {fbMatchedRows.length || fbCommentRows.length} comment {fbMatchedRows.length ? 'khớp từ khoá' : fbCommentRows.length ? 'đã lấy' : ''}
          </div>
          <div className="stored-comments-list">
            {(fbMatchedRows.length ? fbMatchedRows : fbCommentRows).slice(0, 100).map((row) => (
              <div key={row.comment_id} className="stored-comment">
                <div className="stored-comment-head">
                  <CommentAuthorLink row={row} />
                  <span>{row.created_time ? new Date(row.created_time).toLocaleString('vi-VN') : ''}</span>
                </div>
                <div className="stored-comment-message">{row.message || '[Không có nội dung chữ]'}</div>
                {row.matched_keywords?.length ? (
                  <div className="stored-comment-tags">
                    {row.matched_keywords.map((kw) => (
                      <span key={kw}>{kw}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`modal-overlay${tiktokModal ? ' open' : ''}`}
        onClick={(e) => e.target === e.currentTarget && setTiktokModal(false)}
        role="presentation"
      >
        <div className="modal modal-wide">
          <div className="modal-hd">
            🎵 Lọc bình luận TikTok theo kênh/video
            <span className="modal-close" onClick={() => setTiktokModal(false)} role="presentation">
              ✕
            </span>
          </div>
          <div className="segment-row">
            <button type="button" className={tiktokMode === 'managed' ? 'active' : ''} onClick={() => setTiktokMode('managed')}>Kênh đã lưu</button>
            <button type="button" className={tiktokMode === 'channel' ? 'active' : ''} onClick={() => setTiktokMode('channel')}>Một kênh</button>
            <button type="button" className={tiktokMode === 'video' ? 'active' : ''} onClick={() => setTiktokMode('video')}>Một video</button>
          </div>
          {tiktokMode === 'managed' ? (
            <div className="field">
              <label>Kênh TikTok trong Quản lý nhóm/kênh</label>
              <select className="modal-input" value={tiktokManagedChannelId} onChange={(e) => setTiktokManagedChannelId(e.target.value)}>
                <option value="">Tất cả kênh TikTok đã lưu</option>
                {channels.filter((item) => String(item.platform || '').toLowerCase() === 'tiktok').map((item) => (
                  <option key={item.id || item.target_id || item.channel_name} value={item.id || ''}>
                    {item.channel_name || item.link || item.target_id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label>{tiktokMode === 'video' ? 'Link video TikTok' : 'Link kênh TikTok hoặc @username'}</label>
            <input
              className="modal-input"
              value={tiktokUrl}
              onChange={(e) => setTiktokUrl(e.target.value)}
              disabled={tiktokMode === 'managed'}
              placeholder={tiktokMode === 'video' ? 'https://www.tiktok.com/@user/video/...' : 'https://www.tiktok.com/@tenkenh hoặc @tenkenh'}
            />
          </div>
          <div className="tiktok-meta-grid">
            <div className="field">
              <label>{tiktokMode === 'video' ? 'Tên kênh' : 'Số video mới cần quét'}</label>
              <input
                className="modal-input"
                value={tiktokMode === 'video' ? tiktokChannelName : String(tiktokMaxVideos)}
                onChange={(e) => (tiktokMode === 'video' ? setTiktokChannelName(e.target.value) : setTiktokMaxVideos(Number(e.target.value) || 1))}
                placeholder={tiktokMode === 'video' ? '@tenkenh hoặc tên shop' : '8'}
              />
            </div>
            <div className="field">
              <label>{tiktokMode === 'video' ? 'Tên bài / video' : 'Comment mỗi video'}</label>
              <input
                className="modal-input"
                value={tiktokMode === 'video' ? tiktokVideoTitle : String(tiktokLimitPerVideo)}
                onChange={(e) => (tiktokMode === 'video' ? setTiktokVideoTitle(e.target.value) : setTiktokLimitPerVideo(Number(e.target.value) || 50))}
                placeholder={tiktokMode === 'video' ? 'Ví dụ: video giới thiệu sản phẩm' : '150'}
              />
            </div>
          </div>
          <div className="field">
            <label>Từ khoá lọc comment</label>
            <textarea
              className="keyword-textarea"
              value={tiktokKeywords}
              onChange={(e) => setTiktokKeywords(e.target.value)}
              placeholder="quan tâm, đặt hàng, sđt, địa chỉ"
            />
          </div>
          <div className="modal-actions modal-actions-between">
            <div className="modal-result">{tiktokStatus}</div>
            <button type="button" className="btn-submit" disabled={tiktokBusy} onClick={() => void fetchTiktokCommentsForFilter()}>
              {tiktokBusy ? 'Đang đọc...' : tiktokMode === 'video' ? 'Lấy video' : 'Lấy comment theo kênh'}
            </button>
          </div>
          <div className="comment-filter-summary">
            Hiển thị {tiktokMatchedRows.length || tiktokRows.length} comment {tiktokMatchedRows.length ? 'khớp từ khoá' : tiktokRows.length ? 'đã lấy' : ''}
          </div>
          <div className="stored-comments-list">
            {(tiktokMatchedRows.length ? tiktokMatchedRows : tiktokRows).slice(0, 100).map((row) => (
              <div key={row.comment_id} className="stored-comment">
                <div className="stored-comment-head">
                  <CommentAuthorLink row={row} />
                  <span>{row.created_time ? new Date(row.created_time).toLocaleString('vi-VN') : ''}</span>
                </div>
                <div className="stored-comment-message">{row.message || '[Không có nội dung chữ]'}</div>
                {row.matched_keywords?.length ? (
                  <div className="stored-comment-tags">
                    {row.matched_keywords.map((kw) => (
                      <span key={kw}>{kw}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`modal-overlay${tiktokStatsModal ? ' open' : ''}`}
        onClick={(e) => e.target === e.currentTarget && setTiktokStatsModal(false)}
        role="presentation"
      >
        <div className="modal modal-xwide">
          <div className="modal-hd">
            📊 Thống kê comment TikTok
            <span className="modal-close" onClick={() => setTiktokStatsModal(false)} role="presentation">
              ✕
            </span>
          </div>
          <div className="modal-actions modal-actions-between tiktok-stats-actions">
            <div className="modal-result">{tiktokStatsStatus}</div>
            <div className="tiktok-stats-controls">
              <label className="phone-filter-toggle">
                <input type="checkbox" checked={tiktokOnlyPhone} onChange={(e) => setTiktokOnlyPhone(e.target.checked)} />
                Chỉ comment có SĐT
              </label>
              <button type="button" className="btn-submit" disabled={tiktokStatsBusy} onClick={() => void loadTiktokStats()}>
                {tiktokStatsBusy ? 'Đang tải...' : 'Tải lại'}
              </button>
            </div>
          </div>

          <div className="tiktok-stats-grid">
            <div className="tiktok-stat-list">
              <div className="data-table-wrap">
                <table className="data-table tiktok-video-table">
                  <thead>
                    <tr>
                      <th>Kênh</th>
                      <th>Tên bài</th>
                      <th>Link</th>
                      <th>CMT</th>
                      <th>Khớp</th>
                      <th>SĐT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiktokStats.length ? (
                      tiktokStats.map((item) => (
                        <tr
                          key={item.post_id}
                          className={item.post_id === selectedTiktokStat?.post_id ? 'is-selected' : ''}
                          onClick={() => setTiktokSelectedPostId(item.post_id || '')}
                        >
                          <td>
                            <b>{item.channel_name || '-'}</b>
                            <small>{item.video_id || ''}</small>
                          </td>
                          <td>
                            {item.video_title || 'Video TikTok'}
                            <small>Lần đọc: {formatDateTime(item.latest_fetched_at)}</small>
                          </td>
                          <td className="link-cell">
                            {item.post_url ? (
                              <a href={item.post_url} target="_blank" rel="noreferrer">
                                Mở
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>{item.comment_count || 0}</td>
                          <td>{item.matched_count || 0}</td>
                          <td>
                            <span className="lead-phone">{item.phone_count || 0}</span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="empty-table-cell">
                          Chưa có dữ liệu TikTok. Bấm “TikTok CMT” để lấy comment trước.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="tiktok-detail-panel">
              <div className="tiktok-detail-head">
                <div>
                  <b>{selectedTiktokStat?.video_title || 'Chưa chọn video'}</b>
                  <span>{selectedTiktokStat?.channel_name || '-'}</span>
                </div>
                <span className="stat-number">{selectedTiktokComments.length} comment</span>
              </div>
              <div className="tiktok-comment-send">
                <div className="tiktok-extension-status">
                  <span className="status-pill ok">Gửi qua Chrome extension</span>
                  <small>Web sẽ thử gửi trực tiếp bằng phiên TikTok đang đăng nhập trên Chrome. Nếu TikTok chặn, hệ thống tự copy nội dung và mở video để gửi thủ công.</small>
                </div>
                <textarea
                  value={tiktokCommentText}
                  onChange={(e) => setTiktokCommentText(e.target.value)}
                  placeholder="Nhập bình luận, bấm nút để copy và mở video TikTok..."
                  rows={2}
                />
                <div className="tiktok-comment-send-row">
                  <button type="button" className="btn-submit" disabled={tiktokCommentBusy || !selectedTiktokStat} onClick={() => void sendTiktokComment()}>
                    {tiktokCommentBusy ? 'Đang gửi...' : 'Gửi CMT TikTok'}
                  </button>
                  <span>{tiktokCommentStatus}</span>
                </div>
              </div>
              <div className="data-table-wrap">
                <table className="data-table tiktok-comment-table">
                  <thead>
                    <tr>
                      <th>Tên nick</th>
                      <th>Nội dung CMT</th>
                      <th>SĐT</th>
                      <th>Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTiktokComments.length ? (
                      selectedTiktokComments.map((row) => (
                        <tr key={row.comment_id}>
                          <td>
                            <CommentAuthorLink row={row} />
                            <small>{formatDateTime(row.created_time)}</small>
                          </td>
                          <td className="comment-message-cell">
                            {row.message || '[Không có nội dung chữ]'}
                            {row.matched_keywords?.length ? (
                              <div className="stored-comment-tags">
                                {row.matched_keywords.map((kw) => (
                                  <span key={kw}>{kw}</span>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td>{row.phones?.length ? row.phones.join(', ') : '-'}</td>
                          <td className="link-cell">
                            {(row.comment_url || row.post_url) ? (
                              <a href={row.comment_url || row.post_url} target="_blank" rel="noreferrer">
                                Mở
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="empty-table-cell">
                          {tiktokOnlyPhone ? 'Video này chưa có comment chứa SĐT.' : 'Chưa có comment cho video này.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`lightbox${lightbox ? ' open' : ''}`} onClick={() => setLightbox(null)} role="presentation">
        <span className="lightbox-close" onClick={() => setLightbox(null)} role="presentation">
          ✕
        </span>
        {lightbox ? <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} /> : null}
      </div>
    </>
  );
}
