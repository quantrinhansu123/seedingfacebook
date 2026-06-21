'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ManagedChannel, StaffAccount, StaffFacebookCookie, StaffManagedGroup } from '@/lib/types';
import { channelTypeBucket } from '@/lib/utils';

export type StaffPayload = {
  name: string;
  username: string;
  password: string;
  facebook_cookies: StaffFacebookCookie[];
  managed_groups: StaffManagedGroup[];
};

type ChannelKind = 'page' | 'group' | 'tiktok';

type Props = {
  staff: StaffAccount[];
  channels?: ManagedChannel[];
  currentStaff?: StaffAccount | null;
  canManage: boolean;
  status: string;
  title?: string;
  kicker?: string;
  onSave: (payload: StaffPayload, staffId?: string) => Promise<{ ok: boolean; error?: string }>;
  onDelete: (staffId: string, options?: { skipConfirm?: boolean }) => Promise<void>;
  onModalOpen?: () => void;
};

const EMPTY: StaffPayload = {
  name: '',
  username: '',
  password: '',
  facebook_cookies: [],
  managed_groups: [],
};

const CHANNEL_KIND_OPTIONS: { key: ChannelKind; label: string }[] = [
  { key: 'page', label: 'Page' },
  { key: 'group', label: 'Nhóm' },
  { key: 'tiktok', label: 'TikTok' },
];

function normalize(value?: string) {
  return (value || '').trim().toLowerCase();
}

function channelKind(item: ManagedChannel | StaffManagedGroup): ChannelKind | null {
  const platform = normalize(item.platform);
  const type = normalize(item.channel_type);
  if (platform === 'tiktok') return 'tiktok';
  if (platform === 'facebook' && ['page', 'fanpage', 'trang'].includes(type)) return 'page';
  if (platform === 'facebook' && ['nhóm', 'nhom', 'group'].includes(type)) return 'group';
  return null;
}

function kindLabel(kind: ChannelKind | null) {
  if (kind === 'page') return 'Page';
  if (kind === 'group') return 'Nhóm';
  if (kind === 'tiktok') return 'TikTok';
  return '';
}

function channelKey(item: ManagedChannel) {
  return item.id || `${item.platform || ''}:${item.target_id || ''}:${item.channel_name || ''}`;
}

function channelToManagedGroup(item: ManagedChannel): StaffManagedGroup {
  return {
    id: item.target_id || item.id || '',
    name: item.channel_name || item.target_id || '',
    platform: item.platform || '',
    channel_type: item.channel_type || '',
  };
}

function managedGroupKey(item: StaffManagedGroup) {
  const platform = (item.platform || '').trim().toLowerCase();
  const ctype = channelTypeBucket(item.channel_type);
  return `${platform}:${ctype}:${item.id || ''}:${item.name || ''}`;
}

function formatManagedGroupLabel(item: StaffManagedGroup) {
  const prefix = kindLabel(channelKind(item)) || item.channel_type || item.platform || '';
  const title = item.name || item.id || '';
  return prefix ? `${prefix}: ${title}` : title || '-';
}

function formatManagedGroups(groups?: StaffManagedGroup[]) {
  if (!groups?.length) return '-';
  const labels = groups.map((item) => formatManagedGroupLabel(item)).filter(Boolean).slice(0, 3);
  const extra = (groups.length || 0) - labels.length;
  return extra > 0 ? `${labels.join(' · ')} +${extra}` : labels.join(' · ');
}

function formatFacebookCookies(cookies?: StaffFacebookCookie[]) {
  if (!cookies?.length) return '-';
  const names = cookies
    .map((item) => item.facebook_name || item.label || item.facebook_user_id || '')
    .filter(Boolean);
  if (!names.length) return `${cookies.length} cookie`;
  if (names.length === 1) return names[0];
  const preview = names.slice(0, 2).join(' · ');
  const extra = names.length - 2;
  return extra > 0 ? `${preview} +${extra}` : preview;
}

function formatFacebookCookieTitle(cookies?: StaffFacebookCookie[]) {
  if (!cookies?.length) return '';
  return cookies
    .map((item) => {
      const title = item.facebook_name || item.label || 'Cookie';
      const id = item.facebook_user_id ? ` (${item.facebook_user_id})` : '';
      return `${title}${id}`;
    })
    .join('\n');
}

