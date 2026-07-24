'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthPanel } from '@/components/AuthPanel';
import { ChannelManagerPanel } from '@/components/ChannelManagerPanel';
import { ConsoleHome } from '@/components/ConsoleHome';
import { HistoryPanel } from '@/components/HistoryPanel';
import { LeadManagerPanel } from '@/components/LeadManagerPanel';
import { LeadProcessedModal } from '@/components/LeadProcessedModal';
import { ManageDashboardPanel } from '@/components/ManageDashboardPanel';
import { ContentPlanPanel } from '@/components/ContentPlanPanel';
import { ApprovedScriptsPanel } from '@/components/ApprovedScriptsPanel';
import { MarketingPipelinePanel } from '@/components/MarketingPipelinePanel';
import { ScriptWriterPanel } from '@/components/ScriptWriterPanel';
import '@/components/standard-post-panel.css';
import { StaffCookiePanel, type StaffPayload } from '@/components/StaffCookiePanel';
import { api, AUTH_TIMEOUT_MS, formatFetchError, PUBLISH_TIMEOUT_MS } from '@/lib/api';
import { APP_BRAND } from '@/lib/app-brand';
import { LEGACY_PATH_REDIRECTS, pathToView, viewToPath, type ViewKey } from '@/lib/app-routes';
import { CONSOLE_NAV_ITEMS } from '@/lib/console-nav';
import { ConsoleRail } from '@/components/ConsoleRail';
import type {
  CommentLog,
  CommentSummary,
  ContentPipelineArticle,
  ContentPipelinePost,
  FacebookCookieContext,
  FbPage,
  FbPost,
  Lead,
  ManagedChannel,
  StaffAccount,
  StoredPostComment,
  TikTokCommentStat,
} from '@/lib/types';
import { CommentAuthorLink } from '@/components/CommentAuthorLink';
import {
  classifyFacebookFeedError,
  facebookGroupIdFromChannel,
  filterChannelsForStaff,
  filterChannelsForManageScope,
  isFacebookGroupChannel,
  isStaffAdmin,
} from '@/lib/utils';

