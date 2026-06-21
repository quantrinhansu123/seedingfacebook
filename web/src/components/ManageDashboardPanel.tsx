'use client';

import { useState } from 'react';
import { CommentTemplatesSidebar } from '@/components/CommentTemplatesSidebar';
import { CookieRefreshGuide } from '@/components/CookieRefreshGuide';
import { PostCard } from '@/components/PostCard';
import { SaleSetupPanel } from '@/components/SaleSetupPanel';
import type { StaffPayload } from '@/components/StaffCookiePanel';
import type { ViewKey } from '@/lib/app-routes';
import type {
  CommentSummary,
  FacebookCookieContext,
  FbPage,
  FbPost,
  Lead,
  ManagedChannel,
  StaffAccount,
  StaffFacebookCookie,
} from '@/lib/types';
import { classifyFacebookFeedError, facebookGroupIdFromChannel } from '@/lib/utils';
import './manage-dashboard.css';

type JoinPrompt = { id: string; name: string };

function isInvalidFacebookDisplayName(name?: string): boolean {
  const text = String(name || '').trim().toLowerCase();
  if (!text) return true;
  if (text.includes('đăng nhập') && text.includes('facebook')) return true;
  if (text.includes('log in') && text.includes('facebook')) return true;
  return text === 'facebook' || text === 'login' || text === 'log in';
}

function pickFacebookDisplayName(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value && !isInvalidFacebookDisplayName(value)) return value;
  }
  return '';
}

function buildFacebookCookiesFromStaff(staff?: StaffAccount | null): StaffFacebookCookie[] {
  if (!staff) return [];
  const rows = staff.facebook_cookies || [];
  if (rows.length) {
    const activeId = staff.active_cookie_id || rows[0]?.id || '';
    return rows.map((item, index) => ({
      ...item,
      id: item.id || `fb_${index}`,
      active: item.id === activeId || (!activeId && index === 0),
    }));
  }
  if (staff.facebook_user_id || staff.cookie_masked || staff.active_facebook_name) {
    return [{
      id: staff.active_cookie_id || 'primary',
      label: 'Cookie chính',
      facebook_user_id: staff.facebook_user_id,
      facebook_name: staff.active_facebook_name,
      cookie_masked: staff.cookie_masked,
      active: true,
    }];
  }
  return [];
}

