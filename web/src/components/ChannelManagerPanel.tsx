'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { ManagedChannel, StaffAccount } from '@/lib/types';
import { extractSlug, staffAssignedToChannel, staffIdsForChannel } from '@/lib/utils';

type Payload = {
  platform: string;
  channel_name: string;
  channel_type: string;
  link: string;
  target_id: string;
  note: string;
  assigned_staff_ids: string[];
};

type Props = {
  channels: ManagedChannel[];
  staff?: StaffAccount[];
  viewAll?: boolean;
  canAssignStaff?: boolean;
  status: string;
  busy: boolean;
  onSave: (payload: Omit<Payload, 'assigned_staff_ids'> & { assigned_staff_ids?: string[] }, id?: string) => Promise<boolean | string>;
  onDelete: (id: string) => Promise<void>;
  onReload: () => Promise<unknown>;
  onSyncFacebookPages?: () => Promise<unknown>;
  onBulkAssignStaff?: (channelIds: string[], staffIds: string[]) => Promise<boolean | string>;
};

type ChannelTabKey = 'all' | 'groups' | 'pages' | 'tiktok';

const EMPTY: Payload = {
  platform: '',
  channel_name: '',
  channel_type: 'Nhóm',
  link: '',
  target_id: '',
  note: '',
  assigned_staff_ids: [],
};

const PLATFORM_OPTIONS = ['Facebook', 'TikTok', 'YouTube', 'Instagram', 'Zalo'];
const TYPE_OPTIONS = ['Page', 'Video', 'Nhóm'];
const CHANNEL_TABS: { key: ChannelTabKey; label: string; hint: string }[] = [
  { key: 'all', label: 'Tất cả', hint: 'Toàn bộ kênh' },
  { key: 'groups', label: 'Quản lý nhóm', hint: 'Facebook Group' },
  { key: 'pages', label: 'Quản lý page', hint: 'Facebook Page' },
  { key: 'tiktok', label: 'Quản lý TikTok', hint: 'Kênh/video TikTok' },
];

function normalize(value?: string) {
  return (value || '').trim().toLowerCase();
}

function isFacebookGroup(item: ManagedChannel) {
  const platform = normalize(item.platform);
  const type = normalize(item.channel_type);
  return platform === 'facebook' && ['nhóm', 'nhom', 'group'].includes(type);
}

function isFacebookPage(item: ManagedChannel) {
  const platform = normalize(item.platform);
  const type = normalize(item.channel_type);
  return platform === 'facebook' && ['page', 'fanpage', 'trang'].includes(type);
}

function isTiktokChannel(item: ManagedChannel) {
  return normalize(item.platform) === 'tiktok';
}

function matchesTab(item: ManagedChannel, tab: ChannelTabKey) {
  if (tab === 'groups') return isFacebookGroup(item);
  if (tab === 'pages') return isFacebookPage(item);
  if (tab === 'tiktok') return isTiktokChannel(item);
  return true;
}

function defaultPayloadForTab(tab: ChannelTabKey): Payload {
  if (tab === 'pages') return { ...EMPTY, platform: 'Facebook', channel_type: 'Page' };
  if (tab === 'tiktok') return { ...EMPTY, platform: 'TikTok', channel_type: 'Video' };
  if (tab === 'groups') return { ...EMPTY, platform: 'Facebook', channel_type: 'Nhóm' };
  return EMPTY;
}

