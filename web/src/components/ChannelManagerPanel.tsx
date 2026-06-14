'use client';

import { FormEvent, useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { ManagedChannel } from '@/lib/types';
import { extractSlug } from '@/lib/utils';

type Payload = {
  platform: string;
  channel_name: string;
  channel_type: string;
  link: string;
  target_id: string;
  note: string;
};

type Props = {
  channels: ManagedChannel[];
  status: string;
  busy: boolean;
  onSave: (payload: Payload, id?: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onReload: () => Promise<unknown>;
  onSyncFacebookPages?: () => Promise<unknown>;
};

type ChannelTabKey = 'all' | 'groups' | 'pages' | 'tiktok';

const EMPTY: Payload = {
  platform: '',
  channel_name: '',
  channel_type: 'Nhóm',
  link: '',
  target_id: '',
  note: '',
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

export function ChannelManagerPanel({ channels, status, busy, onSave, onDelete, onReload, onSyncFacebookPages }: Props) {
  const [form, setForm] = useState<Payload>(EMPTY);
  const [editingId, setEditingId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [activeTab, setActiveTab] = useState<ChannelTabKey>('all');
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [groupMembership, setGroupMembership] = useState<Record<string, boolean | null>>({});
  const [membershipCheckingIds, setMembershipCheckingIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Record<string, boolean>>({});
  const [joiningGroupId, setJoiningGroupId] = useState('');
  const [joinMsg, setJoinMsg] = useState('');

  const loadGroupMembership = useCallback(async (ids: string[]) => {
    const unique = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!unique.length) return;
    setMembershipCheckingIds((prev) => [...new Set([...prev, ...unique])]);
    try {
      const r = await api(`/api/group-membership?ids=${encodeURIComponent(unique.join(','))}`, {
        timeoutMs: 120000,
      });
      const d = await r.json();
      if (d.ok && d.membership && typeof d.membership === 'object') {
        setGroupMembership((prev) => ({ ...prev, ...d.membership }));
      }
    } catch {
      /* ignore */
    } finally {
      setMembershipCheckingIds((prev) => prev.filter((id) => !unique.includes(id)));
    }
  }, []);

  async function joinGroupNow(gid: string, name: string) {
    if (!gid) return;
    setJoiningGroupId(gid);
    setJoinMsg('');
    try {
      const r = await api(`/api/groups/${gid}/join`, { method: 'POST', timeoutMs: 60000 });
      const d = await r.json();
      if (d.ok) {
        if (d.already_member) {
          setGroupMembership((prev) => ({ ...prev, [gid]: true }));
          setJoinMsg(`✅ Đã tham gia nhóm "${name || gid}"`);
        } else {
          setJoinMsg(`✅ ${d.msg || 'Đã gửi yêu cầu tham gia'} — bấm Kiểm tra nhóm để cập nhật trạng thái.`);
        }
        void loadGroupMembership([gid]);
      } else {
        setJoinMsg(`❌ ${d.error || 'Không tham gia được nhóm'}`);
        if (d.manual_required && d.group_url && typeof window !== 'undefined') {
          window.open(String(d.group_url), '_blank', 'noopener,noreferrer');
          setJoinMsg((prev) => `${prev} Đã mở Facebook — tham gia thủ công rồi bấm Kiểm tra nhóm.`);
        }
      }
    } catch {
      setJoinMsg('❌ Lỗi kết nối khi tham gia nhóm');
    } finally {
      setJoiningGroupId('');
    }
    setTimeout(() => setJoinMsg(''), 12000);
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

  const visibleFacebookGroupIds = useMemo(
    () =>
      [...new Set(
        filtered
          .filter(isFacebookGroup)
          .map(groupIdFromChannel)
          .filter(Boolean),
      )],
    [filtered],
  );

  const checkedGroupIds = visibleFacebookGroupIds.filter((gid) => selectedGroupIds[gid]);
  const checkingSet = useMemo(() => new Set(membershipCheckingIds), [membershipCheckingIds]);

  function membershipLabel(gid: string): string {
    if (checkingSet.has(gid)) return 'Đang kiểm tra...';
    const member = groupMembership[gid];
    if (member === true) return 'Đã tham gia';
    if (member === false) return 'Chưa tham gia';
    return 'Chưa kiểm tra';
  }

  function checkSelectedMembership() {
    const ids = checkedGroupIds.length ? checkedGroupIds : visibleFacebookGroupIds;
    if (!ids.length) return;
    void loadGroupMembership(ids);
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
    });
    setFormError('');
    setModalOpen(true);
  }

  function reset() {
    setEditingId('');
    setForm(EMPTY);
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
    const ok = await onSave(form, editingId || undefined);
    if (ok) reset();
  }

  return (
    <section className="module-panel">
      <div className="module-head">
        <div>
          <div className="module-kicker">Quản lý nhóm / kênh</div>
          <h2>Kênh theo dõi</h2>
        </div>
        <div className="module-actions">
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
        {visibleFacebookGroupIds.length ? (
          <button
            type="button"
            className="btn-cancel channel-check-btn"
            disabled={checkingSet.size > 0}
            onClick={checkSelectedMembership}
          >
            {checkingSet.size > 0
              ? 'Đang kiểm tra...'
              : `Kiểm tra nhóm${checkedGroupIds.length ? ` (${checkedGroupIds.length})` : ''}`}
          </button>
        ) : null}
      </div>
      </div>

      {activeTab === 'groups' || visibleFacebookGroupIds.length ? (
        <p className="channel-join-hint">
          Để <b>Tham gia ngay</b> hoạt động: cần cookie Facebook tại mục <b>Nhân sự</b> (Lấy từ Chrome).
          Nhóm kín thường phải bấm <b>Mở FB</b> tham gia thủ công, sau đó <b>Kiểm tra nhóm</b>.
        </p>
      ) : null}

      <div className="data-table-wrap">
        <table className="data-table channel-data-table">
          <thead>
            <tr>
              <th className="select-col">
                {visibleFacebookGroupIds.length ? (
                  <input
                    type="checkbox"
                    title="Chọn tất cả nhóm Facebook"
                    checked={
                      visibleFacebookGroupIds.length > 0 &&
                      visibleFacebookGroupIds.every((gid) => selectedGroupIds[gid])
                    }
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedGroupIds((prev) => {
                        const next = { ...prev };
                        visibleFacebookGroupIds.forEach((gid) => {
                          if (checked) next[gid] = true;
                          else delete next[gid];
                        });
                        return next;
                      });
                    }}
                  />
                ) : null}
              </th>
              <th>Mã</th>
              <th>Nền tảng</th>
              <th>Kênh</th>
              <th>Loại</th>
              <th>Trạng thái</th>
              <th>Link</th>
              <th className="channel-id-col">ID</th>
              <th className="channel-actions-col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((item) => {
                const gid = groupIdFromChannel(item);
                const member = gid ? groupMembership[gid] : undefined;
                return (
                  <tr key={item.id}>
                    <td className="select-col">
                      {isFacebookGroup(item) && gid ? (
                        <input
                          type="checkbox"
                          checked={!!selectedGroupIds[gid]}
                          onChange={(e) =>
                            setSelectedGroupIds((prev) => ({
                              ...prev,
                              [gid]: e.target.checked,
                            }))
                          }
                        />
                      ) : null}
                    </td>
                    <td className="mono-cell channel-code-col">{item.id}</td>
                    <td>
                      <span className="platform-pill">{item.platform || '-'}</span>
                    </td>
                    <td className="channel-name-cell">
                      <b title={item.channel_name || '-'}>{item.channel_name || '-'}</b>
                      {item.note ? <small>{item.note}</small> : null}
                    </td>
                    <td className="channel-type-col">{item.channel_type || '-'}</td>
                    <td>
                      {isFacebookGroup(item) && gid ? (
                        <span
                          className={`channel-status-pill${
                            checkingSet.has(gid)
                              ? ' pending'
                              : member === true
                                ? ' ok'
                                : member === false
                                  ? ' warn'
                                  : ' idle'
                          }`}
                        >
                          {membershipLabel(gid)}
                        </span>
                      ) : (
                        <span className="channel-status-pill na">—</span>
                      )}
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
                            <>
                              {member !== true ? (
                                <button
                                  type="button"
                                  className="btn-join-now"
                                  disabled={joiningGroupId === gid}
                                  onClick={() => void joinGroupNow(gid, item.channel_name || gid)}
                                >
                                  {joiningGroupId === gid ? '...' : 'Tham gia'}
                                </button>
                              ) : null}
                              <a
                                className="btn-join-now ghost"
                                href={`https://www.facebook.com/groups/${gid}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                FB
                              </a>
                              <button
                                type="button"
                                className="btn-join-now ghost"
                                disabled={checkingSet.has(gid)}
                                onClick={() => void loadGroupMembership([gid])}
                              >
                                {checkingSet.has(gid) ? '...' : 'Check'}
                              </button>
                            </>
                          ) : null}
                        </div>
                        <div className="channel-core-actions">
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
                <td colSpan={9} className="table-empty">
                  Chưa có kênh nào
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(status || joinMsg) ? <div className="module-status">{joinMsg || status}</div> : null}

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
    </section>
  );
}