type AiModelOption = {
  id: string;
  name?: string;
  display_name?: string;
  description?: string;
};
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
type TikTokDomCollectResult = TikTokBridgeResult & {
  videos?: Array<Record<string, unknown>>;
  comment_count?: number;
  video_count?: number;
};
type TikTokVideoCollectResult = TikTokBridgeResult & {
  videos?: Array<Record<string, unknown>>;
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

const SCAN_SELECTED_STORAGE_KEY = 'scanSelectedGroups';
const DEFAULT_GEMINI_PRO_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const SUPPORTED_AI_PROVIDERS = ['gemini', 'openai', 'groq'];
const GEMINI_MODEL_FALLBACKS: AiModelOption[] = [
  {
    id: 'gemini-3.1-pro-preview',
    display_name: 'Gemini Pro 3.1 Preview',
    description: 'Model Pro chất lượng cao',
  },
  {
    id: 'gemini-2.5-pro',
    display_name: 'Gemini Pro 2.5',
    description: 'Model Pro ổn định, chất lượng cao',
  },
  {
    id: 'gemini-3.5-flash',
    display_name: 'Gemini 3.5 Flash',
    description: 'Model Flash mới nhất',
  },
  {
    id: 'gemini-2.5-flash',
    display_name: 'Gemini 2.5 Flash',
    description: 'Nhanh, chi phí thấp',
  },
  {
    id: 'gemini-flash-latest',
    display_name: 'Gemini Flash Latest',
    description: 'Alias Flash mặc định',
  },
];
const OPENAI_MODEL_FALLBACKS: AiModelOption[] = [
  {
    id: 'gpt-4o-mini',
    display_name: 'ChatGPT / GPT-4o mini',
    description: 'Nhanh, dễ test, chi phí thấp',
  },
  {
    id: 'gpt-4o',
    display_name: 'ChatGPT / GPT-4o',
    description: 'Chất lượng cao',
  },
  {
    id: 'gpt-4.1-mini',
    display_name: 'GPT-4.1 mini',
    description: 'Cân bằng chất lượng và chi phí',
  },
  {
    id: 'gpt-4.1',
    display_name: 'GPT-4.1',
    description: 'Model GPT mạnh hơn cho nội dung',
  },
];
const GROQ_MODEL_FALLBACKS: AiModelOption[] = [
  {
    id: 'llama-3.3-70b-versatile',
    display_name: 'Groq Llama 3.3 70B Versatile',
    description: 'Chất lượng cao',
  },
  {
    id: 'llama-3.1-8b-instant',
    display_name: 'Groq Llama 3.1 8B Instant',
    description: 'Rất nhanh, dễ test',
  },
  {
    id: 'openai/gpt-oss-120b',
    display_name: 'Groq GPT OSS 120B',
    description: 'OpenAI open-weight mạnh',
  },
  {
    id: 'openai/gpt-oss-20b',
    display_name: 'Groq GPT OSS 20B',
    description: 'OpenAI open-weight nhanh',
  },
  {
    id: 'qwen/qwen3-32b',
    display_name: 'Groq Qwen3 32B',
    description: 'Model Qwen đa dụng',
  },
];

function defaultModelForProvider(provider?: string) {
  if (provider === 'groq') return DEFAULT_GROQ_MODEL;
  if (provider === 'openai') return DEFAULT_OPENAI_MODEL;
  return DEFAULT_GEMINI_PRO_MODEL;
}

function fallbackModelsForProvider(provider?: string) {
  if (provider === 'groq') return GROQ_MODEL_FALLBACKS;
  if (provider === 'openai') return OPENAI_MODEL_FALLBACKS;
  return GEMINI_MODEL_FALLBACKS;
}

function shouldUpgradeGeminiModel(model?: string) {
  const value = String(model || '').toLowerCase();
  return !value || value === 'gemini-flash-latest' || value.includes('flash-lite');
}

function shouldUpgradeAiModel(provider: string, model?: string) {
  const value = String(model || '').toLowerCase();
  if (provider === 'groq') return !value || value.startsWith('gemini') || value.startsWith('gpt-4');
  if (provider === 'openai') return !value || value.startsWith('gemini');
  return shouldUpgradeGeminiModel(model);
}

function postGroupId(post: FbPost): string {
  return String(post._group_id || post.group_id || '').trim();
}

function facebookPagesFromChannels(rows: ManagedChannel[]): FbPage[] {
  const pages = new Map<string, FbPage>();
  for (const item of rows) {
    const platform = String(item.platform || '').trim().toLowerCase();
    const type = String(item.channel_type || '').trim().toLowerCase();
    const id = String(item.target_id || '').trim();
    if (platform !== 'facebook' || !['page', 'fanpage', 'trang'].includes(type) || !id) continue;
    pages.set(id, { id, name: item.channel_name || id });
  }
  return [...pages.values()];
}

function readStoredScanSelectedGroups(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SCAN_SELECTED_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

const MONITOR_HEAVY_VIEWS: ViewKey[] = ['manage'];

export function MonitorPage() {
  const [groups, setGroups] = useState<string[]>([]);
  const [scanSelectedGroups, setScanSelectedGroups] = useState<Record<string, boolean>>(readStoredScanSelectedGroups);
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
  const [aiConfig, setAiConfig] = useState<AiConfig>({});
  const [aiProvider, setAiProvider] = useState('gemini');
  const [aiModel, setAiModel] = useState(DEFAULT_GEMINI_PRO_MODEL);
  const [aiModels, setAiModels] = useState<AiModelOption[]>([]);
  const [aiModelStatus, setAiModelStatus] = useState('');
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
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
  const [staffLoading, setStaffLoading] = useState(false);
  const [facebookCookieContext, setFacebookCookieContext] = useState<FacebookCookieContext | null>(null);
  const [facebookCookieBusy, setFacebookCookieBusy] = useState(false);
  const [facebookCookieLoading, setFacebookCookieLoading] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>('home');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try {
      setRailCollapsed(window.localStorage.getItem('console-rail-collapsed') === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem('console-rail-collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
  const [joinPrompt, setJoinPrompt] = useState<JoinPrompt | null>(null);
  const [joinMsg, setJoinMsg] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joiningGroupId, setJoiningGroupId] = useState('');
  const [groupMembership, setGroupMembership] = useState<Record<string, boolean | null>>({});
  const [membershipCheckingIds, setMembershipCheckingIds] = useState<string[]>([]);

  const [postModal, setPostModal] = useState(false);
  const [leadProcessPost, setLeadProcessPost] = useState<FbPost | null>(null);
  const [leadProcessBusy, setLeadProcessBusy] = useState(false);
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
  const [tiktokBridgeReady, setTiktokBridgeReady] = useState(false);
  const [tiktokBridgeVersion, setTiktokBridgeVersion] = useState('');

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [classifyBusy, setClassifyBusy] = useState(false);

  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupsRef = useRef<string[]>([]);
  const scanSelectedGroupsRef = useRef<Record<string, boolean>>({});
  const channelsRef = useRef<ManagedChannel[]>([]);
  const currentStaffRef = useRef<StaffAccount | null>(null);
  const limitRef = useRef(10);
  const autoOnRef = useRef(false);
  const heavyBootstrapDoneRef = useRef(false);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  useEffect(() => {
    scanSelectedGroupsRef.current = scanSelectedGroups;
  }, [scanSelectedGroups]);
  const updateScanSelectedGroups = useCallback(
    (updater: SetStateAction<Record<string, boolean>>) => {
      setScanSelectedGroups((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        scanSelectedGroupsRef.current = next;
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(SCAN_SELECTED_STORAGE_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      });
    },
    [],
  );
  useEffect(() => {
    setScanSelectedGroups((prev) => {
      let changed = false;
      const next = { ...prev };
      groups.forEach((gid) => {
        if (!(gid in next)) {
          next[gid] = false;
          changed = true;
        }
      });
      Object.keys(next).forEach((gid) => {
        if (!groups.includes(gid)) {
          delete next[gid];
          changed = true;
        }
      });
      if (!changed) return prev;
      scanSelectedGroupsRef.current = next;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(SCAN_SELECTED_STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, [groups]);
  useEffect(() => {
    const selected = new Set(groups.filter((gid) => scanSelectedGroups[gid]));
    setAllPosts((posts) => {
      const next = posts.filter((post) => {
        const gid = postGroupId(post);
        if (!gid || !groups.includes(gid)) return true;
        return selected.has(gid);
      });
      return next.length === posts.length ? posts : next;
    });
    setPostFetchReport((report) => {
      const next = report.filter((item) => {
        if (item.target_type === 'page') return true;
        const gid = String(item.group_id || item.target_id || '').trim();
        if (!gid) return true;
        return selected.has(gid);
      });
      return next.length === report.length ? report : next;
    });
  }, [scanSelectedGroups, groups]);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);
  useEffect(() => {
    currentStaffRef.current = currentStaff;
  }, [currentStaff]);
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
      const r = await api('/api/auth/status', { timeoutMs: AUTH_TIMEOUT_MS });
      if (!r.ok) {
        setSetupRequired(false);
        setAuthenticated(false);
        setCurrentStaff(null);
        setAuthStatus(
          r.status >= 500
            ? 'Backend chưa chạy (port 5000). Chạy npm run dev:backend hoặc npm run dev.'
            : `Không kiểm tra được đăng nhập (${r.status})`,
        );
        return;
      }
      const d = await r.json();
      setSetupRequired(!!d.setup_required && !d.simple_login);
      setAuthenticated(!!d.authenticated);
      setCurrentStaff(d.staff || null);
      if (isStaffAdmin(d.staff)) setCanManageStaff(true);
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

  const loadStaffCookies = useCallback(async (options?: { refresh?: boolean }) => {
    setStaffLoading(true);
    try {
      const refreshQuery = options?.refresh ? '?refresh=1' : '';
      const r = await api(`/api/staff-cookies${refreshQuery}`, { timeoutMs: 30000 });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStaffStatus(String(d.error || `Không tải được nhân sự (${r.status})`));
        return;
      }
      setStaffRows(Array.isArray(d.staff) ? d.staff : []);
      setCanManageStaff(!!d.can_manage || isStaffAdmin(currentStaff));
      const selfId = currentStaffRef.current?.id;
      if (selfId) {
        const freshSelf = (d.staff || []).find((item: StaffAccount) => item.id === selfId);
        if (freshSelf) setCurrentStaff(freshSelf);
      }
      if (d.warning) setStaffStatus(`⚠️ ${d.warning}`);
      else setStaffStatus('');
    } catch (err: unknown) {
      setStaffStatus(formatFetchError(err, 'Không tải được cookie nhân sự'));
    } finally {
      setStaffLoading(false);
    }
  }, [currentStaff?.role]);

  const loadFacebookCookieContext = useCallback(async () => {
    setFacebookCookieLoading(true);
    try {
      const r = await api('/api/facebook-cookie/context', { timeoutMs: 30000 });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setFacebookCookieContext({ ok: false, error: d.error || 'Vui lòng đăng nhập lại' });
        return;
      }
      if (r.status === 404) {
        try {
          const r2 = await api('/api/staff-cookies', { timeoutMs: 15000 });
          const d2 = await r2.json().catch(() => ({}));
          if (r2.ok && d2.facebook_context?.ok) {
            setFacebookCookieContext(d2.facebook_context);
            return;
          }
        } catch {
          /* fallback below */
        }
        setFacebookCookieContext({ ok: true, cookies: [] });
        return;
      }
      if (!r.ok || !d.ok) {
        setFacebookCookieContext({ ok: false, error: d.error || `Lỗi server ${r.status}` });
        return;
      }
      setFacebookCookieContext(d);
      if (d.active_facebook_name || d.active_facebook_user_id) {
        setCurrentStaff((prev) => (prev ? {
          ...prev,
          active_facebook_name: d.active_facebook_name || prev.active_facebook_name,
          facebook_user_id: d.active_facebook_user_id || prev.facebook_user_id,
          active_cookie_id: d.active_cookie_id || prev.active_cookie_id,
          facebook_cookies: d.cookies || prev.facebook_cookies,
        } : prev));
      }
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setFacebookCookieContext((prev) => ({
        ...(prev || { ok: true }),
        ok: true,
        error: aborted ? 'Đang đọc tên Facebook... thử bấm «Làm mới tên»' : prev?.error,
      }));
    } finally {
      setFacebookCookieLoading(false);
    }
  }, []);

  const refreshFacebookCookieNames = useCallback(async () => {
    setFacebookCookieLoading(true);
    try {
      const r = await api('/api/facebook-cookie/refresh-names', {
        method: 'POST',
        timeoutMs: 60000,
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setFacebookCookieContext((prev) => ({
          ...(prev || { ok: true }),
          ok: true,
          error: d.error || `Không đọc được tên (${r.status})`,
        }));
        return;
      }
      setFacebookCookieContext(d);
      if (d.message) setToolStatus(d.message);
      else if (d.error) setToolStatus(`❌ ${d.error}`);
      setCurrentStaff((prev) => (prev ? {
        ...prev,
        active_facebook_name: d.active_facebook_name || prev.active_facebook_name,
        facebook_user_id: d.active_facebook_user_id || prev.facebook_user_id,
        active_cookie_id: d.active_cookie_id || prev.active_cookie_id,
        facebook_cookies: d.cookies || prev.facebook_cookies,
      } : prev));
    } catch {
      setFacebookCookieContext((prev) => ({
        ...(prev || { ok: true }),
        ok: true,
        error: 'Không đọc được tên Facebook. Cookie có thể hết hạn.',
      }));
    } finally {
      setFacebookCookieLoading(false);
    }
  }, []);

  const applyScopedFacebookGroups = useCallback((scoped: ManagedChannel[]) => {
    const gIds: string[] = [];
    const gn: Record<string, string> = {};
    for (const item of scoped) {
      const gid = facebookGroupIdFromChannel(item);
      if (!gid || gIds.includes(gid)) continue;
      gIds.push(gid);
      gn[gid] = item.channel_name || gid;
    }
    const prev = groupsRef.current;
    const same = prev.length === gIds.length && gIds.every((id, index) => id === prev[index]);
    groupsRef.current = gIds;
    if (!same) setGroups(gIds);
    setGroupNames((prevNames) => ({ ...prevNames, ...gn }));
    return gIds;
  }, []);

  const adminStaff = isStaffAdmin(currentStaff);
  const manageChannels = useMemo(
    () => filterChannelsForManageScope(channels, currentStaff),
    [channels, currentStaff],
  );
  const facebookGroupChannels = useMemo(
    () => manageChannels.filter(isFacebookGroupChannel),
    [manageChannels],
  );
  const facebookPageChannels = useMemo(
    () => manageChannels.filter((item) => {
      const platform = (item.platform || '').trim().toLowerCase();
      const type = (item.channel_type || '').trim().toLowerCase();
      return platform === 'facebook' && ['page', 'fanpage', 'trang'].includes(type);
    }),
    [manageChannels],
  );
  const tiktokManagedChannels = useMemo(
    () => manageChannels.filter((item) => (item.platform || '').trim().toLowerCase() === 'tiktok'),
    [manageChannels],
  );
  const kenhChannels = useMemo(
    () => (adminStaff ? channels : filterChannelsForStaff(channels, currentStaff)),
    [adminStaff, channels, currentStaff],
  );

  useEffect(() => {
    applyScopedFacebookGroups(facebookGroupChannels);
  }, [facebookGroupChannels, applyScopedFacebookGroups]);

  const loadChannels = useCallback(async () => {
    try {
      const r = await api('/api/channels', { timeoutMs: 45000 });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setChannelStatus('❌ ' + (String(d.error || '') || `Không tải được kênh (${r.status})`));
        return [] as ManagedChannel[];
      }
      if (d.ok) {
        const rows = d.channels || [];
        channelsRef.current = rows;
        setChannels(rows);
        setPages(facebookPagesFromChannels(rows));
        applyScopedFacebookGroups(
          filterChannelsForManageScope(rows, currentStaffRef.current).filter(isFacebookGroupChannel),
        );
        const restored = Number(d.restored_groups || 0);
        setChannelStatus(
          restored > 0
            ? `✅ Đã khôi phục ${restored} nhóm cũ vào Kênh theo dõi${d.warning ? ` · ${d.warning}` : ''}`
            : d.warning ? `⚠️ ${d.warning}` : '',
        );
        return rows as ManagedChannel[];
      } else {
        setChannelStatus('❌ ' + (d.error || 'Không tải được danh sách kênh'));
      }
    } catch (err: unknown) {
      setChannelStatus('❌ ' + formatFetchError(err, 'Lỗi kết nối khi tải kênh'));
    }
    return [] as ManagedChannel[];
  }, [applyScopedFacebookGroups]);

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
    assigned_staff_ids?: string[];
  }, id?: string): Promise<boolean | string> => {
    if (!payload.platform.trim() || !payload.channel_name.trim()) {
      const msg = 'Nhập đủ nền tảng và tên kênh';
      setChannelStatus(msg);
      return msg;
    }
    setChannelBusy(true);
    setChannelStatus(id ? 'Đang cập nhật kênh...' : 'Đang thêm kênh...');
    try {
      const r = await api(id ? `/api/channels/${id}` : '/api/channels', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: 45000,
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        const rows = d.channels || [];
        channelsRef.current = rows;
        setChannels(rows);
        if (payload.assigned_staff_ids !== undefined) {
          await loadStaffCookies({ refresh: true });
        }
        setChannelStatus(
          (id ? '✅ Đã cập nhật kênh' : '✅ Đã thêm kênh') + (d.warning ? ` · ${d.warning}` : ''),
        );
        return true;
      }
      const err = d.error || (r.ok ? 'Không lưu được kênh' : `Lỗi server ${r.status}`);
      setChannelStatus('❌ ' + err);
      return err;
    } catch (err: unknown) {
      const msg = formatFetchError(err, 'Lỗi kết nối khi lưu kênh');
      setChannelStatus('❌ ' + msg);
      return msg;
    } finally {
      setChannelBusy(false);
    }
  }, [loadStaffCookies]);

  const bulkAssignStaffToChannels = useCallback(async (channelIds: string[], staffIds: string[]) => {
    if (!channelIds.length || !staffIds.length) {
      const msg = 'Chọn kênh và nhân sự trước';
      setChannelStatus(msg);
      return msg;
    }
    setChannelBusy(true);
    setChannelStatus(`Đang gán ${staffIds.length} nhân sự cho ${channelIds.length} kênh...`);
    try {
      const r = await api('/api/channels/bulk-assign-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_ids: channelIds, staff_ids: staffIds }),
        timeoutMs: 60000,
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        const rows = d.channels || [];
        channelsRef.current = rows;
        setChannels(rows);
        await loadStaffCookies({ refresh: true });
        setChannelStatus(`✅ Đã gán nhân sự cho ${d.updated || channelIds.length} kênh${d.warning ? ` · ${d.warning}` : ''}`);
        return true;
      }
      const err = d.error || (r.ok ? 'Không gán được nhân sự' : `Lỗi server ${r.status}`);
      setChannelStatus('❌ ' + err);
      return err;
    } catch (err: unknown) {
      const msg = formatFetchError(err, 'Lỗi kết nối khi gán nhân sự');
      setChannelStatus('❌ ' + msg);
      return msg;
    } finally {
      setChannelBusy(false);
    }
  }, [loadStaffCookies]);

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
        setPages(facebookPagesFromChannels(rows));
        const sourceNote = d.source === 'cookie_html' ? ' · lấy bằng cookie HTML' : '';
        const warning = d.warning ? ` · ${d.warning}` : '';
        setChannelStatus(`✅ Đã đồng bộ Page Facebook: thêm ${d.added || 0}, cập nhật ${d.updated || 0}${sourceNote}${warning}`);
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

  const reloadLeads = useCallback(async () => {
    try {
      const r = await api('/api/ai/leads');
      if (r.ok) setLeads(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  const handleCommentSent = useCallback(async (postId: string) => {
    await Promise.all([loadTodayCommentStats(), reloadLeads()]);
    if (postId) {
      setAllPosts((prev) => prev.filter((p) => p.id !== postId));
    }
  }, [loadTodayCommentStats, reloadLeads]);

  const confirmLeadProcessed = useCallback(async (crmStatus: string, assignedSale: string): Promise<Lead> => {
    if (!leadProcessPost) throw new Error('Không có bài viết');
    setLeadProcessBusy(true);
    try {
      const post = leadProcessPost;
      const payload = {
        post_id: post.id,
        group_id: post._group_id || post.group_id || '',
        post_url: post.permalink_url || '',
        message: post.message || '',
        author_name: post.from?.name || '',
        crm_status: crmStatus,
        assigned_sale: assignedSale,
      };
      if (!payload.post_id) throw new Error('Bài viết thiếu ID — tải lại danh sách bài');

      async function parseApiResponse(r: Response) {
        try {
          return await r.json() as { ok?: boolean; lead?: Lead; error?: string; warning?: string };
        } catch {
          throw new Error(
            r.status === 404
              ? 'Backend chưa có API lead — chạy lại npm run dev'
              : `Backend lỗi HTTP ${r.status}`,
          );
        }
      }

      let lead: Lead | undefined;
      let warning = '';

      const markRes = await api('/api/posts/mark-processed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const markData = await parseApiResponse(markRes);
      if (!markData.ok) {
        throw new Error(markData.error || `Không lưu được lead (HTTP ${markRes.status})`);
      }
      if (markData.lead) {
        lead = markData.lead;
        warning = markData.warning || '';
      } else {
        const saveRes = await api('/api/leads/save-processed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (saveRes.status === 404) {
          throw new Error('Backend cũ chưa hỗ trợ Lead CRM — chạy lại npm run dev hoặc deploy Flask mới');
        }
        const saveData = await parseApiResponse(saveRes);
        if (!saveData.ok || !saveData.lead) {
          throw new Error(saveData.error || `Không lưu được lead (HTTP ${saveRes.status})`);
        }
        lead = saveData.lead;
        warning = saveData.warning || markData.warning || '';
      }
      setAllPosts((prev) => prev.filter((p) => p.id !== post.id));
      const pid = String(lead.post_id || post.id);
      setLeads((prev) => {
        const bucket = [...(prev[pid] || [])];
        const idx = bucket.findIndex((item) => item.lead_key === lead.lead_key);
        if (idx >= 0) bucket[idx] = lead;
        else bucket.push(lead);
        return { ...prev, [pid]: bucket };
      });
      void loadCommentLogs();
      if (warning) setToolStatus(`⚠️ ${warning}`);
      return lead;
    } catch (err) {
      throw new Error(formatFetchError(err, 'Không lưu được lead'));
    } finally {
      setLeadProcessBusy(false);
    }
  }, [leadProcessPost, loadCommentLogs]);

  const openLeadProcessModal = useCallback((post: FbPost) => {
    setLeadProcessPost(post);
  }, []);

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
    if (/^\d{6,}$/.test(gid)) {
      setGroupNames((prev) => (prev[gid] && prev[gid] !== gid ? prev : { ...prev, [gid]: prev[gid] || gid }));
    }
    try {
      const r = await api('/api/groups/resolve?slug=' + encodeURIComponent(gid));
      if (r.status === 401) return;
      const d = await r.json();
      if (d.ok && d.name) {
        setGroupNames((prev) => {
          const cached = prev[gid];
          if (cached && cached !== gid) return prev;
          if (prev[gid] === d.name) return prev;
          return { ...prev, [gid]: d.name };
        });
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
    const gids = groupsRef.current.filter((gid) => scanSelectedGroupsRef.current[gid]);
    const visibleChannels = filterChannelsForManageScope(channelsRef.current, currentStaffRef.current);
    const pageIds = visibleChannels
      .filter((item) => (item.platform || '').toLowerCase() === 'facebook')
      .filter((item) => ['page', 'fanpage', 'trang'].includes((item.channel_type || '').trim().toLowerCase()))
      .map((item) => item.target_id || '')
      .filter(Boolean);
    const lim = limitRef.current;
    if (!gids.length && !pageIds.length) {
      setFeedError('');
      setToolStatus(groupsRef.current.length ? 'Chọn ít nhất một nhóm (tick) để quét bài' : 'Chưa có nhóm được phân công');
      return null;
    }
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

  const switchFacebookCookie = useCallback(async (cookieId: string) => {
    if (!cookieId || facebookCookieBusy) return;
    setFacebookCookieBusy(true);
    try {
      const r = await api('/api/facebook-cookie/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie_id: cookieId }),
        timeoutMs: 45000,
      });
      const d = await r.json();
      if (d.ok) {
        setFacebookCookieContext(d);
        setCurrentStaff((prev) => (prev ? {
          ...prev,
          active_facebook_name: d.active_facebook_name || prev.active_facebook_name,
          facebook_user_id: d.active_facebook_user_id || prev.facebook_user_id,
          active_cookie_id: d.active_cookie_id || prev.active_cookie_id,
          facebook_cookies: d.cookies || prev.facebook_cookies,
        } : prev));
        setToolStatus(d.message || 'Đã đổi cookie Facebook');
        setFeedError('');
        setGroupMembership({});
        await loadPages();
        await loadPosts();
      } else {
        setToolStatus(`❌ ${d.error || 'Không đổi được cookie'}`);
      }
    } catch {
      setToolStatus('❌ Không đổi được cookie Facebook');
    } finally {
      setFacebookCookieBusy(false);
    }
  }, [facebookCookieBusy, loadPages, loadPosts]);

  useEffect(() => {
    if (groups.length === 1) {
      const n = groupNames[groups[0]!] || groups[0];
      setHeaderSub(n || '...');
    } else {
      const pageCount = manageChannels.filter((item) => (item.platform || '').toLowerCase() === 'facebook' && ['page', 'fanpage', 'trang'].includes((item.channel_type || '').trim().toLowerCase())).length;
      const parts = [groups.length ? `${groups.length} nhóm` : '', pageCount ? `${pageCount} page` : ''].filter(Boolean);
      setHeaderSub(parts.length ? `${parts.join(' · ')} đang theo dõi` : '...');
    }
  }, [channels, groups, groupNames, manageChannels]);

  const matchKw = useCallback(
    (post: FbPost) => {
      if (!keywords.length) return true;
      const hay = `${post.message || ''} ${post.from?.name || ''}`.toLowerCase();
      return keywords.some((k) => hay.includes(k.toLowerCase()));
    },
    [keywords],
  );

  const filteredPosts = allPosts.filter((p) => {
    const gid = postGroupId(p);
    if (gid && groups.includes(gid) && !scanSelectedGroups[gid]) return false;
    if (!matchKw(p)) return false;
    if (catFilter && classifications[p.id] !== catFilter) return false;
    return true;
  });

  const catOptions = [...new Set(Object.values(classifications))].sort();

  const loadAiModels = useCallback(async (providerArg?: string) => {
    const provider = providerArg || aiProvider || 'gemini';
    setAiModelsLoading(true);
    if (provider === 'openai') {
      setAiModels(OPENAI_MODEL_FALLBACKS);
      setAiModelStatus('');
      setAiModelsLoading(false);
      return;
    }
    try {
      const query = provider === 'groq' ? '?provider=groq' : '';
      const r = await api(`/api/ai/models${query}`, { timeoutMs: 45000 });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        const fallbackRows = fallbackModelsForProvider(provider);
        const rows = Array.isArray(d.models) && d.models.length ? d.models : fallbackRows;
        setAiModels(rows);
        setAiModelStatus(d.warning || '');
      } else {
        setAiModels(fallbackModelsForProvider(provider));
        setAiModelStatus('');
      }
    } catch {
      setAiModels(fallbackModelsForProvider(provider));
      setAiModelStatus('');
    } finally {
      setAiModelsLoading(false);
    }
  }, [aiProvider]);

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
    })();

    return () => {
      cancelled = true;
    };
  }, [authChecked, authenticated]);

  useEffect(() => {
    if (!authChecked || !authenticated) return;
    if (!MONITOR_HEAVY_VIEWS.includes(activeView)) return;
    if (heavyBootstrapDoneRef.current) return;
    heavyBootstrapDoneRef.current = true;
    let cancelled = false;

    const loadAiBundle = async (): Promise<boolean> => {
      try {
        const [cRes, modelsRes, clRes, lRes, csRes] = await Promise.all([
          api('/api/ai/config'),
          api('/api/ai/models', { timeoutMs: 45000 }),
          api('/api/ai/classifications'),
          api('/api/ai/leads'),
          api('/api/ai/comment-summaries'),
        ]);
        if (cancelled) return false;
        const cfg = await cRes.json();
        setAiConfig(cfg);
        const configuredProvider = SUPPORTED_AI_PROVIDERS.includes(cfg.provider || '') ? (cfg.provider as string) : 'gemini';
        setAiProvider(configuredProvider);
        const resolvedModel = shouldUpgradeAiModel(configuredProvider, cfg.model)
          ? defaultModelForProvider(configuredProvider)
          : cfg.model;
        setAiModel(resolvedModel);
        const modelsPayload = await modelsRes.json().catch(() => ({}));
        if (configuredProvider === 'openai') {
          setAiModels(OPENAI_MODEL_FALLBACKS);
          setAiModelStatus('');
        } else if (configuredProvider === 'groq') {
          setAiModels(GROQ_MODEL_FALLBACKS);
          setAiModelStatus('');
        } else if (modelsPayload.ok) {
          setAiModels(Array.isArray(modelsPayload.models) && modelsPayload.models.length ? modelsPayload.models : GEMINI_MODEL_FALLBACKS);
          setAiModelStatus(modelsPayload.warning || '');
        } else {
          setAiModels(GEMINI_MODEL_FALLBACKS);
          setAiModelStatus('');
        }
        if (resolvedModel !== cfg.model || configuredProvider !== cfg.provider) {
          void api('/api/ai/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: configuredProvider, model: resolvedModel }),
          });
        }
        const autoClassify = !!cfg.auto_classify;
        setAiAutoClassify(autoClassify);
        setClassifications(await clRes.json());
        setLeads(await lRes.json());
        setCommentSummaries(await csRes.json());
        return autoClassify;
      } catch {
        return false;
      }
    };

    const loadManageHeavy = async (autoClassify: boolean) => {
      const gIds = groupsRef.current.filter((gid) => scanSelectedGroupsRef.current[gid]);
      void Promise.allSettled(gIds.map((g) => loadGroupName(g)));
      void loadTodayCommentStats();
      const posts = await loadPosts();
      if (cancelled || !autoClassify || !posts?.length) return;
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
    };

    (async () => {
      const supportingLoads = Promise.allSettled([
        loadStaffCookies(),
        loadTg(),
      ]);
      const [, autoClassify] = await Promise.all([
        loadChannels(),
        loadAiBundle(),
      ]);
      void supportingLoads;
      if (cancelled) return;
      void loadManageHeavy(autoClassify);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeView, authChecked, authenticated, loadChannels, loadGroupName, loadPosts, loadStaffCookies, loadTg, loadTodayCommentStats]);

  useEffect(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (!autoOn || !MONITOR_HEAVY_VIEWS.includes(activeView)) {
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
  }, [activeView, autoOn, intervalMin, loadPosts]);

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

  async function saveGroupToChannels(gid: string, gname: string) {
    return saveChannel({
      platform: 'Facebook',
      channel_name: gname || gid,
      channel_type: 'Nhóm',
      link: `https://www.facebook.com/groups/${gid}`,
      target_id: gid,
      note: '',
    });
  }

  async function forceAddGroup(gid: string, gname: string) {
    await saveGroupToChannels(gid, gname);
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
          await saveGroupToChannels(gid, gname);
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
      } else {
        const nextChannels = channelsRef.current.filter((item) => {
          const platform = (item.platform || '').trim().toLowerCase();
          const type = (item.channel_type || '').trim().toLowerCase();
          if (platform !== 'facebook' || !['nhóm', 'nhom', 'group'].includes(type)) return true;
          return facebookGroupIdFromChannel(item) !== gid;
        });
        channelsRef.current = nextChannels;
        setChannels(nextChannels);
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

  async function readTikTokJson(response: Response, label: string): Promise<any> {
    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        throw new Error(`${label} trả HTTP ${response.status} nhưng không phải JSON: ${rawText.slice(0, 180)}`);
      }
    }
    if (!response.ok) {
      const message = String(data.error || data.message || rawText || response.statusText || 'không rõ lỗi');
      throw new Error(`${label} lỗi HTTP ${response.status}: ${message.slice(0, 220)}`);
    }
    return data;
  }

  async function importTikTokDomVideos(videos: Array<Record<string, unknown>>, prefix: string) {
    const importResponse = await api('/api/tiktok/dom-comments/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videos,
        keywords: parseKeywordInput(tiktokKeywords),
      }),
      timeoutMs: PUBLISH_TIMEOUT_MS,
    });
    const imported = await readTikTokJson(importResponse, '/api/tiktok/dom-comments/import');
    if (!imported.ok) {
      throw new Error(imported.error || 'Backend chưa lưu được comment DOM');
    }
    const count = Number(imported.fetched_comment_count || imported.comment_count || 0);
    const warn = imported.warning ? ` · ${imported.warning}` : '';
    setTiktokStatus(`${prefix}: đã lưu thêm ${count} comment từ batch · khớp ${imported.matched_count || 0} · có SĐT ${imported.phone_count || 0} · ${imported.storage}${warn}`);
    return imported;
  }

  async function collectTikTokByExtensionBatches(prefix: string, payload: Record<string, unknown>) {
    const requestedVideos = Math.max(1, Math.min(Number(payload.max_videos || tiktokMaxVideos || 1), 50));
    const requestedLimit = Math.max(1, Math.min(Number(payload.limit_per_video || tiktokLimitPerVideo || 80), 300));
    const batchSize = requestedVideos >= 20 || requestedLimit >= 200 ? 5 : 8;
    let videos: Array<Record<string, unknown>> = Array.isArray(payload.videos)
      ? (payload.videos as Array<Record<string, unknown>>)
      : [];

    if (!videos.length && payload.channel) {
      setTiktokStatus(`${prefix}: đang gom tối đa ${requestedVideos} video bằng Chrome extension...`);
      const videoResult = await requestTiktokExtensionVideos({
        channel: payload.channel,
        max_videos: requestedVideos,
      });
      if (!videoResult.ok || !Array.isArray(videoResult.videos) || !videoResult.videos.length) {
        throw new Error(videoResult.error || 'Extension chưa gom được video TikTok.');
      }
      videos = videoResult.videos.slice(0, requestedVideos);
    }

    if (!videos.length) {
      throw new Error('Chưa có video TikTok để quét bằng extension.');
    }

    const allComments: StoredPostComment[] = [];
    let totalMatched = 0;
    let totalPhones = 0;
    let storage = 'local';
    const warnings: string[] = [];

    for (let start = 0; start < videos.length; start += batchSize) {
      const batch = videos.slice(start, start + batchSize);
      const batchNo = Math.floor(start / batchSize) + 1;
      const totalBatch = Math.ceil(videos.length / batchSize);
      setTiktokStatus(`${prefix}: batch ${batchNo}/${totalBatch} · đang lấy ${batch.length} video · ${requestedLimit} comment/video...`);
      const domResult = await requestTiktokExtensionDomComments({
        videos: batch,
        max_videos: batch.length,
        limit_per_video: requestedLimit,
      });
      if (!domResult.ok && !domResult.videos?.length) {
        warnings.push(`Batch ${batchNo}: ${domResult.error || 'không lấy được comment'}`);
        continue;
      }
      const imported = await importTikTokDomVideos(domResult.videos || [], prefix);
      allComments.push(...(imported.comments || []));
      totalMatched += Number(imported.matched_count || 0);
      totalPhones += Number(imported.phone_count || 0);
      storage = imported.storage || storage;
      if (imported.warning) warnings.push(String(imported.warning));
      setTiktokRows([...allComments]);
      await loadTiktokStats((imported.comments || [])[0]?.post_id || '');
    }

    if (!allComments.length) {
      throw new Error(warnings.slice(0, 3).join(' | ') || 'Extension chạy xong nhưng chưa có comment nào.');
    }

    setTiktokRows(allComments);
    setTiktokStatus(`${prefix}: hoàn tất quét sâu ${videos.length} video · ${allComments.length} comment · khớp ${totalMatched} · có SĐT ${totalPhones} · lưu ${storage}${warnings.length ? ` · cảnh báo: ${warnings.slice(0, 2).join(' | ')}` : ''}`);
    return {
      comments: allComments,
      matched_count: totalMatched,
      phone_count: totalPhones,
      video_count: videos.length,
      storage,
    };
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
      const prefix = tiktokMode === 'video'
        ? 'Video'
        : tiktokMode === 'managed'
          ? `${selectedChannel?.channel_name || 'Các kênh đã lưu'}`
          : `Kênh ${url}`;
      const shouldUseExtensionBatchFirst = tiktokMode !== 'video'
        && tiktokBridgeReady
        && (tiktokMode === 'channel' || Boolean(tiktokManagedChannelId))
        && (tiktokMaxVideos > 30 || tiktokLimitPerVideo > 200);
      if (shouldUseExtensionBatchFirst) {
        const channel = tiktokMode === 'managed'
          ? (selectedChannel?.link || selectedChannel?.target_id || selectedChannel?.channel_name || '')
          : url;
        await collectTikTokByExtensionBatches(prefix, {
          channel,
          max_videos: tiktokMaxVideos,
          limit_per_video: tiktokLimitPerVideo,
        });
        setTiktokBusy(false);
        return;
      }
      const collectHint = '';
      const r = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: PUBLISH_TIMEOUT_MS,
      });
      const d = await readTikTokJson(r, endpoint);
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
        setTiktokStatus(`${prefix}: đã đọc ${d.fetched_comment_count || d.comment_count || 0} comment · ${d.video_count ? `${d.video_count} video · ` : ''}khớp ${d.matched_count || 0} · có SĐT ${d.phone_count || 0} · lưu ${d.storage}${collectHint}${warn}${reportText}`);
        void loadTiktokStats(d.post_id || '');

        const initialCount = Number(d.fetched_comment_count || d.comment_count || 0);
        if (initialCount === 0 && tiktokBridgeReady) {
          const domPayload: Record<string, unknown> = tiktokMode === 'video'
            ? {
                videos: [{
                  post_url: url,
                  channel_name: tiktokChannelName.trim(),
                  video_title: tiktokVideoTitle.trim(),
                }],
                max_videos: 1,
                limit_per_video: tiktokLimitPerVideo,
              }
            : {
                channel: tiktokMode === 'managed'
                  ? (selectedChannel?.link || selectedChannel?.target_id || selectedChannel?.channel_name || '')
                  : url,
                max_videos: tiktokMaxVideos,
                limit_per_video: tiktokLimitPerVideo,
              };
          setTiktokStatus(`${prefix}: backend chưa lấy được comment. Đang dùng Chrome extension để mở TikTok và scrape comment từ giao diện...`);
          await collectTikTokByExtensionBatches(prefix, domPayload);
        } else if (initialCount === 0 && !tiktokBridgeReady) {
          setTiktokStatus(`${prefix}: backend chưa lấy được comment và chưa thấy Chrome extension. Reload/cài extension rồi thử lại để scrape từ giao diện TikTok.${warn}${reportText}`);
        }
      } else {
        setTiktokRows([]);
        setTiktokStatus(`Lỗi: ${d.error || 'Không lấy được comment TikTok'}`);
      }
    } catch (error) {
      setTiktokRows([]);
      setTiktokStatus(`Lỗi kết nối backend: ${formatFetchError(error)}`);
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

  function requestTiktokExtensionOpenComment(payload: Record<string, unknown>): Promise<TikTokBridgeResult> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: 'Chỉ mở được TikTok trên trình duyệt Chrome có cài extension' });
        return;
      }

      const requestId = `tiktok_open_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({ ok: false, error: 'Extension chưa phản hồi khi mở comment TikTok' });
      }, 45000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== 'streal-tiktok-extension') return;
        if (data.type !== 'STREAL_TIKTOK_OPEN_COMMENT_RESPONSE') return;
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
          type: 'STREAL_TIKTOK_OPEN_COMMENT_REQUEST',
          requestId,
          payload,
        },
        window.location.origin,
      );
    });
  }

  function requestTiktokExtensionDomComments(payload: Record<string, unknown>): Promise<TikTokDomCollectResult> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: 'Chỉ scrape được TikTok trên trình duyệt Chrome có cài extension' });
        return;
      }

      const requestId = `tiktok_dom_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({ ok: false, videos: [], error: 'Extension chưa phản hồi khi scrape comment TikTok' });
      }, 240000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== 'streal-tiktok-extension') return;
        if (data.type !== 'STREAL_TIKTOK_COLLECT_DOM_COMMENTS_RESPONSE') return;
        if (data.requestId !== requestId) return;
        cleanup();
        resolve(data as TikTokDomCollectResult);
      };

      function cleanup() {
        window.removeEventListener('message', handleMessage);
        window.clearTimeout(timer);
      }

      window.addEventListener('message', handleMessage);
      window.postMessage(
        {
          source: 'streal-web-page',
          type: 'STREAL_TIKTOK_COLLECT_DOM_COMMENTS_REQUEST',
          requestId,
          payload,
        },
        window.location.origin,
      );
    });
  }

  function requestTiktokExtensionVideos(payload: Record<string, unknown>): Promise<TikTokVideoCollectResult> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, videos: [], error: 'Chỉ gom được video TikTok trên Chrome có cài extension' });
        return;
      }

      const requestId = `tiktok_videos_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({ ok: false, videos: [], error: 'Extension chưa phản hồi khi gom video TikTok' });
      }, 180000);

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== 'streal-tiktok-extension') return;
        if (data.type !== 'STREAL_TIKTOK_COLLECT_VIDEOS_RESPONSE') return;
        if (data.requestId !== requestId) return;
        cleanup();
        resolve(data as TikTokVideoCollectResult);
      };

      function cleanup() {
        window.removeEventListener('message', handleMessage);
        window.clearTimeout(timer);
      }

      window.addEventListener('message', handleMessage);
      window.postMessage(
        {
          source: 'streal-web-page',
          type: 'STREAL_TIKTOK_COLLECT_VIDEOS_REQUEST',
          requestId,
          payload,
        },
        window.location.origin,
      );
    });
  }

  async function openTiktokVideo(item: TikTokCommentStat) {
    if (!item.post_url) return;
    window.open(item.post_url, '_blank', 'noopener,noreferrer');
  }

  async function openTiktokComment(row: StoredPostComment) {
    const fallbackUrl = row.comment_url || row.post_url || '';
    if (!fallbackUrl) return;
    if (!tiktokBridgeReady) {
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      setTiktokCommentStatus('Chưa thấy extension, đã mở link TikTok thường.');
      return;
    }

    setTiktokCommentStatus('Đang mở video và định vị comment TikTok...');
    const result = await requestTiktokExtensionOpenComment({
      post_id: row.post_id,
      video_id: row.post_id?.replace(/^tiktok_/, ''),
      post_url: row.post_url || row.comment_url,
      comment_url: row.comment_url,
      comment_id: row.comment_id,
      comment_text: row.message,
      author_name: row.author_name,
      channel_name: row.channel_name,
      video_title: row.video_title,
    });
    if (result.ok) {
      setTiktokCommentStatus(result.message || 'Đã mở TikTok và ghim comment cần xử lý.');
      return;
    }
    window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    setTiktokCommentStatus(`${result.error || 'Extension chưa định vị được comment'}, đã mở link thường.`);
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
    const provider = next || 'gemini';
    const model = defaultModelForProvider(provider);
    setAiProvider(provider);
    setAiModel(model);
    setAiModels(fallbackModelsForProvider(provider));
    setAiModelStatus('');
    setAiStatus('');
    try {
      await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
        }),
      });
      const cRes = await api('/api/ai/config');
      setAiConfig(await cRes.json());
    } catch {
      setAiStatus('❌ Không kết nối được backend khi đổi AI');
    }
  }

  async function saveAiModel(next: string) {
    setAiModel(next);
    setAiStatus('⏳ Đang lưu model...');
    try {
      const r = await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: aiProvider || 'gemini', model: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        const cRes = await api('/api/ai/config');
        setAiConfig(await cRes.json());
        setAiStatus('✅ Đã lưu model AI');
      } else {
        setAiStatus('❌ ' + (d.error || 'Không lưu được model'));
      }
    } catch {
      setAiStatus('❌ Không kết nối được backend khi lưu model');
    }
    setTimeout(() => setAiStatus(''), 3000);
  }

  async function saveAiKey() {
    if (!aiKeyInput.trim()) {
      setAiStatus('❌ Nhập API key');
      return;
    }
    setAiStatus('⏳ Đang lưu...');
    try {
      const r = await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: aiProvider || 'gemini', model: aiModel, key: aiKeyInput.trim() }),
      });
      const d = await r.json();
      if (d.ok) {
        setAiStatus('✅ Đã lưu key!');
        const cRes = await api('/api/ai/config');
        setAiConfig(await cRes.json());
        setAiKeyEdit(false);
        setAiKeyInput('');
        void loadAiModels(aiProvider || 'gemini');
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
        body: JSON.stringify({ provider: aiProvider || 'gemini', model: aiModel, auto_classify: next }),
      });
    } catch {
      setAiStatus('❌ Không kết nối được backend khi lưu tự động AI');
    }
  }

  async function testAi() {
    setAiStatus('⏳ Đang test...');
    try {
      const body: Record<string, string> = {
        provider: aiProvider || 'gemini',
        model: aiModel || defaultModelForProvider(aiProvider),
      };
      if (aiKeyInput.trim()) body.key = aiKeyInput.trim();
      const r = await api('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      const label = d.provider === 'openai' ? 'OpenAI/ChatGPT' : d.provider === 'groq' ? 'Groq' : 'Gemini';
      setAiStatus(d.ok ? `✅ Kết nối ${label} OK!` : '❌ ' + (d.error || 'Lỗi'));
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

  function removeLeadsFromState(items: { postId: string; leadKey: string }[]) {
    if (!items.length) return;
    const keysByPost = new Map<string, Set<string>>();
    for (const item of items) {
      const set = keysByPost.get(item.postId) || new Set<string>();
      set.add(item.leadKey);
      keysByPost.set(item.postId, set);
    }
    setLeads((prev) => {
      const next = { ...prev };
      for (const [postId, keys] of keysByPost) {
        const bucket = (next[postId] || []).filter((item) => !keys.has(item.lead_key || ''));
        if (bucket.length) next[postId] = bucket;
        else delete next[postId];
      }
      return next;
    });
  }

  async function deleteLead(postId: string, leadKey: string, name?: string) {
    const label = (name || '').trim() || 'lead này';
    if (!confirm(`Xoá ${label}?`)) return;
    setLeadsBusy(true);
    setAiStatus('⏳ Đang xoá lead...');
    try {
      const r = await api(`/api/leads/${encodeURIComponent(leadKey)}?post_id=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      const d = await r.json();
      if (d.ok) {
        removeLeadsFromState([{ postId, leadKey }]);
        setAiStatus('✅ Đã xoá lead');
        if (d.warning) setTimeout(() => setAiStatus(`⚠️ ${d.warning}`), 1200);
      } else {
        setAiStatus(`❌ ${d.error || 'Không xoá được lead'}`);
      }
    } catch {
      setAiStatus('❌ Lỗi kết nối khi xoá lead');
    }
    setLeadsBusy(false);
    setTimeout(() => setAiStatus(''), 7000);
  }

  async function deleteSelectedLeads(items: { postId: string; leadKey: string }[]) {
    if (!items.length) return;
    const label = items.length === 1 ? 'lead này' : `${items.length} lead đã chọn`;
    if (!confirm(`Xoá ${label}?`)) return;
    setLeadsBusy(true);
    setAiStatus(`⏳ Đang xoá ${items.length} lead...`);
    try {
      const r = await api('/api/leads/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({ post_id: item.postId, lead_key: item.leadKey })),
        }),
      });
      const d = await r.json();
      if (d.ok) {
        removeLeadsFromState(items);
        const failed = Number(d.failed || 0);
        setAiStatus(
          failed > 0
            ? `✅ Đã xoá ${d.deleted || items.length} lead · ${failed} lỗi`
            : `✅ Đã xoá ${d.deleted || items.length} lead`,
        );
        if (d.warning) setTimeout(() => setAiStatus(`⚠️ ${d.warning}`), 1200);
      } else {
        setAiStatus(`❌ ${d.error || 'Không xoá được lead'}`);
      }
    } catch {
      setAiStatus('❌ Lỗi kết nối khi xoá lead');
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
        timeoutMs: AUTH_TIMEOUT_MS,
      });
      const d = await r.json();
      if (d.ok) {
        setAuthenticated(true);
        setSetupRequired(false);
        setCurrentStaff(d.staff || null);
        if (isStaffAdmin(d.staff)) setCanManageStaff(true);
        setAuthStatus('');
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
        timeoutMs: AUTH_TIMEOUT_MS,
      });
      const d = await r.json();
      if (d.ok) {
        setAuthenticated(true);
        setSetupRequired(false);
        setCurrentStaff(d.staff || null);
        setAuthStatus('');
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
    setAllPosts([]);
    setHeaderSub('Đã đăng xuất');
  }

  async function saveStaffCookie(payload: StaffPayload, staffId?: string): Promise<{ ok: boolean; error?: string }> {
    payload = {
      ...payload,
      name: String(payload.name || '').trim(),
      username: String(payload.username || '').trim().toLowerCase(),
    };
    setStaffStatus('');
    if (!payload.name.trim() || !payload.username.trim()) {
      const error = 'Nhập đủ tên và tài khoản đăng nhập';
      setStaffStatus(error);
      return { ok: false, error };
    }
    const rawCookies = payload.facebook_cookies || [];
    const skippedCookies = rawCookies.filter(
      (item) => String(item.cookie || '').trim() && !String(item.cookie || '').includes('c_user='),
    );
    const cookies = staffId
      ? rawCookies.filter((item) => {
          const cookie = String(item.cookie || '').trim();
          if (cookie) return cookie.includes('c_user=');
          return Boolean(item.id);
        })
      : rawCookies.filter((item) => {
          const cookie = String(item.cookie || '').trim();
          return cookie && cookie.includes('c_user=');
        });
    payload = {
      ...payload,
      facebook_cookies: cookies,
    };
    if (!staffId && !payload.password) {
      const error = 'Nhập mật khẩu khi thêm nhân sự';
      setStaffStatus(error);
      return { ok: false, error };
    }
    if (!staffId && payload.password.length < 6) {
      const error = 'Mật khẩu tối thiểu 6 ký tự';
      setStaffStatus(error);
      return { ok: false, error };
    }
    setStaffStatus(staffId ? 'Đang cập nhật nhân sự...' : 'Đang lưu nhân sự...');
    try {
      const r = await api(staffId ? `/api/staff-cookies/${staffId}` : '/api/staff-cookies', {
        method: staffId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: 15000,
      });
      const d = await r.json().catch(() => ({
        ok: false,
        error: r.ok ? 'Phản hồi server không hợp lệ' : `Server lỗi ${r.status}`,
      }));
      if (d.ok) {
        setStaffRows(Array.isArray(d.staff) ? d.staff : []);
        setCanManageStaff(!!d.can_manage || isStaffAdmin(currentStaff));
        const savedStaff =
          (d.staff || []).find((item: StaffAccount) => item.id === staffId) ||
          (d.staff || []).find((item: StaffAccount) => item.id === currentStaff?.id) ||
          null;
        if (savedStaff?.id && savedStaff.id === currentStaff?.id) {
          setCurrentStaff(savedStaff);
        }
        const storageText = d.storage === 'supabase' ? 'Supabase' : 'local';
        const staffCount = Array.isArray(d.staff) ? d.staff.length : 0;
        const cookieCount = savedStaff?.facebook_cookies?.length || 0;
        const cookieNote = cookieCount > 1 ? ` · ${cookieCount} cookie FB` : '';
        const selfCookieOnly = staffId && staffId === currentStaff?.id && !d.can_manage;
        setStaffStatus(
          selfCookieOnly
            ? `✅ Đã cập nhật cookie Facebook${cookieNote}${d.warning ? ` · ${d.warning}` : ''}${skippedCookies.length ? ` · Bỏ qua ${skippedCookies.length} cookie thiếu c_user` : ''}`
            : `${staffId ? '✅ Đã cập nhật nhân sự' : '✅ Đã thêm nhân sự'} (${storageText}) · ${staffCount} nhân sự${cookieNote}${d.warning ? ` · ${d.warning}` : ''}${skippedCookies.length ? ` · Bỏ qua ${skippedCookies.length} cookie thiếu c_user` : ''}`,
        );
        return { ok: true };
      } else {
        let err = String(d.error || 'Lỗi lưu nhân sự');
        if (/cookie/i.test(err) && /thiếu|bắt buộc|required/i.test(err)) {
          err += ' — Backend Render chưa cập nhật: vào Render → Manual Deploy branch main.';
        } else if (/đã tồn tại/i.test(err)) {
          err += ' — Dùng tên đăng nhập khác hoặc mở nhân sự cũ để sửa.';
        } else if (/Chỉ admin/i.test(err)) {
          err += ' — Đăng nhập bằng tài khoản admin.';
        }
        setStaffStatus('❌ ' + err);
        return { ok: false, error: err };
      }
    } catch {
      const error = 'Lỗi kết nối server';
      setStaffStatus('❌ ' + error);
      return { ok: false, error };
    }
  }

  async function deleteStaffCookie(staffId: string, options?: { skipConfirm?: boolean }) {
    if (!options?.skipConfirm && !confirm('Xoá nhân sự này?')) return;
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

  const masked = (aiConfig.keys_masked || {})[aiProvider] || '';
  const hasKey = Boolean(masked && masked !== '***' && masked.length > 3);
  const fbMatchedRows = fbCommentRows.filter((row) => row.is_matched);
  const tiktokMatchedRows = tiktokRows.filter((row) => row.is_matched);
  const selectedTiktokStat = tiktokStats.find((item) => item.post_id === tiktokSelectedPostId) || tiktokStats[0];
  const selectedTiktokComments = (selectedTiktokStat?.comments || []).filter((row) => !tiktokOnlyPhone || !!row.phones?.length);
  const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString('vi-VN') : '-');

  useEffect(() => {
    if (!authenticated) return;
    if (activeView === 'history') void loadCommentLogs();
    if (activeView === 'leads') void reloadLeads();
    if (activeView === 'channels') void loadChannels();
    if (activeView === 'channels' || activeView === 'staff') void loadStaffCookies();
    if (activeView === 'manage') void loadFacebookCookieContext();
    if (activeView === 'staff') {
      void loadChannels();
    }
    if (activeView === 'marketing') {
      void loadContentPipeline();
      void loadChannels();
    }
  }, [activeView, authenticated, loadChannels, loadCommentLogs, loadContentPipeline, loadFacebookCookieContext, loadStaffCookies, refreshFacebookCookieNames, reloadLeads]);

  if (!authChecked) {
    return (
      <main className="auth-page">
        <div className="auth-loading">
          <img src="/LOGO4_XOANEN.png" alt={APP_BRAND.name} />
          <div className="auth-loading-text">
            <b>{APP_BRAND.name}</b>
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
      <div className={`console-shell${railCollapsed ? ' rail-collapsed' : ''}`}>
        <ConsoleRail
          activeView={activeView}
          onNavigate={openView}
          collapsed={railCollapsed}
          onToggleCollapse={toggleRailCollapsed}
        />

        <main
          className={`console-content${
            activeView === 'manage' ? ' manage-active' : ''
          }${activeView === 'marketing' ? ' marketing-active' : ''}${
            activeView === 'scripts' ? ' scripts-active' : ''
          }${activeView === 'approved' ? ' approved-active' : ''}${
            activeView === 'plan' ? ' plan-active' : ''
          }`}
        >
          {activeView !== 'manage' && activeView !== 'marketing' ? (
          <div className="console-topbar">
            <button type="button" className="rail-collapse" title={railCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'} onClick={toggleRailCollapsed}>
              ☰
            </button>
            <div>
              <div className="console-page-title">{CONSOLE_NAV_ITEMS.find((item) => item.key === activeView)?.label || 'Trang chủ'}</div>
              <div className="console-page-sub" title={groups.length === 1 ? `ID: ${groups[0]}` : ''}>
                {APP_BRAND.name}
              </div>
            </div>
            <div className="header-spacer" />
            <div className="console-clock">{new Date().toLocaleDateString('vi-VN')}</div>
            <div className="header-user">
              {currentStaff?.name || currentStaff?.username} · {adminStaff ? 'admin' : 'nhân sự'}
            </div>
            <button type="button" className="header-logout" onClick={() => void logout()}>
              Đăng xuất
            </button>
          </div>
          ) : null}

          {activeView === 'home' ? <ConsoleHome staffName={currentStaff?.name || currentStaff?.username} onOpen={openView} /> : null}
          {activeView === 'channels' ? (
            <ChannelManagerPanel
              channels={kenhChannels}
              staff={staffRows}
              viewAll={adminStaff}
              canAssignStaff={canManageStaff || adminStaff}
              status={channelStatus}
              busy={channelBusy}
              onSave={saveChannel}
              onDelete={deleteChannel}
              onReload={loadChannels}
              onSyncFacebookPages={syncFacebookPages}
              onBulkAssignStaff={bulkAssignStaffToChannels}
            />
          ) : null}
          {activeView === 'report' ? (
            <section style={{ padding: 16, height: 'calc(100vh - 120px)' }}>
              <iframe
                src="https://baocaoxuonggita.vercel.app/"
                title="Báo cáo"
                style={{
                  width: '100%',
                  height: '100%',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  background: '#fff',
                }}
              />
            </section>
          ) : null}
          {activeView === 'history' ? <HistoryPanel rows={commentLogs} status={historyStatus} onReload={loadCommentLogs} /> : null}
          {activeView === 'leads' ? (
            <LeadManagerPanel
              leads={leads}
              groupNames={groupNames}
              busy={leadsBusy}
              onDelete={deleteLead}
              onDeleteMany={deleteSelectedLeads}
            />
          ) : null}
          {activeView === 'scripts' ? <ScriptWriterPanel /> : null}
          {activeView === 'plan' ? <ContentPlanPanel /> : null}
          {activeView === 'approved' ? <ApprovedScriptsPanel /> : null}
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
              <StaffCookiePanel
                staff={staffRows}
                channels={channels}
                currentStaff={currentStaff}
                canManage={canManageStaff || adminStaff}
                status={staffLoading ? 'Đang tải danh sách nhân sự...' : staffStatus}
                title="Nhân sự"
                kicker="Quản lý tài khoản"
                onSave={saveStaffCookie}
                onDelete={deleteStaffCookie}
                onModalOpen={() => setStaffStatus('')}
              />
          ) : null}

      {activeView === 'manage' ? (
        <ManageDashboardPanel
          staffName={currentStaff?.name || currentStaff?.username}
          staffRole={currentStaff?.role}
          staffGroupsScoped
          currentStaff={currentStaff}
          facebookCookieContext={facebookCookieContext}
          facebookCookieBusy={facebookCookieBusy}
          facebookCookieLoading={facebookCookieLoading}
          onRefreshFacebookCookie={() => void refreshFacebookCookieNames()}
          onSwitchFacebookCookie={(cookieId) => void switchFacebookCookie(cookieId)}
          headerSub={headerSub}
          onLogout={() => void logout()}
          onOpenView={openView}
          onOpenChannels={() => openView('channels')}
          groups={groups}
          groupNames={groupNames}
          scanSelectedGroups={scanSelectedGroups}
          onScanSelectedGroupsChange={updateScanSelectedGroups}
          facebookPageChannels={facebookPageChannels}
          facebookGroupChannels={facebookGroupChannels}
          tiktokManagedChannels={tiktokManagedChannels}
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
          onMarkProcessed={openLeadProcessModal}
          onOpenLightbox={setLightbox}
          saleSetupProps={{
            aiProvider,
            onProviderChange: (v) => { setAiProvider(v); void onProviderChange(v); },
            aiModel,
            aiModels,
            aiModelStatus,
            aiModelsLoading,
            onModelChange: (v) => void saveAiModel(v),
            onRefreshModels: () => void loadAiModels(),
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

      <LeadProcessedModal
        post={leadProcessPost}
        groupName={
          leadProcessPost
            ? groupNames[leadProcessPost._group_id || leadProcessPost.group_id || ''] || ''
            : ''
        }
        processorName={currentStaff?.name || currentStaff?.username}
        busy={leadProcessBusy}
        onClose={() => setLeadProcessPost(null)}
        onConfirm={confirmLeadProcessed}
        onOpenLeads={() => {
          setLeadProcessPost(null);
          openView('leads');
        }}
      />

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
                              <button type="button" className="inline-link-button" onClick={(event) => {
                                event.stopPropagation();
                                void openTiktokVideo(item);
                              }}>
                                Mở
                              </button>
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
                          Chưa có dữ liệu TikTok. Mở trang Bình luận để lấy comment trước.
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
                              <button type="button" className="inline-link-button" onClick={() => void openTiktokComment(row)}>
                                Mở CMT
                              </button>
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