function groupIdFromChannel(item: ManagedChannel): string {
  const id = String(item.target_id || '').trim();
  if (id) return id;
  const link = String(item.link || '').trim();
  if (!link) return '';
  const match = link.match(/facebook\.com\/groups\/([^/?#]+)/i);
  if (match?.[1]) return match[1];
  return extractSlug(link);
}

export function ChannelManagerPanel({
  channels,
  staff = [],
  viewAll = false,
  canAssignStaff = false,
  status,
  busy,
  onSave,
  onDelete,
  onReload,
  onSyncFacebookPages,
  onBulkAssignStaff,
}: Props) {
  const [staffMenuOpen, setStaffMenuOpen] = useState(false);
  const [bulkStaffMenuOpen, setBulkStaffMenuOpen] = useState(false);
  const [bulkStaffIds, setBulkStaffIds] = useState<string[]>([]);
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffModalChannel, setStaffModalChannel] = useState<ManagedChannel | null>(null);
  const [staffModalIds, setStaffModalIds] = useState<string[]>([]);
  const [staffModalError, setStaffModalError] = useState('');
  const [form, setForm] = useState<Payload>(EMPTY);
  const [editingId, setEditingId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [activeTab, setActiveTab] = useState<ChannelTabKey>('all');
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<Record<string, boolean>>({});

  const assignableStaff = useMemo(
    () => staff.filter((item) => item.enabled !== false && item.id),
    [staff],
  );

  function formatAssignedStaff(channel: ManagedChannel) {
    const fromApi = (channel.assigned_staff || [])
      .map((item) => item.name || item.username || item.id)
      .filter(Boolean);
    const labels = (fromApi.length
      ? fromApi
      : staffAssignedToChannel(channel, staff).map((item) => item.name || item.username || item.id).filter(Boolean)
    ).slice(0, 2);
    if (!labels.length) return '-';
    const total = fromApi.length || staffAssignedToChannel(channel, staff).length;
    const extra = total - labels.length;
    return extra > 0 ? `${labels.join(', ')} +${extra}` : labels.join(', ');
  }

  function toggleAssignedStaff(staffId: string, checked: boolean) {
    setForm((prev) => {
      const current = new Set(prev.assigned_staff_ids);
      if (checked) current.add(staffId);
      else current.delete(staffId);
      return { ...prev, assigned_staff_ids: [...current] };
    });
  }

  function toggleStaffModalId(staffId: string, checked: boolean) {
    setStaffModalIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(staffId);
      else next.delete(staffId);
      return [...next];
    });
  }

  function openStaffModal(item: ManagedChannel) {
    setStaffModalChannel(item);
    setStaffModalIds(
      item.assigned_staff_ids?.length
        ? [...item.assigned_staff_ids]
        : staffIdsForChannel(item, staff),
    );
    setStaffModalError('');
    setStaffModalOpen(true);
  }

  function closeStaffModal() {
    setStaffModalOpen(false);
    setStaffModalChannel(null);
    setStaffModalIds([]);
    setStaffModalError('');
  }

  async function saveStaffModal() {
    if (!staffModalChannel?.id) return;
    const item = staffModalChannel;
    const result = await onSave(
      {
        platform: item.platform || '',
        channel_name: item.channel_name || '',
        channel_type: item.channel_type || '',
        link: item.link || '',
        target_id: item.target_id || '',
        note: item.note || '',
        assigned_staff_ids: staffModalIds,
      },
      item.id,
    );
    if (result === true) {
      closeStaffModal();
      return;
    }
    if (typeof result === 'string') {
      setStaffModalError(result.startsWith('❌') ? result.slice(2).trim() : result);
    }
  }

  function staffPickerLabel() {
    const count = form.assigned_staff_ids.length;
    if (!count) return 'Chọn nhân sự phụ trách...';
    const names = form.assigned_staff_ids
      .map((id) => assignableStaff.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => item!.name || item!.username || item!.id)
      .slice(0, 2);
    const extra = count - names.length;
    return extra > 0 ? `${names.join(', ')} +${extra}` : names.join(', ');
  }

  const channelOptions = useMemo(() => {
    const names = channels.map((item) => item.channel_name || '').filter(Boolean);
    return Array.from(new Set(names)).slice(0, 30);
  }, [channels]);

  const tabCounts = useMemo(
    () => ({
      all: channels.length,
      groups: channels.filter((item) => matchesTab(item, 'groups')).length,
      pages: channels.filter((item) => matchesTab(item, 'pages')).length,
      tiktok: channels.filter((item) => matchesTab(item, 'tiktok')).length,
    }),
    [channels],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((item) => {
      if (!matchesTab(item, activeTab)) return false;
      const haystack = [
        item.platform,
        item.channel_name,
        item.channel_type,
        item.link,
        item.target_id,
        item.note,
      ]
        .join(' ')
        .toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (platformFilter && (item.platform || '').toLowerCase() !== platformFilter.toLowerCase()) return false;
      if (typeFilter && (item.channel_type || '') !== typeFilter) return false;
      return true;
    });
  }, [activeTab, channels, platformFilter, query, typeFilter]);

  const selectableChannelIds = useMemo(
    () => filtered.map((item) => item.id || '').filter(Boolean),
    [filtered],
  );
  const selectedChannelIdList = useMemo(
    () => selectableChannelIds.filter((id) => selectedChannelIds[id]),
    [selectableChannelIds, selectedChannelIds],
  );

  function toggleBulkStaff(staffId: string, checked: boolean) {
    setBulkStaffIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(staffId);
      else next.delete(staffId);
      return [...next];
    });
  }

  function bulkStaffPickerLabel() {
    if (!bulkStaffIds.length) return 'Chọn nhân sự...';
    const names = bulkStaffIds
      .map((id) => assignableStaff.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => item!.name || item!.username || item!.id)
      .slice(0, 2);
    const extra = bulkStaffIds.length - names.length;
    return extra > 0 ? `${names.join(', ')} +${extra}` : names.join(', ');
  }

  async function applyBulkStaffAssign() {
    if (!onBulkAssignStaff || !selectedChannelIdList.length || !bulkStaffIds.length) return;
    const result = await onBulkAssignStaff(selectedChannelIdList, bulkStaffIds);
    if (result === true) {
      setSelectedChannelIds({});
      setBulkStaffIds([]);
      setBulkStaffMenuOpen(false);
    }
  }

  function setField(key: keyof Payload, value: string) {
    setFormError('');
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditingId('');
    setForm(defaultPayloadForTab(activeTab));
    setFormError('');
    setModalOpen(true);
  }

  function edit(item: ManagedChannel) {
    setEditingId(item.id || '');
    setForm({
      platform: item.platform || '',
      channel_name: item.channel_name || '',
      channel_type: item.channel_type || 'Nhóm',
      link: item.link || '',
      target_id: item.target_id || '',
      note: item.note || '',
      assigned_staff_ids: item.assigned_staff_ids?.length
        ? [...item.assigned_staff_ids]
        : staffIdsForChannel(item, staff),
    });
    setStaffMenuOpen(false);
    setFormError('');
    setModalOpen(true);
  }

  function reset() {
    setEditingId('');
    setForm(EMPTY);
    setStaffMenuOpen(false);
    setFormError('');
    setModalOpen(false);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.platform.trim()) {
      setFormError('Nhập nền tảng trước khi lưu.');
      return;
    }
    if (!form.channel_name.trim()) {
      setFormError('Nhập tên kênh / nhóm trước khi lưu.');
      return;
    }
    if (!form.link.trim() && !form.target_id.trim()) {
      setFormError('Nhập link hoặc ID để tránh lưu trùng kênh.');
      return;
    }
    const normalizedName = form.channel_name.trim().toLowerCase();
    const normalizedPlatform = form.platform.trim().toLowerCase();
    const normalizedType = form.channel_type.trim().toLowerCase();
    const normalizedId = form.target_id.trim();
    const normalizedLink = form.link.trim().replace(/\/+$/, '').toLowerCase();
    if (
      normalizedPlatform === 'facebook' &&
      ['page', 'fanpage', 'trang'].includes(normalizedType) &&
      /facebook\.com\/(?:groups|group)\//.test(normalizedLink)
    ) {
      setFormError('Link này là link Nhóm Facebook. Hãy đổi Loại thành "Nhóm", hoặc dán đúng link Page.');
      return;
    }
    const duplicated = channels.find((item) => {
      if ((item.id || '') === editingId) return false;
      const sameIdentity =
        (normalizedId && normalizedId === (item.target_id || '').trim()) ||
        (normalizedLink && normalizedLink === (item.link || '').trim().replace(/\/+$/, '').toLowerCase());
      const sameName =
        normalizedName === (item.channel_name || '').trim().toLowerCase() &&
        normalizedPlatform === (item.platform || '').trim().toLowerCase() &&
        normalizedType === (item.channel_type || '').trim().toLowerCase();
      return sameIdentity || sameName;
    });
    if (duplicated) {
      setFormError(`Kênh này đã có trong danh sách: ${duplicated.channel_name || duplicated.target_id || duplicated.id}`);
      return;
    }
    const payload: Omit<Payload, 'assigned_staff_ids'> & { assigned_staff_ids?: string[] } = { ...form };
    if (!canAssignStaff) delete payload.assigned_staff_ids;
    const result = await onSave(payload, editingId || undefined);
    if (result === true) {
      reset();
      return;
    }
    if (typeof result === 'string') {
      setFormError(result.startsWith('❌') ? result.slice(2).trim() : result);
    }
  }

  return (
    <section className="module-panel">
      <div className="module-head">
        <div>
          <div className="module-kicker">Quản lý nhóm / kênh</div>
          <h2>Kênh theo dõi</h2>
          <p className="module-scope-hint">
            {viewAll
              ? `Admin — hiển thị toàn bộ ${channels.length} kênh`
              : `Chỉ hiển thị ${channels.length} kênh được phân công cho bạn`}
          </p>
        </div>
        <div className="module-actions">
          {canAssignStaff && selectedChannelIdList.length ? (
            <div className="staff-managed-dropdown channel-bulk-staff-picker">
              <button
                type="button"
                className={`staff-managed-dropdown-trigger${bulkStaffMenuOpen ? ' open' : ''}`}
                disabled={!assignableStaff.length || busy}
                onClick={() => setBulkStaffMenuOpen((open) => !open)}
              >
                <span>{assignableStaff.length ? bulkStaffPickerLabel() : 'Chưa có nhân sự'}</span>
                <span className="staff-managed-dropdown-caret">▾</span>
              </button>
              {bulkStaffMenuOpen && assignableStaff.length ? (
                <div className="staff-managed-dropdown-menu">
                  <div className="staff-managed-checklist">
                    {assignableStaff.map((person) => (
                      <label
                        key={person.id}
                        className={`staff-managed-check${bulkStaffIds.includes(person.id!) ? ' checked' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={bulkStaffIds.includes(person.id!)}
                          onChange={(e) => toggleBulkStaff(person.id!, e.target.checked)}
                        />
                        <span>{person.name || person.username || person.id}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="btn-submit"
                disabled={busy || !bulkStaffIds.length}
                onClick={() => void applyBulkStaffAssign()}
              >
                Gán {bulkStaffIds.length ? bulkStaffIds.length : ''} NS → {selectedChannelIdList.length} kênh
              </button>
            </div>
          ) : null}
          <button type="button" className="table-icon-button" title="Tải lại" onClick={() => void onReload()}>
            ↻
          </button>
          {onSyncFacebookPages ? (
            <button type="button" className="btn-cancel" disabled={busy} onClick={() => void onSyncFacebookPages()}>
              Đồng bộ Page FB
            </button>
          ) : null}
          <button type="button" className="btn-submit channel-add-button" onClick={openCreate}>
            + Thêm
          </button>
        </div>
      </div>

      <div className="channel-filter-bar">
      <div className="channel-tabs" role="tablist" aria-label="Phân loại kênh theo dõi">
        {CHANNEL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`channel-tab${activeTab === tab.key ? ' active' : ''}`}
            title={tab.hint}
            onClick={() => {
              setActiveTab(tab.key);
              setPlatformFilter('');
              setTypeFilter('');
            }}
          >
            <span>{tab.label}</span>
            <b>{tabCounts[tab.key]}</b>
          </button>
        ))}
      </div>

      <div className="table-toolbar channel-table-toolbar">
        <div className="table-search">
          <span>⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm kiếm..." />
        </div>
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} aria-label="Nền tảng">
          <option value="">Nền tảng</option>
          {PLATFORM_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Loại">
          <option value="">Loại</option>
          {TYPE_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      </div>

      <div className="data-table-wrap">
        <table className="data-table channel-data-table">
          <thead>
            <tr>
              <th className="select-col">
                {canAssignStaff && selectableChannelIds.length ? (
                  <input
                    type="checkbox"
                    title="Chọn kênh để gán nhân sự"
                    checked={
                      selectableChannelIds.length > 0 &&
                      selectableChannelIds.every((id) => selectedChannelIds[id])
                    }
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedChannelIds((prev) => {
                        const next = { ...prev };
                        selectableChannelIds.forEach((id) => {
                          if (checked) next[id] = true;
                          else delete next[id];
                        });
                        return next;
                      });
                    }}
                  />
                ) : null}
              </th>
              <th>Nền tảng</th>
              <th>Kênh</th>
              <th>Loại</th>
              <th>Nhân sự</th>
              <th>Link</th>
              <th className="channel-id-col">ID</th>
              <th className="channel-actions-col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((item) => {
                const gid = groupIdFromChannel(item);
                return (
                  <tr key={item.id}>
                    <td className="select-col">
                      {canAssignStaff && item.id ? (
                        <input
                          type="checkbox"
                          checked={!!selectedChannelIds[item.id]}
                          onChange={(e) =>
                            setSelectedChannelIds((prev) => ({
                              ...prev,
                              [item.id!]: e.target.checked,
                            }))
                          }
                        />
                      ) : null}
                    </td>
                    <td>
                      <span className="platform-pill">{item.platform || '-'}</span>
                    </td>
                    <td className="channel-name-cell">
                      <b title={item.channel_name || '-'}>{item.channel_name || '-'}</b>
                      {item.note ? <small>{item.note}</small> : null}
                    </td>
                    <td className="channel-type-col">{item.channel_type || '-'}</td>
                    <td className="channel-staff-col" title={formatAssignedStaff(item)}>
                      {formatAssignedStaff(item)}
                    </td>
                    <td className="link-cell">
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noreferrer">
                          Mở link
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="mono-cell channel-id-col" title={item.target_id || ''}>{item.target_id || '-'}</td>
                    <td className="channel-actions-col">
                      <div className="channel-row-actions">
                        <div className="channel-group-actions">
                          {isFacebookGroup(item) && gid ? (
                            canAssignStaff ? (
                              <button
                                type="button"
                                className="btn-join-now ghost"
                                title="Gán nhân sự phụ trách"
                                onClick={() => openStaffModal(item)}
                              >
                                Thêm nhân sự
                              </button>
                            ) : (
                              <a
                                className="btn-join-now ghost"
                                href={`https://www.facebook.com/groups/${gid}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                FB
                              </a>
                            )
                          ) : null}
                        </div>
                        <div className="channel-core-actions">
                          {canAssignStaff && !(isFacebookGroup(item) && groupIdFromChannel(item)) ? (
                            <button
                              type="button"
                              className="btn-join-now ghost"
                              title="Gán nhân sự phụ trách"
                              onClick={() => openStaffModal(item)}
                            >
                              Thêm nhân sự
                            </button>
                          ) : null}
                          <button type="button" title="Sửa" onClick={() => edit(item)}>
                            ✎
                          </button>
                          <button type="button" title="Xoá" className="danger" onClick={() => item.id && void onDelete(item.id)}>
                            🗑
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="table-empty">
                  Chưa có kênh nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {status ? <div className="module-status">{status}</div> : null}

      <div className={`modal-overlay${modalOpen ? ' open' : ''}`} onClick={reset}>
        <form className="modal channel-modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
          <div className="modal-hd">
            <span>{editingId ? 'Sửa kênh theo dõi' : 'Thêm kênh theo dõi'}</span>
            <button type="button" className="modal-close-button" aria-label="Đóng" onClick={reset}>
              ×
            </button>
          </div>
          <p className="channel-modal-note">
            Mỗi kênh/nhóm/video chỉ lưu một dòng. Hệ thống sẽ chặn trùng theo ID, link hoặc cùng nền tảng + loại + tên kênh.
          </p>
          <div className="channel-modal-grid">
            <div className="channel-field">
              <label>Nền tảng</label>
              <input
                list="platform-options"
                value={form.platform}
                onChange={(e) => setField('platform', e.target.value)}
                placeholder="Ví dụ: Facebook, TikTok"
                autoFocus
              />
              <datalist id="platform-options">
                {PLATFORM_OPTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
            <div className="channel-field">
              <label>Kênh</label>
              <input
                list="channel-options"
                value={form.channel_name}
                onChange={(e) => setField('channel_name', e.target.value)}
                placeholder="Tên page / nhóm / kênh"
              />
              <datalist id="channel-options">
                {channelOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
            <div className="channel-field">
              <label>Loại</label>
              <input
                list="channel-type-options"
                value={form.channel_type}
                onChange={(e) => setField('channel_type', e.target.value)}
                placeholder="Page, Video, Nhóm"
              />
              <datalist id="channel-type-options">
                {TYPE_OPTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
            <div className="channel-field">
              <label>ID</label>
              <input value={form.target_id} onChange={(e) => setField('target_id', e.target.value)} placeholder="ID nếu có" />
            </div>
            <div className="channel-field channel-modal-wide">
              <label>Link</label>
              <input value={form.link} onChange={(e) => setField('link', e.target.value)} placeholder="Dán link page / video / nhóm" />
            </div>
            <div className="channel-field channel-modal-wide">
              <label>Ghi chú</label>
              <input value={form.note} onChange={(e) => setField('note', e.target.value)} placeholder="Ghi chú vận hành" />
            </div>
            {canAssignStaff ? (
              <div className="channel-field channel-modal-wide">
                <label>Nhân sự phụ trách</label>
                <div className="staff-managed-dropdown">
                  <button
                    type="button"
                    className={`staff-managed-dropdown-trigger${staffMenuOpen ? ' open' : ''}`}
                    disabled={!assignableStaff.length}
                    onClick={() => setStaffMenuOpen((open) => !open)}
                  >
                    <span>{assignableStaff.length ? staffPickerLabel() : 'Chưa có nhân sự — thêm tại /nhan-su'}</span>
                    <span className="staff-managed-dropdown-caret">▾</span>
                  </button>
                  {staffMenuOpen && assignableStaff.length ? (
                    <div className="staff-managed-dropdown-menu">
                      <div className="staff-managed-toolbar">
                        <span>{form.assigned_staff_ids.length}/{assignableStaff.length} đã chọn</span>
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            assigned_staff_ids: assignableStaff.map((item) => item.id!),
                          }))}
                        >
                          Chọn tất cả
                        </button>
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => setForm((prev) => ({ ...prev, assigned_staff_ids: [] }))}
                        >
                          Bỏ chọn
                        </button>
                      </div>
                      <div className="staff-managed-checklist">
                        {assignableStaff.map((person) => (
                          <label
                            key={person.id}
                            className={`staff-managed-check${form.assigned_staff_ids.includes(person.id!) ? ' checked' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={form.assigned_staff_ids.includes(person.id!)}
                              onChange={(e) => toggleAssignedStaff(person.id!, e.target.checked)}
                            />
                            <span>{person.name || person.username || person.id}</span>
                            {person.username ? <small>{person.username}</small> : null}
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <small className="channel-staff-hint">
                  Một nhân sự có thể phụ trách nhiều nhóm và page. Chọn nhân sự cho từng kênh — danh sách kênh của họ sẽ cộng dồn, không ghi đè kênh cũ.
                </small>
              </div>
            ) : null}
          </div>
          {formError ? <div className="modal-result channel-form-error">{formError}</div> : null}
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={reset}>
              Huỷ
            </button>
            <button type="submit" className="btn-submit" disabled={busy}>
              {busy ? 'Đang lưu...' : editingId ? 'Cập nhật' : 'Thêm kênh'}
            </button>
          </div>
        </form>
      </div>

      <div className={`modal-overlay${staffModalOpen ? ' open' : ''}`} onClick={closeStaffModal}>
        <div className="modal channel-staff-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-hd">
            <span>Gán nhân sự</span>
            <button type="button" className="modal-close-button" aria-label="Đóng" onClick={closeStaffModal}>
              ×
            </button>
          </div>
          {staffModalChannel ? (
            <p className="channel-modal-note">
              <b>{staffModalChannel.channel_name || staffModalChannel.target_id || 'Kênh'}</b>
              {staffModalChannel.channel_type ? ` · ${staffModalChannel.channel_type}` : ''}
            </p>
          ) : null}
          {assignableStaff.length ? (
            <>
              <div className="staff-managed-toolbar">
                <span>{staffModalIds.length}/{assignableStaff.length} đã chọn</span>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setStaffModalIds(assignableStaff.map((item) => item.id!))}
                >
                  Chọn tất cả
                </button>
                <button type="button" className="btn-cancel" onClick={() => setStaffModalIds([])}>
                  Bỏ chọn
                </button>
              </div>
              <div className="staff-managed-checklist channel-staff-modal-list">
                {assignableStaff.map((person) => (
                  <label
                    key={person.id}
                    className={`staff-managed-check${staffModalIds.includes(person.id!) ? ' checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={staffModalIds.includes(person.id!)}
                      onChange={(e) => toggleStaffModalId(person.id!, e.target.checked)}
                    />
                    <span>{person.name || person.username || person.id}</span>
                    {person.username ? <small>{person.username}</small> : null}
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="channel-modal-note">Chưa có nhân sự — thêm tại /nhan-su</p>
          )}
          <small className="channel-staff-hint">
            Một nhân sự có thể phụ trách nhiều nhóm và page. Kênh cũ của họ vẫn được giữ.
          </small>
          {staffModalError ? <div className="modal-result channel-form-error">{staffModalError}</div> : null}
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={closeStaffModal}>
              Huỷ
            </button>
            <button
              type="button"
              className="btn-submit"
              disabled={busy || !assignableStaff.length}
              onClick={() => void saveStaffModal()}
            >
              {busy ? 'Đang lưu...' : 'Lưu nhân sự'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