function renderFacebookAccountBar(props: {
  cookies: StaffFacebookCookie[];
  activeId?: string;
  activeName: string;
  activeUserId: string;
  busy?: boolean;
  loading?: boolean;
  error?: string;
  onSwitch?: (cookieId: string) => void;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  const {
    cookies,
    activeId,
    activeName,
    activeUserId,
    busy,
    loading,
    error,
    onSwitch,
    onRefresh,
    compact,
  } = props;
  const resolvedActiveId = activeId || cookies.find((item) => item.active)?.id || cookies[0]?.id || '';
  const activeCookie = cookies.find((item) => item.id === resolvedActiveId) || cookies[0];
  const displayName =
    pickFacebookDisplayName(activeCookie?.facebook_name, activeName, activeCookie?.label) ||
    (activeUserId || activeCookie?.facebook_user_id ? `Facebook ID ${activeUserId || activeCookie?.facebook_user_id}` : 'Chưa có cookie Facebook');
  const displayUserId = activeCookie?.facebook_user_id || activeUserId || '';
  const showError = error || (isInvalidFacebookDisplayName(activeCookie?.facebook_name) && isInvalidFacebookDisplayName(activeName));
  return (
    <div className={`md-fb-account-bar${compact ? ' compact' : ''}`}>
      <div className="md-fb-cookie-current">
        <i className="fa-brands fa-facebook" />
        <div className="md-fb-cookie-current-body">
          <p className="md-fb-cookie-label">Tài khoản Facebook đang dùng</p>
          <p className="md-fb-cookie-name">{loading && !displayName ? 'Đang đọc tên tài khoản...' : displayName}</p>
          {displayUserId ? <small className="md-fb-cookie-id">ID: {displayUserId}</small> : null}
          {showError ? <small className="md-fb-cookie-error">{error || 'Cookie hết hạn hoặc chưa đọc được tên — bấm «Làm mới tên» hoặc lấy cookie mới từ Chrome.'}</small> : null}
          {cookies.length ? (
            <div className="md-fb-cookie-list" role="tablist" aria-label="Chọn cookie Facebook">
              {cookies.map((item, index) => {
                const cookieId = item.id || `fb_${index}`;
                const isActive = cookieId === resolvedActiveId;
                const title = item.facebook_name || item.label || `Cookie ${index + 1}`;
                const subtitle = item.facebook_user_id || item.cookie_masked || '';
                return (
                  <button
                    key={cookieId}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`md-fb-cookie-chip${isActive ? ' active' : ''}`}
                    disabled={busy || loading || isActive}
                    title={subtitle || title}
                    onClick={() => onSwitch?.(cookieId)}
                  >
                    <span className="md-fb-cookie-chip-name">{title}</span>
                    {item.facebook_user_id ? <small>{item.facebook_user_id}</small> : null}
                    {isActive ? <span className="md-fb-cookie-chip-badge">Đang dùng</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="md-fb-account-actions">
        <button type="button" className="md-ghost-btn" disabled={busy || loading} onClick={() => onRefresh?.()}>
          {loading ? 'Đang tải...' : 'Làm mới tên'}
        </button>
      </div>
    </div>
  );
}

type PostFetchItem = {
  ok?: boolean;
  target_type?: string;
  group_id?: string;
  group_name?: string;
  count?: number;
  error?: string;
};

export type ManageDashboardProps = {
  staffName?: string;
  staffRole?: string;
  staffGroupsScoped?: boolean;
  currentStaff?: StaffAccount | null;
  facebookCookieContext?: FacebookCookieContext | null;
  facebookCookieBusy?: boolean;
  facebookCookieLoading?: boolean;
  onSwitchFacebookCookie?: (cookieId: string) => void;
  onRefreshFacebookCookie?: () => void;
  headerSub?: string;
  onLogout: () => void;
  onOpenView: (view: ViewKey) => void;
  onOpenChannels: () => void;
  groups: string[];
  groupNames: Record<string, string>;
  scanSelectedGroups: Record<string, boolean>;
  onScanSelectedGroupsChange: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  facebookPageChannels: ManagedChannel[];
  facebookGroupChannels: ManagedChannel[];
  tiktokManagedChannels: ManagedChannel[];
  onRemoveGroup: (id: string) => void;
  joinPrompt: JoinPrompt | null;
  joinBusy: boolean;
  joinMsg: string;
  onDismissJoin: () => void;
  onJoinGroup: (id: string, name: string) => void;
  onForceAddGroup: (id: string, name: string) => void;
  onRefreshMembership: (ids: string[]) => void;
  groupMembership: Record<string, boolean | null>;
  membershipCheckingIds: string[];
  joiningGroupId: string;
  onSyncFacebookPages: () => void;
  channelBusy: boolean;
  keywords: string[];
  kwInp: string;
  setKwInp: (v: string) => void;
  onAddKw: () => void;
  onRemoveKw: (kw: string) => void;
  tgIds: string[];
  tgInp: string;
  setTgInp: (v: string) => void;
  onAddTg: () => void;
  onRemoveTg: (id: string) => void;
  onTestTg: (id: string) => void;
  tgStatus: string;
  limit: number;
  setLimit: (n: number) => void;
  loading: boolean;
  onLoadPosts: () => void;
  onOpenPostModal: () => void;
  classifyBusy: boolean;
  onClassifyAll: () => void;
  leadsBusy: boolean;
  onExtractLeads: () => void;
  onOpenTiktokStats: () => void;
  catFilter: string;
  setCatFilter: (v: string) => void;
  catOptions: string[];
  autoOn: boolean;
  onToggleAuto: () => void;
  intervalMin: number;
  setIntervalMin: (n: number) => void;
  onSaveSettings: (auto: boolean, min: number) => void;
  todayCommentCount: number | null;
  toolStatus: string;
  feedError: string;
  postFetchReport: PostFetchItem[];
  filteredPosts: FbPost[];
  allPostsCount: number;
  classifications: Record<string, string>;
  pages: FbPage[];
  leads: Record<string, Lead[]>;
  commentSummaries: Record<string, CommentSummary>;
  onSummarizeComments: (post: FbPost) => Promise<string>;
  onExploreComments: (post: FbPost) => void;
  onCommentSent: (postId: string) => void | Promise<void>;
  onMarkProcessed?: (post: FbPost) => void | Promise<void>;
  onOpenLightbox: (url: string) => void;
  saleSetupProps: React.ComponentProps<typeof SaleSetupPanel>;
};

export function ManageDashboardPanel(props: ManageDashboardProps) {
  const {
    staffName,
    staffRole,
    staffGroupsScoped = false,
    currentStaff,
    facebookCookieContext,
    facebookCookieBusy = false,
    facebookCookieLoading = false,
    onSwitchFacebookCookie,
    onRefreshFacebookCookie,
    headerSub,
    onLogout,
    onOpenView,
    onOpenChannels,
    groups,
    groupNames,
    scanSelectedGroups,
    onScanSelectedGroupsChange,
    facebookPageChannels,
    facebookGroupChannels,
    tiktokManagedChannels,
    onRemoveGroup,
    joinPrompt,
    joinBusy,
    joinMsg,
    onDismissJoin,
    onJoinGroup,
    onForceAddGroup,
    onRefreshMembership,
    groupMembership,
    membershipCheckingIds,
    joiningGroupId,
    onSyncFacebookPages,
    channelBusy,
    keywords,
    kwInp,
    setKwInp,
    onAddKw,
    onRemoveKw,
    tgIds,
    tgInp,
    setTgInp,
    onAddTg,
    onRemoveTg,
    onTestTg,
    tgStatus,
    limit,
    setLimit,
    loading,
    onLoadPosts,
    onOpenPostModal,
    classifyBusy,
    onClassifyAll,
    leadsBusy,
    onExtractLeads,
    onOpenTiktokStats,
    catFilter,
    setCatFilter,
    catOptions,
    autoOn,
    onToggleAuto,
    intervalMin,
    setIntervalMin,
    onSaveSettings,
    todayCommentCount,
    toolStatus,
    feedError,
    postFetchReport,
    filteredPosts,
    allPostsCount,
    classifications,
    pages,
    leads,
    commentSummaries,
    onSummarizeComments,
    onExploreComments,
    onCommentSent,
    onMarkProcessed,
    onOpenLightbox,
    saleSetupProps,
  } = props;

  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieDetail, setCookieDetail] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [tgOpen, setTgOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const selectedGroupIds = groups.filter((gid) => scanSelectedGroups[gid]);
  const checkingSet = new Set(membershipCheckingIds);

  function toggleGroupSelected(gid: string, checked: boolean) {
    onScanSelectedGroupsChange((prev) => ({ ...prev, [gid]: checked }));
  }

  function toggleSelectAllGroups(checked: boolean) {
    if (!checked) {
      onScanSelectedGroupsChange({});
      return;
    }
    const next: Record<string, boolean> = {};
    groups.forEach((gid) => {
      next[gid] = true;
    });
    onScanSelectedGroupsChange(next);
  }

  function checkSelectedMembership() {
    const ids = selectedGroupIds.length ? selectedGroupIds : groups;
    if (!ids.length) return;
    onRefreshMembership(ids);
  }

  function membershipLabel(gid: string): string {
    if (checkingSet.has(gid)) return 'Đang kiểm tra...';
    const member = groupMembership[gid];
    if (member === true) return 'Đã tham gia';
    if (member === false) return 'Chưa tham gia';
    return 'Chưa kiểm tra';
  }

  function membershipClass(gid: string): string {
    if (checkingSet.has(gid)) return ' pending';
    const member = groupMembership[gid];
    if (member === true) return ' ok';
    if (member === false) return ' warn';
    return ' idle';
  }

  const roleLabel = staffRole === 'admin' ? 'Administrator' : 'Nhân sự';
  const fbCookies = facebookCookieContext?.cookies?.length
    ? facebookCookieContext.cookies
    : buildFacebookCookiesFromStaff(currentStaff);
  const activeFbName = pickFacebookDisplayName(
    facebookCookieContext?.active_facebook_name,
    fbCookies.find((item) => item.active)?.facebook_name,
    currentStaff?.active_facebook_name,
  );
  const activeFbId =
    facebookCookieContext?.active_facebook_user_id ||
    fbCookies.find((item) => item.active)?.facebook_user_id ||
    currentStaff?.facebook_user_id ||
    '';
  const activeCookieId =
    facebookCookieContext?.active_cookie_id ||
    currentStaff?.active_cookie_id ||
    fbCookies.find((item) => item.active)?.id ||
    '';
  const fbCookieError = facebookCookieContext?.ok === false ? facebookCookieContext.error : '';
  const feedErrorKind = classifyFacebookFeedError(feedError);
  const feedErrorTitle =
    feedErrorKind === 'network'
      ? 'Không kết nối được Facebook Graph API'
      : feedErrorKind === 'auth'
        ? 'Xác thực Facebook không hợp lệ'
        : 'Không tải được bài từ Facebook';

  return (
    <div className="manage-dashboard">
      <div className="md-main">
        <header className="md-header">
          <h2>SocialNexus Enterprise — {headerSub || 'Quản lý'}</h2>
          <div className="md-header-right">
            <button type="button" className="md-modules-btn" onClick={() => onOpenView('home')}>
              <i className="fa-solid fa-table-cells-large" />
              Module khác
            </button>
            <div className="md-date-pill">
              <i className="fa-regular fa-calendar" />
              <span>{new Date().toLocaleDateString('vi-VN')}</span>
            </div>
            <div className="md-header-divider" />
            <div className="md-user-block">
              <p className="md-user-name">{staffName || 'Nhân sự'}</p>
              <p className="md-user-role">{roleLabel}</p>
            </div>
            <div className="md-avatar">
              <i className="fa-solid fa-user" />
              <span className="md-online" />
            </div>
            <button type="button" className="md-exit-btn" onClick={onLogout}>
              Thoát
            </button>
          </div>
        </header>

        {renderFacebookAccountBar({
          cookies: fbCookies,
          activeId: activeCookieId,
          activeName: activeFbName,
          activeUserId: activeFbId,
          busy: facebookCookieBusy,
          loading: facebookCookieLoading,
          error: fbCookieError,
          onSwitch: onSwitchFacebookCookie,
          onRefresh: onRefreshFacebookCookie,
        })}

        <div className="md-split">
          <div className="md-secondary no-scrollbar">
              <div className="md-secondary-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <i className="fa-solid fa-gear" />
                  <span>Quản lý nguồn &amp; Từ khoá</span>
                </div>
              </div>

              <div className="md-secondary-body">
                <section className="md-source-block md-source-block--group">
                  <div className="md-source-block-head">
                    <div className="md-source-block-title">
                      <i className="fa-solid fa-users" />
                      <span>Nhóm Facebook</span>
                    </div>
                    <span className="md-source-block-count">{facebookGroupChannels.length}</span>
                  </div>

                  {joinMsg && !joinPrompt ? (
                    <div className={`md-join-feedback${joinMsg.startsWith('❌') ? ' error' : ''}`}>{joinMsg}</div>
                  ) : null}

                  <p className="md-join-hint">
                    Chỉ hiển thị <b>nhóm/kênh được phân công</b> cho tài khoản đang đăng nhập
                    {staffGroupsScoped ? '' : ' (admin gán tại /kenh → Sửa kênh → Nhân sự phụ trách)'}.
                    Chỉ <b>quét bài</b> từ các nhóm đã tick. Nhóm kín thường phải bấm <b>Mở FB</b> rồi <b>Kiểm tra lại</b>.
                  </p>

                  {facebookGroupChannels.length ? (
                    <div className="md-membership-toolbar">
                      <label className="md-check-all">
                        <input
                          type="checkbox"
                          checked={groups.length > 0 && selectedGroupIds.length === groups.length}
                          onChange={(e) => toggleSelectAllGroups(e.target.checked)}
                        />
                        Chọn tất cả
                      </label>
                      <button
                        type="button"
                        className="md-ghost-btn"
                        disabled={!groups.length || checkingSet.size > 0}
                        onClick={checkSelectedMembership}
                      >
                        {checkingSet.size > 0
                          ? 'Đang kiểm tra...'
                          : `Kiểm tra lại${selectedGroupIds.length ? ` (${selectedGroupIds.length})` : ''}`}
                      </button>
                    </div>
                  ) : null}

                  {joinPrompt ? (
                    <div className="md-pending-group">
                      <div>
                        <p>{joinPrompt.name}</p>
                        <small>Chưa tham gia nhóm — cần tham gia để theo dõi bài viết</small>
                        {joinMsg ? <small className="md-join-inline-msg">{joinMsg}</small> : null}
                      </div>
                      <div className="md-source-actions">
                        <button
                          type="button"
                          className="md-join-btn"
                          disabled={joinBusy}
                          onClick={() => onJoinGroup(joinPrompt.id, joinPrompt.name)}
                        >
                          {joinBusy ? 'Đang tham gia...' : 'Tự tham gia'}
                        </button>
                        <a
                          className="md-ghost-btn"
                          href={`https://www.facebook.com/groups/${joinPrompt.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Mở FB
                        </a>
                        <button type="button" className="md-ghost-btn" onClick={() => onForceAddGroup(joinPrompt.id, joinPrompt.name)}>
                          Theo dõi
                        </button>
                        <button type="button" className="md-remove-btn" onClick={onDismissJoin} title="Đóng">
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="md-source-list">
                    {facebookGroupChannels.length ? facebookGroupChannels.map((item) => {
                      const gid = facebookGroupIdFromChannel(item);
                      if (!gid) return null;
                      const member = groupMembership[gid];
                      const gname = item.channel_name || groupNames[gid] || gid;
                      const isChecking = checkingSet.has(gid);
                      return (
                        <div key={item.id || gid} className={`md-source-item group${member !== true ? ' not-member' : ''}`}>
                          <label className="md-group-check">
                            <input
                              type="checkbox"
                              checked={!!scanSelectedGroups[gid]}
                              onChange={(e) => toggleGroupSelected(gid, e.target.checked)}
                            />
                          </label>
                          <div>
                            <p>{gname}</p>
                            {gname !== gid ? <small>{gid}</small> : null}
                            <span className={`md-member-badge${membershipClass(gid)}`}>{membershipLabel(gid)}</span>
                          </div>
                          <div className="md-source-actions">
                            {member !== true ? (
                              <>
                                <button
                                  type="button"
                                  className="md-join-btn"
                                  disabled={joiningGroupId === gid}
                                  onClick={() => onJoinGroup(gid, gname)}
                                >
                                  {joiningGroupId === gid ? '...' : 'Tham gia'}
                                </button>
                                <a
                                  className="md-ghost-btn"
                                  href={item.link || `https://www.facebook.com/groups/${gid}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Mở FB
                                </a>
                              </>
                            ) : null}
                            <button
                              type="button"
                              className="md-delete-btn"
                              onClick={() => onRemoveGroup(gid)}
                              title="Xoá khỏi /kenh"
                            >
                              <i className="fa-solid fa-trash-can" />
                              Xoá
                            </button>
                          </div>
                        </div>
                      );
                    }) : (
                      <span className="md-empty">
                        Chưa có nhóm được phân công — admin gán tại /kenh → Sửa kênh → Nhân sự phụ trách.
                      </span>
                    )}
                  </div>
                  <div className="md-source-block-actions">
                    <button type="button" className="md-btn-dark" onClick={onOpenChannels}>
                      Thêm nhóm
                    </button>
                  </div>
                </section>

                <section className="md-source-block md-source-block--page">
                  <div className="md-source-block-head">
                    <div className="md-source-block-title">
                      <i className="fa-brands fa-facebook" />
                      <span>Fanpage</span>
                    </div>
                    <span className="md-source-block-count">{facebookPageChannels.length}</span>
                  </div>
                  <div className="md-source-list">
                    {facebookPageChannels.length ? facebookPageChannels.map((item) => (
                      <div key={item.id || item.target_id} className="md-source-item page-item">
                        <a
                          href={item.link || (item.target_id ? `https://www.facebook.com/${item.target_id}` : '#')}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <i className="fa-brands fa-facebook" />
                          <span>{item.channel_name || item.target_id || 'Fanpage'}</span>
                        </a>
                      </div>
                    )) : (
                      <span className="md-empty">Chưa có Fanpage</span>
                    )}
                  </div>
                  <div className="md-source-block-actions">
                    <button type="button" className="md-btn-dark" disabled={channelBusy} onClick={onSyncFacebookPages}>
                      {channelBusy ? 'Đang đồng bộ...' : 'Đồng bộ Page'}
                    </button>
                    <button type="button" className="md-ghost-btn" onClick={onOpenChannels}>
                      Thêm Page
                    </button>
                  </div>
                </section>

                <section className="md-source-block md-source-block--tiktok">
                  <div className="md-source-block-head">
                    <div className="md-source-block-title">
                      <i className="fa-brands fa-tiktok" />
                      <span>TikTok</span>
                    </div>
                    <span className="md-source-block-count">{tiktokManagedChannels.length}</span>
                  </div>
                  <div className="md-source-list">
                    {tiktokManagedChannels.length ? tiktokManagedChannels.map((item) => (
                      <div key={item.id || item.target_id} className="md-source-item tiktok-item">
                        <a href={item.link || '#'} target="_blank" rel="noreferrer">
                          <i className="fa-brands fa-tiktok" />
                          <span>{item.channel_name || item.target_id || 'Kênh TikTok'}</span>
                        </a>
                      </div>
                    )) : (
                      <span className="md-empty">Chưa có kênh TikTok</span>
                    )}
                  </div>
                  <div className="md-source-block-actions">
                    <button type="button" className="md-btn-dark" onClick={onOpenChannels}>
                      Quản lý TikTok
                    </button>
                  </div>
                </section>

                <>
                  <hr className="md-divider" />
                  <div>
                      <div className="md-section-label">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="fa-solid fa-magnifying-glass" />
                          <span>Từ khoá lọc</span>
                        </div>
                      </div>
                      <div className="md-chip-list" style={{ marginTop: 12 }}>
                        {keywords.map((kw) => (
                          <span key={kw} className="md-chip kw">
                            {kw}
                            <button type="button" onClick={() => onRemoveKw(kw)} aria-label="Xoá">
                              <i className="fa-solid fa-xmark" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="md-input-row">
                        <input
                          className="amber"
                          type="text"
                          placeholder="Thêm từ khoá..."
                          value={kwInp}
                          onChange={(e) => setKwInp(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && onAddKw()}
                        />
                        <button type="button" className="md-btn-icon amber" onClick={onAddKw}>
                          <i className="fa-solid fa-plus" />
                        </button>
                      </div>
                      {keywords.length ? (
                        <p className="md-hint">Chỉ hiển thị bài chứa ít nhất 1 từ khoá</p>
                      ) : null}
                    </div>
                  </>

                <>
                  <hr className="md-divider" />
                  <div>
                      <button type="button" className="md-accordion-toggle" onClick={() => setTgOpen((v) => !v)}>
                        <div className="md-section-label" style={{ margin: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="fa-regular fa-paper-plane" />
                            <span>Telegram</span>
                          </div>
                        </div>
                        <i className={`fa-solid fa-chevron-${tgOpen ? 'up' : 'down'} text-slate-400 text-sm`} />
                      </button>
                      {tgOpen ? (
                        <div style={{ marginTop: 12 }}>
                          <div className="md-chip-list">
                            {tgIds.map((cid) => (
                              <span key={cid} className="md-chip tg">
                                {cid}
                                <span className="md-chip-test" onClick={() => onTestTg(cid)} role="presentation">Test</span>
                                <button type="button" onClick={() => onRemoveTg(cid)} aria-label="Xoá">
                                  <i className="fa-solid fa-xmark" />
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="md-input-row">
                            <input
                              type="text"
                              placeholder="Chat ID"
                              value={tgInp}
                              onChange={(e) => setTgInp(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && onAddTg()}
                            />
                            <button type="button" className="md-btn-icon tg" onClick={onAddTg}>
                              <i className="fa-solid fa-plus" />
                            </button>
                          </div>
                          <p className="md-hint">Nhắn <b>/start</b> cho bot Telegram để nhận Chat ID</p>
                          {tgStatus ? <p className="md-hint">{tgStatus}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  </>

                <hr className="md-divider" />
                <div>
                  <button type="button" className="md-accordion-toggle" onClick={() => setAiOpen((v) => !v)}>
                    <div className="md-section-label" style={{ margin: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-gear" />
                        <span>Cấu hình AI</span>
                      </div>
                    </div>
                    <i className={`fa-solid fa-chevron-${aiOpen ? 'up' : 'down'} text-slate-400 text-sm`} />
                  </button>
                  {aiOpen ? (
                    <div className="md-settings-wrap" style={{ marginTop: 12 }}>
                      <SaleSetupPanel {...saleSetupProps} showStaffManager={false} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

          <main className="md-panel no-scrollbar">
            <div className="md-panel-inner">
                  {feedError && !errorDismissed ? (
                    <div className="md-error-banner">
                      <p>
                        <i className="fa-solid fa-circle-exclamation" />
                        {feedErrorTitle}. {feedError}
                      </p>
                      <button type="button" className="md-remove-btn" style={{ opacity: 1 }} onClick={() => setErrorDismissed(true)}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  ) : null}

                  <div className="md-toolbar-card md-toolbar-compact">
                    <div className="md-toolbar-row">
                      <select className="md-select md-select-sm" value={limit} onChange={(e) => setLimit(+e.target.value)}>
                        <option value={5}>5 bài</option>
                        <option value={10}>10 bài</option>
                        <option value={20}>20 bài</option>
                        <option value={50}>50 bài</option>
                      </select>
                      <button type="button" className="md-tool-btn md-tool-btn-sm" onClick={onLoadPosts}>
                        <i className={`fa-solid fa-rotate-right${loading ? ' fa-spin' : ''}`} />
                        Tải lại
                      </button>
                      <button type="button" className="md-tool-btn md-tool-btn-sm primary" onClick={onOpenPostModal}>
                        Đăng bài
                      </button>
                      <select className="md-select md-select-sm" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
                        <option value="">Tất cả</option>
                        {catOptions.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button type="button" className={`md-tool-btn md-tool-btn-sm pause${autoOn ? ' on' : ''}`} onClick={onToggleAuto}>
                        <i className={`fa-solid fa-${autoOn ? 'stop' : 'play'}`} />
                        {autoOn ? 'Dừng' : 'Tự động'}
                      </button>
                      <div className="md-interval md-interval-sm">
                        <input
                          type="number"
                          value={intervalMin}
                          min={1}
                          max={60}
                          disabled={autoOn}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) || 5;
                            setIntervalMin(v);
                            onSaveSettings(autoOn, v);
                          }}
                        />
                        <span>phút</span>
                      </div>
                      <button type="button" className="md-tool-btn md-tool-btn-sm" onClick={() => setCookieOpen((v) => !v)} title="Hướng dẫn cookie">
                        <i className="fa-solid fa-cookie" />
                      </button>
                      <div className="md-toolbar-meta">
                        <span>CMT: <b>{todayCommentCount === null ? '--' : todayCommentCount}</b></span>
                        {toolStatus ? <span className="md-toolbar-status">{toolStatus}</span> : null}
                      </div>
                    </div>
                  </div>

                  {cookieOpen || feedError ? (
                  <div className="md-cookie-card md-cookie-card-compact">
                      <button type="button" className="md-cookie-head" onClick={() => setCookieOpen((v) => !v)}>
                        <div className="md-cookie-icon">
                          <i className="fa-solid fa-cookie" />
                        </div>
                        <div>
                          <h3>{feedError ? 'Cookie Facebook cần cập nhật' : 'Hướng dẫn Cookie'}</h3>
                          <p>{feedError || 'Export cookie từ Chrome và dán vào mục Nhân sự.'}</p>
                        </div>
                        <span className="md-cookie-chevron">
                          <i className={`fa-solid fa-chevron-${cookieOpen ? 'up' : 'down'}`} />
                        </span>
                      </button>
                      {cookieOpen ? (
                        <div className="md-cookie-body">
                          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '0 0 12px' }}>
                            Mở Google Chrome và đăng nhập đúng tài khoản Facebook nhân sự. Truy cập Facebook,
                            xử lý xác minh danh tính hoặc CAPTCHA nếu có, rồi export cookie và dán vào mục Nhân sự.
                          </p>
                          {!cookieDetail ? (
                            <button type="button" className="md-cookie-detail-btn" onClick={() => setCookieDetail(true)}>
                              Xem chi tiết
                            </button>
                          ) : (
                            <CookieRefreshGuide />
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {postFetchReport.length ? (
                    <div className="md-fetch-report">
                      {postFetchReport.map((item, index) => (
                        <span
                          key={`feed-${item.group_id || index}`}
                          className={`md-fetch-pill ${item.ok ? 'ok' : 'fail'}`}
                        >
                          {item.ok ? '✓' : '!'} {item.target_type === 'page' ? 'Page' : 'Nhóm'}{' '}
                          {item.group_name || item.group_id}: {item.count || 0} bài
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="md-feed">
                    {loading && !allPostsCount ? (
                      <div className="md-empty-feed">
                        <div className="icon">⏳</div>
                        <h3>Đang tải bài viết...</h3>
                      </div>
                    ) : !filteredPosts.length ? (
                      <div className="md-empty-feed">
                        <div className="icon">{feedError ? '🍪' : keywords.length || catFilter ? '🔍' : '📭'}</div>
                        <h3>
                          {feedErrorKind === 'network' ? 'Lỗi mạng/DNS Facebook' : feedErrorKind === 'auth' ? 'Lỗi xác thực Facebook' : 'Không tải được bài'}
                        </h3>
                        {feedError ? <p>{feedError}</p> : null}
                      </div>
                    ) : (
                      filteredPosts.map((p) => (
                        <PostCard
                          key={p.id}
                          post={p}
                          groupNames={groupNames}
                          category={classifications[p.id]}
                          keywords={keywords}
                          pages={pages}
                          leads={leads[p.id]}
                          commentSummary={commentSummaries[p.id]}
                          onSummarizeComments={onSummarizeComments}
                          onExploreComments={onExploreComments}
                          onCommentSent={async (postId) => { await onCommentSent(postId); }}
                          onMarkProcessed={onMarkProcessed ? async (post) => { await onMarkProcessed(post); } : undefined}
                          onOpenLightbox={onOpenLightbox}
                        />
                      ))
                    )}
                  </div>
            </div>
          </main>

          <CommentTemplatesSidebar />
        </div>
      </div>
    </div>
  );
}