function newCookieRow(index: number): StaffFacebookCookie {
  return { id: `fb_${Date.now()}_${index}`, label: `Cookie ${index + 1}`, cookie: '' };
}

function formatDate(value?: string) {
  if (!value) return '-';
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '-';
  return time.toLocaleString('vi-VN');
}

function formatCookieColumnSummary(item: StaffAccount) {
  const cookies = item.facebook_cookies || [];
  if (cookies.length > 1) {
    const names = cookies
      .map((entry) => entry.facebook_name || entry.label || entry.facebook_user_id || '')
      .filter(Boolean);
    return names.length ? `${cookies.length} cookie · ${names.join(' · ')}` : `${cookies.length} cookie FB`;
  }
  if (cookies.length === 1) {
    return cookies[0].cookie_masked || item.cookie_masked || '1 cookie FB';
  }
  return item.cookie_masked || '-';
}

function isActiveStaffCookie(item: StaffAccount, entry: StaffFacebookCookie) {
  const activeId = item.active_cookie_id || '';
  if (activeId && entry.id) return entry.id === activeId;
  return false;
}

export function StaffCookiePanel({
  staff,
  channels = [],
  currentStaff,
  canManage,
  status,
  title = 'Nhân sự',
  kicker = 'Quản lý tài khoản',
  onSave,
  onDelete,
  onModalOpen,
}: Props) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState<StaffPayload>(EMPTY);
  const [pickKind, setPickKind] = useState<ChannelKind | ''>('');
  const [channelsMenuOpen, setChannelsMenuOpen] = useState(false);
  const channelsDropdownRef = useRef<HTMLDivElement | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [cookieBridgeStatus, setCookieBridgeStatus] = useState('');
  const [viewStaff, setViewStaff] = useState<StaffAccount | null>(null);
  const [cookieOnlyMode, setCookieOnlyMode] = useState(false);
  const [revealedFormCookieIds, setRevealedFormCookieIds] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data.source !== 'streal-tiktok-extension') return;
      if (data.type === 'STREAL_TIKTOK_BRIDGE_READY') {
        setBridgeReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        source: 'streal-web-page',
        type: 'STREAL_TIKTOK_BRIDGE_PING',
        requestId: `staff_cookie_ping_${Date.now()}`,
      },
      window.location.origin,
    );
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!channelsMenuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const node = channelsDropdownRef.current;
      if (node && !node.contains(event.target as Node)) {
        setChannelsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [channelsMenuOpen]);

  const channelOptions = useMemo(() => {
    if (!pickKind) return [] as ManagedChannel[];
    return channels.filter((item) => channelKind(item) === pickKind);
  }, [channels, pickKind]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((item) => {
      const managedText = (item.managed_groups || []).map((group) => formatManagedGroupLabel(group)).join(' ');
      const cookieText = (item.facebook_cookies || [])
        .map((cookie) => cookie.facebook_name || cookie.label || cookie.facebook_user_id || '')
        .join(' ');
      const haystack = [item.name, item.username, item.role, item.facebook_user_id, item.cookie_masked, cookieText, managedText]
        .join(' ')
        .toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (roleFilter && (item.role || 'staff') !== roleFilter) return false;
      return true;
    });
  }, [query, roleFilter, staff]);

  const [selectedStaffIds, setSelectedStaffIds] = useState<Record<string, boolean>>({});

  const selectableRows = useMemo(
    () => rows.filter((item) => canManage && item.id && item.id !== currentStaff?.id),
    [rows, canManage, currentStaff?.id],
  );

  const selectedIds = useMemo(
    () => selectableRows.map((item) => item.id!).filter((id) => selectedStaffIds[id]),
    [selectableRows, selectedStaffIds],
  );

  useEffect(() => {
    const valid = new Set(staff.map((item) => item.id).filter(Boolean));
    setSelectedStaffIds((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => valid.has(id)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [staff]);

  function toggleStaffSelection(staffId: string, checked: boolean) {
    setSelectedStaffIds((prev) => {
      const next = { ...prev };
      if (checked) next[staffId] = true;
      else delete next[staffId];
      return next;
    });
  }

  function toggleSelectAllStaff(checked: boolean) {
    setSelectedStaffIds((prev) => {
      const next = { ...prev };
      selectableRows.forEach((item) => {
        if (!item.id) return;
        if (checked) next[item.id] = true;
        else delete next[item.id];
      });
      return next;
    });
  }

  async function deleteSelectedStaff() {
    if (!selectedIds.length) return;
    if (!confirm(`Xoá ${selectedIds.length} nhân sự đã chọn?`)) return;
    for (const staffId of selectedIds) {
      await onDelete(staffId, { skipConfirm: true });
    }
    setSelectedStaffIds({});
  }

  function setField(key: 'name' | 'username' | 'password', value: string) {
    const next = key === 'username' ? value.trim().toLowerCase() : value;
    setForm((prev) => ({ ...prev, [key]: next }));
  }

  function resetPicker() {
    setPickKind('');
    setChannelsMenuOpen(false);
  }

  function resetModal() {
    setEditingId('');
    setForm(EMPTY);
    setCookieOnlyMode(false);
    resetPicker();
    setCookieBridgeStatus('');
    setRevealedFormCookieIds(new Set());
    setFormError('');
    setModalOpen(false);
  }

  function openAdd() {
    onModalOpen?.();
    setEditingId('');
    setForm({ ...EMPTY, facebook_cookies: [] });
    resetPicker();
    setCookieBridgeStatus('');
    setRevealedFormCookieIds(new Set());
    setFormError('');
    setModalOpen(true);
  }

  function openEdit(item: StaffAccount, cookieOnly = false) {
    onModalOpen?.();
    const cookies = (item.facebook_cookies || []).map((entry, index) => ({
      id: entry.id || `fb_${index}`,
      label: entry.label || `Cookie ${index + 1}`,
      cookie: entry.cookie || '',
      facebook_user_id: entry.facebook_user_id || '',
      facebook_name: entry.facebook_name || '',
    }));
    setEditingId(item.id || '');
    setCookieOnlyMode(cookieOnly);
    setForm({
      name: item.name || '',
      username: item.username || '',
      password: '',
      facebook_cookies: cookies.length ? cookies : [newCookieRow(0)],
      managed_groups: item.managed_groups || [],
    });
    resetPicker();
    setCookieBridgeStatus('');
    setRevealedFormCookieIds(new Set());
    setFormError('');
    setModalOpen(true);
  }

  function isChannelSelected(channel: ManagedChannel) {
    const entry = channelToManagedGroup(channel);
    const key = managedGroupKey(entry);
    return form.managed_groups.some((item) => managedGroupKey(item) === key);
  }

  const selectedInKindCount = useMemo(
    () => channelOptions.filter((item) => isChannelSelected(item)).length,
    [channelOptions, form.managed_groups],
  );

  function toggleChannel(channel: ManagedChannel, checked: boolean) {
    const entry = channelToManagedGroup(channel);
    const key = managedGroupKey(entry);
    setForm((prev) => {
      if (checked) {
        if (prev.managed_groups.some((item) => managedGroupKey(item) === key)) return prev;
        return { ...prev, managed_groups: [...prev.managed_groups, entry] };
      }
      return {
        ...prev,
        managed_groups: prev.managed_groups.filter((item) => managedGroupKey(item) !== key),
      };
    });
  }

  function selectAllForKind() {
    if (!channelOptions.length) return;
    setForm((prev) => {
      const existing = new Set(prev.managed_groups.map((item) => managedGroupKey(item)));
      const merged = [...prev.managed_groups];
      for (const channel of channelOptions) {
        const entry = channelToManagedGroup(channel);
        const key = managedGroupKey(entry);
        if (!existing.has(key)) {
          merged.push(entry);
          existing.add(key);
        }
      }
      return { ...prev, managed_groups: merged };
    });
  }

  function clearKindSelection() {
    if (!pickKind) return;
    const keys = new Set(channelOptions.map((channel) => managedGroupKey(channelToManagedGroup(channel))));
    setForm((prev) => ({
      ...prev,
      managed_groups: prev.managed_groups.filter((item) => !keys.has(managedGroupKey(item))),
    }));
  }

  function removeManagedChannel(target: StaffManagedGroup) {
    const key = managedGroupKey(target);
    setForm((prev) => ({
      ...prev,
      managed_groups: prev.managed_groups.filter((item) => managedGroupKey(item) !== key),
    }));
  }

  function addCookieRow() {
    setForm((prev) => ({
      ...prev,
      facebook_cookies: [...prev.facebook_cookies, newCookieRow(prev.facebook_cookies.length)],
    }));
  }

  function updateCookie(cookieId: string, patch: Partial<StaffFacebookCookie>) {
    setForm((prev) => ({
      ...prev,
      facebook_cookies: prev.facebook_cookies.map((item) => (item.id === cookieId ? { ...item, ...patch } : item)),
    }));
  }

  function removeCookie(cookieId: string) {
    setForm((prev) => ({
      ...prev,
      facebook_cookies: prev.facebook_cookies.filter((item) => item.id !== cookieId),
    }));
  }

  function toggleRevealFormCookie(cookieId?: string) {
    const key = cookieId || '';
    if (!key) return;
    setRevealedFormCookieIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    if (!cookieOnlyMode) {
      if (!form.name.trim() || !form.username.trim()) {
        setFormError('Nhập đủ tên và tài khoản đăng nhập');
        return;
      }
      if (!editingId && !form.password) {
        setFormError('Nhập mật khẩu khi thêm nhân sự (tối thiểu 6 ký tự)');
        return;
      }
      if (!editingId && form.password.length < 6) {
        setFormError('Mật khẩu tối thiểu 6 ký tự');
        return;
      }
    }
    const cookieRows = (editingId ? form.facebook_cookies : form.facebook_cookies.filter((item) => String(item.cookie || '').trim()))
      .map((item) => ({
        ...item,
        cookie: String(item.cookie || '').trim(),
        label: String(item.label || '').trim() || 'Cookie',
      }));
    const payload: StaffPayload = {
      name: form.name.trim(),
      username: form.username.trim().toLowerCase(),
      password: form.password,
      facebook_cookies: cookieRows,
      managed_groups: form.managed_groups,
    };
    setFormError('');
    setSaving(true);
    try {
      const result = await onSave(payload, editingId || undefined);
      if (result.ok) {
        if (!editingId) {
          setQuery('');
          setRoleFilter('');
        }
        resetModal();
        return;
      }
      setFormError(result.error || 'Không lưu được nhân sự');
    } finally {
      setSaving(false);
    }
  }

  function getFacebookCookieFromChrome(cookieId: string) {
    if (typeof window === 'undefined') return;
    setCookieBridgeStatus('Đang lấy cookie Facebook từ Chrome...');
    const requestId = `fb_cookie_${Date.now()}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      setCookieBridgeStatus('Không thấy extension phản hồi. Hãy cài/cập nhật Seeding Fsolution Bridge rồi thử lại.');
    }, 12000);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data.source !== 'streal-tiktok-extension' || data.type !== 'STREAL_FACEBOOK_COOKIE_RESPONSE' || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (data.ok && data.cookie) {
        updateCookie(cookieId, { cookie: data.cookie });
        setCookieBridgeStatus(`Đã lấy cookie Facebook từ Chrome${data.c_user ? ` · c_user=${data.c_user}` : ''}.`);
      } else {
        setCookieBridgeStatus(data.error || 'Không lấy được cookie Facebook từ Chrome.');
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage(
      {
        source: 'streal-web-page',
        type: 'STREAL_FACEBOOK_COOKIE_REQUEST',
        requestId,
      },
      window.location.origin,
    );
  }

  return (
    <section className="module-panel staff-manager-panel">
      <div className="module-head">
        <div>
          <div className="module-kicker">{kicker}</div>
          <h2>{title}</h2>
        </div>
        {canManage ? (
          <button type="button" className="btn-submit" onClick={openAdd}>
            + Thêm
          </button>
        ) : currentStaff ? (
          <button type="button" className="btn-submit" onClick={() => openEdit(currentStaff, true)}>
            Cập nhật cookie
          </button>
        ) : null}
      </div>

      <div className="table-toolbar">
        <div className="table-search">
          <span>⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm kiếm..." />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">Vai trò: tất cả</option>
          <option value="admin">Admin</option>
          <option value="staff">Nhân sự</option>
        </select>
        {(query.trim() || roleFilter) && staff.length ? (
          <span className="staff-filter-hint">
            Hiển thị {rows.length}/{staff.length}
            <button type="button" className="btn-cancel" onClick={() => { setQuery(''); setRoleFilter(''); }}>
              Bỏ lọc
            </button>
          </span>
        ) : null}
        {canManage && selectedIds.length ? (
          <button type="button" className="btn-cancel danger" onClick={() => void deleteSelectedStaff()}>
            Xoá đã chọn ({selectedIds.length})
          </button>
        ) : null}
      </div>

      <div className="data-table-wrap">
        <table className="data-table staff-data-table">
          <thead>
            <tr>
              <th className="select-col">
                {canManage && selectableRows.length ? (
                  <input
                    type="checkbox"
                    title="Chọn tất cả"
                    checked={
                      selectableRows.length > 0 &&
                      selectableRows.every((item) => item.id && selectedStaffIds[item.id])
                    }
                    onChange={(e) => toggleSelectAllStaff(e.target.checked)}
                  />
                ) : null}
              </th>
              <th>Họ tên</th>
              <th>Tài khoản</th>
              <th>Vai trò</th>
              <th>Facebook ID</th>
              <th>Trang quản lý</th>
              <th>Tài khoản FB</th>
              <th>Cookie</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item) => {
                const active = item.id && currentStaff?.id === item.id;
                return (
                  <tr key={item.id || item.username}>
                    <td className="select-col">
                      {canManage && item.id && item.id !== currentStaff?.id ? (
                        <input
                          type="checkbox"
                          checked={!!selectedStaffIds[item.id]}
                          onChange={(e) => toggleStaffSelection(item.id!, e.target.checked)}
                        />
                      ) : null}
                    </td>
                    <td>
                      <b>{item.name || 'Chưa đặt tên'}</b>
                      {active ? <small>Đang đăng nhập</small> : null}
                    </td>
                    <td className="mono-cell">{item.username || '-'}</td>
                    <td>
                      <span className={item.role === 'admin' ? 'status-pill admin' : 'status-pill staff'}>
                        {item.role === 'admin' ? 'Admin' : 'Nhân sự'}
                      </span>
                    </td>
                    <td className="mono-cell">{item.facebook_user_id || '-'}</td>
                    <td title={(item.managed_groups || []).map((group) => formatManagedGroupLabel(group)).join('\n')}>
                      {formatManagedGroups(item.managed_groups)}
                    </td>
                    <td title={formatFacebookCookieTitle(item.facebook_cookies)}>
                      {formatFacebookCookies(item.facebook_cookies)}
                    </td>
                    <td className="staff-cookie-cell">
                      <span className="staff-cookie-masked">{formatCookieColumnSummary(item)}</span>
                    </td>
                    <td>
                      <span className={item.enabled === false ? 'status-pill fail' : 'status-pill ok'}>
                        {item.enabled === false ? 'Tắt' : 'Đang dùng'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button type="button" title="Xem chi tiết" onClick={() => setViewStaff(item)}>
                          <i className="fa-solid fa-eye" />
                        </button>
                        {canManage ? (
                          <button type="button" title="Sửa" onClick={() => openEdit(item)}>
                            ✎
                          </button>
                        ) : active ? (
                          <button type="button" title="Sửa cookie" onClick={() => openEdit(item, true)}>
                            ✎
                          </button>
                        ) : null}
                        {canManage && !active && item.id ? (
                          <button type="button" title="Xoá" className="danger" onClick={() => void onDelete(item.id!)}>
                            🗑
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={10} className="table-empty">
                  Chưa có nhân sự.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {status ? <div className="module-status">{status}</div> : null}
      {!canManage ? (
        <div className="module-status">
          Bạn có thể tự cập nhật cookie Facebook của mình. Thêm/sửa/xoá nhân sự khác chỉ dành cho admin.
        </div>
      ) : null}

      <div className={`modal-overlay${viewStaff ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setViewStaff(null)} role="presentation">
        {viewStaff ? (
          <div className="modal staff-view-modal">
            <div className="modal-hd">
              Chi tiết nhân sự
              <span className="modal-close" onClick={() => setViewStaff(null)} role="presentation">
                ✕
              </span>
            </div>
            <div className="staff-view-body">
              <section className="staff-view-section">
                <h3>Thông tin chung</h3>
                <dl className="staff-view-grid">
                  <div><dt>Họ tên</dt><dd>{viewStaff.name || '-'}</dd></div>
                  <div><dt>Tài khoản</dt><dd className="mono-cell">{viewStaff.username || '-'}</dd></div>
                  <div><dt>Vai trò</dt><dd>{viewStaff.role === 'admin' ? 'Admin' : 'Nhân sự'}</dd></div>
                  <div><dt>Facebook ID chính</dt><dd className="mono-cell">{viewStaff.facebook_user_id || '-'}</dd></div>
                  <div><dt>FB đang dùng</dt><dd>{viewStaff.active_facebook_name || '-'}</dd></div>
                  <div><dt>Trạng thái</dt><dd>{viewStaff.enabled === false ? 'Tắt' : 'Đang dùng'}</dd></div>
                  <div><dt>Tạo lúc</dt><dd>{formatDate(viewStaff.created_at)}</dd></div>
                  <div><dt>Cập nhật</dt><dd>{formatDate(viewStaff.updated_at)}</dd></div>
                </dl>
              </section>

              <section className="staff-view-section">
                <h3>Trang / nhóm quản lý ({(viewStaff.managed_groups || []).length})</h3>
                {(viewStaff.managed_groups || []).length ? (
                  <ul className="staff-view-list">
                    {(viewStaff.managed_groups || []).map((group) => (
                      <li key={managedGroupKey(group)}>{formatManagedGroupLabel(group)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="staff-view-empty">Chưa gán trang/nhóm nào.</p>
                )}
              </section>

              <section className="staff-view-section">
                <h3>Cookie Facebook ({(viewStaff.facebook_cookies || []).length || (viewStaff.cookie_masked ? 1 : 0)})</h3>
                {(viewStaff.facebook_cookies || []).length ? (
                  <div className="staff-view-cookie-list">
                    {(viewStaff.facebook_cookies || []).map((entry, index) => (
                      <article key={entry.id || `cookie-${index}`} className="staff-view-cookie-card">
                        <div className="staff-view-cookie-head">
                          <b>Cookie {index + 1}: {entry.label || entry.facebook_name || `Cookie ${index + 1}`}</b>
                          {isActiveStaffCookie(viewStaff, entry) ? <span className="status-pill ok">Đang dùng</span> : null}
                        </div>
                        <dl className="staff-view-grid staff-view-grid--compact">
                          <div><dt>Tên FB</dt><dd>{entry.facebook_name || '-'}</dd></div>
                          <div><dt>Facebook ID</dt><dd className="mono-cell">{entry.facebook_user_id || '-'}</dd></div>
                        </dl>
                        <label className="staff-view-cookie-label">Nội dung cookie</label>
                        <textarea className="staff-view-cookie-text" readOnly value={entry.cookie || entry.cookie_masked || ''} />
                      </article>
                    ))}
                  </div>
                ) : viewStaff.cookie_masked ? (
                  <article className="staff-view-cookie-card">
                    <div className="staff-view-cookie-head"><b>Cookie chính</b></div>
                    <textarea className="staff-view-cookie-text" readOnly value={viewStaff.cookie_masked} />
                  </article>
                ) : (
                  <p className="staff-view-empty">Chưa có cookie.</p>
                )}
              </section>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={() => setViewStaff(null)}>
                Đóng
              </button>
              {canManage ? (
                <button
                  type="button"
                  className="btn-submit"
                  onClick={() => {
                    const target = viewStaff;
                    setViewStaff(null);
                    openEdit(target);
                  }}
                >
                  Sửa nhân sự
                </button>
              ) : viewStaff.id && viewStaff.id === currentStaff?.id ? (
                <button
                  type="button"
                  className="btn-submit"
                  onClick={() => {
                    const target = viewStaff;
                    setViewStaff(null);
                    openEdit(target, true);
                  }}
                >
                  Sửa cookie
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className={`modal-overlay${modalOpen ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && resetModal()} role="presentation">
        <form className="modal staff-modal" onSubmit={submit}>
          <div className="modal-hd">
            {cookieOnlyMode ? 'Cập nhật cookie Facebook' : editingId ? 'Sửa nhân sự' : 'Thêm nhân sự'}
            <span className="modal-close" onClick={resetModal} role="presentation">
              ✕
            </span>
          </div>
          <div className="staff-modal-grid">
            {cookieOnlyMode ? (
              <div className="field">
                <label>Tài khoản</label>
                <input className="modal-input" value={form.username} readOnly />
              </div>
            ) : (
              <>
            <div className="field">
              <label>Tên nhân sự</label>
              <input className="modal-input" value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Nguyễn Văn A" />
            </div>
            <div className="field">
              <label>Tài khoản đăng nhập</label>
              <input className="modal-input" value={form.username} onChange={(e) => setField('username', e.target.value)} placeholder="sale01" />
            </div>
            <div className="field">
              <label>Mật khẩu</label>
              <input
                className="modal-input"
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder={editingId ? 'Để trống nếu không đổi' : 'Tối thiểu 6 ký tự'}
              />
            </div>
            <div className="field staff-cookie-field">
              <label>Trang / nhóm quản lý (chọn nhiều)</label>
              <div className="staff-managed-picker">
                <div className="field" style={{ margin: 0 }}>
                  <label>Loại trang</label>
                  <select
                    value={pickKind}
                    onChange={(e) => {
                      setPickKind(e.target.value as ChannelKind | '');
                      setChannelsMenuOpen(false);
                    }}
                  >
                    <option value="">-- Chọn loại --</option>
                    {CHANNEL_KIND_OPTIONS.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tên trang / nhóm</label>
                  <div className="staff-managed-dropdown" ref={channelsDropdownRef}>
                    <button
                      type="button"
                      className={`staff-managed-dropdown-trigger${channelsMenuOpen ? ' open' : ''}`}
                      disabled={!pickKind || !channelOptions.length}
                      onClick={() => setChannelsMenuOpen((open) => !open)}
                    >
                      <span>
                        {!pickKind
                          ? 'Chọn loại trang trước'
                          : !channelOptions.length
                            ? `Chưa có ${kindLabel(pickKind)} trong /kenh`
                            : selectedInKindCount
                              ? `Đã chọn ${selectedInKindCount} ${kindLabel(pickKind)}`
                              : `Chọn ${kindLabel(pickKind)}...`}
                      </span>
                      <span className="staff-managed-dropdown-caret">▾</span>
                    </button>
                    {channelsMenuOpen && pickKind && channelOptions.length ? (
                      <div className="staff-managed-dropdown-menu">
                        <div className="staff-managed-toolbar">
                          <span>{selectedInKindCount}/{channelOptions.length} đã chọn</span>
                          <button type="button" className="btn-cancel" onClick={selectAllForKind}>
                            Chọn tất cả
                          </button>
                          <button type="button" className="btn-cancel" onClick={clearKindSelection}>
                            Bỏ chọn
                          </button>
                        </div>
                        <div className="staff-managed-checklist">
                          {channelOptions.map((item) => {
                            const checked = isChannelSelected(item);
                            return (
                              <label key={channelKey(item)} className={`staff-managed-check${checked ? ' checked' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleChannel(item, e.target.checked)}
                                />
                                <span>{item.channel_name || item.target_id || 'Không tên'}</span>
                                {item.target_id ? <small>{item.target_id}</small> : null}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="staff-managed-list">
                {form.managed_groups.length ? (
                  <>
                    <div className="staff-managed-summary">Đã gán {form.managed_groups.length} trang/nhóm:</div>
                    {form.managed_groups.map((item) => (
                      <span key={managedGroupKey(item)} className="staff-managed-chip">
                        <small>{kindLabel(channelKind(item)) || item.channel_type || 'Kênh'}</small>
                        <span>{item.name || item.id}</span>
                        <button type="button" title="Xoá" onClick={() => removeManagedChannel(item)}>×</button>
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="staff-managed-empty">Chưa gán trang/nhóm nào.</span>
                )}
              </div>
            </div>
              </>
            )}
            <div className="field staff-cookie-field">
              <label>Cookie Facebook (tùy chọn — thêm sau cũng được)</label>
              <div className="staff-cookie-tools">
                <span>Thêm mới có thể bỏ trống. Tên FB (nếu có cookie) được lấy nền sau khi lưu.</span>
                <span>{bridgeReady ? 'Extension đã kết nối' : 'Có thể dán thủ công nếu chưa cài extension'}</span>
              </div>
              <div className="staff-fb-cookie-list">
                {form.facebook_cookies.length ? (
                  form.facebook_cookies.map((entry, index) => {
                    const cookieId = entry.id || `fb-${index}`;
                    const formCookieRevealed = revealedFormCookieIds.has(cookieId);
                    return (
                    <div key={cookieId} className="staff-fb-cookie-row">
                      <div className="staff-fb-cookie-row-head">
                        <input
                          className="modal-input"
                          value={entry.label || ''}
                          onChange={(e) => updateCookie(entry.id || '', { label: e.target.value })}
                          placeholder={`Tên cookie ${index + 1}`}
                        />
                        {entry.facebook_name || entry.facebook_user_id ? (
                          <span className="staff-fb-cookie-account">
                            {entry.facebook_name || 'Chưa đọc tên'}
                            {entry.facebook_user_id ? ` · ${entry.facebook_user_id}` : ''}
                          </span>
                        ) : null}
                        <button type="button" className="btn-cancel" onClick={() => getFacebookCookieFromChrome(entry.id || '')}>
                          Lấy từ Chrome
                        </button>
                        <button type="button" className="btn-cancel" onClick={() => removeCookie(entry.id || '')} title="Xoá cookie">
                          Xoá
                        </button>
                      </div>
                      <div className="staff-fb-cookie-input-wrap">
                        <textarea
                          className={formCookieRevealed ? '' : 'staff-cookie-hidden'}
                          value={entry.cookie || ''}
                          onChange={(e) => updateCookie(entry.id || '', { cookie: e.target.value })}
                          placeholder={editingId && !entry.cookie ? 'Để trống nếu giữ cookie cũ' : 'Dán cookie Facebook có c_user=...'}
                        />
                        <button
                          type="button"
                          className="table-icon-button staff-cookie-eye"
                          title={formCookieRevealed ? 'Ẩn cookie' : 'Xem cookie'}
                          onClick={() => toggleRevealFormCookie(cookieId)}
                        >
                          <i className={formCookieRevealed ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} />
                        </button>
                      </div>
                    </div>
                  );
                  })
                ) : (
                  <div className="staff-managed-empty">Chưa có cookie — bấm Thêm cookie bên dưới.</div>
                )}
              </div>
              <button type="button" className="btn-cancel staff-fb-cookie-add" onClick={addCookieRow}>
                + Thêm cookie
              </button>
              {cookieBridgeStatus ? <div className="modal-result">{cookieBridgeStatus}</div> : null}
            </div>
          </div>
          <div className="modal-actions modal-actions-between">
            <div className="modal-result">
              {formError ? (
                <span className="staff-modal-error">{formError}</span>
              ) : modalOpen && status && !status.startsWith('✅') ? (
                status
              ) : cookieOnlyMode ? (
                'Dán cookie mới hoặc bấm Lấy từ Chrome. Để trống ô cookie nếu giữ cookie cũ.'
              ) : editingId ? (
                'Mật khẩu và cookie có thể để trống nếu không đổi.'
              ) : (
                'Cookie có thể thêm sau khi tạo tài khoản.'
              )}
            </div>
            <div className="staff-modal-actions">
              <button type="button" className="btn-cancel" onClick={resetModal}>
                Huỷ
              </button>
              <button type="submit" className="btn-submit" disabled={saving}>
                {saving ? 'Đang lưu...' : cookieOnlyMode ? 'Lưu cookie' : editingId ? 'Cập nhật' : 'Thêm'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
