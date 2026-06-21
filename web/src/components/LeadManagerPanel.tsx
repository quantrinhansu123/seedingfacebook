'use client';

import { useMemo, useState } from 'react';
import type { Lead } from '@/lib/types';
import { pct } from '@/lib/format';

type LeadRow = Lead & { post_id?: string };
type LeadSelection = { postId: string; leadKey: string };

function selectionKey(postId: string, leadKey: string) {
  return `${postId}|${leadKey}`;
}

export function LeadManagerPanel({
  leads,
  busy,
  onExtract,
  onSyncPhones,
  onDelete,
  onDeleteMany,
}: {
  leads: Record<string, Lead[]>;
  busy?: boolean;
  onExtract: () => Promise<void>;
  onSyncPhones: () => Promise<void>;
  onDelete: (postId: string, leadKey: string, name?: string) => Promise<void>;
  onDeleteMany: (items: LeadSelection[]) => Promise<void>;
}) {
  const rows = useMemo<LeadRow[]>(
    () =>
      Object.entries(leads).flatMap(([postId, items]) =>
        (items || []).map((item) => ({ ...item, post_id: postId })),
      ),
    [leads],
  );
  const selectableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of rows) {
      if (item.lead_key && item.post_id) {
        keys.add(selectionKey(item.post_id, item.lead_key));
      }
    }
    return keys;
  }, [rows]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedItems = useMemo(() => {
    const items: LeadSelection[] = [];
    for (const item of rows) {
      if (!item.lead_key || !item.post_id) continue;
      const key = selectionKey(item.post_id, item.lead_key);
      if (!selectableKeys.has(key) || !selected[key]) continue;
      items.push({ postId: item.post_id, leadKey: item.lead_key });
    }
    return items;
  }, [rows, selectableKeys, selected]);
  const allSelected = selectableKeys.size > 0 && selectedItems.length === selectableKeys.size;
  const hasSelectableRows = selectableKeys.size > 0;

  function toggleRow(postId: string, leadKey: string, checked: boolean) {
    const key = selectionKey(postId, leadKey);
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[key] = true;
      else delete next[key];
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const item of rows) {
      if (!item.lead_key || !item.post_id) continue;
      next[selectionKey(item.post_id, item.lead_key)] = true;
    }
    setSelected(next);
  }

  return (
    <section className="module-panel">
      <div className="module-head">
        <div>
          <div className="module-kicker">Lead</div>
          <h2>Khách hàng tiềm năng</h2>
        </div>
        <div className="module-actions">
          {selectedItems.length ? (
            <button
              type="button"
              className="btn-cancel danger"
              disabled={busy}
              onClick={() => void onDeleteMany(selectedItems)}
            >
              {allSelected ? `Xoá hết (${selectedItems.length})` : `Xoá đã chọn (${selectedItems.length})`}
            </button>
          ) : null}
          <button type="button" className="btn-cancel" disabled={busy} onClick={() => void onSyncPhones()}>
            Lấy SĐT từ comment
          </button>
          <button type="button" className="btn-submit" disabled={busy} onClick={() => void onExtract()}>
            Tách lead AI
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="select-col">
                {hasSelectableRows ? (
                  <input
                    type="checkbox"
                    title="Chọn tất cả"
                    disabled={busy}
                    checked={allSelected}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                  />
                ) : null}
              </th>
              <th>Khách hàng</th>
              <th>Người cmt</th>
              <th>Nội dung Cmt</th>
              <th>Nhu cầu</th>
              <th>SĐT</th>
              <th>Nguồn</th>
              <th>Bài viết</th>
              <th>Link</th>
              <th>Độ chắc</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((item, idx) => {
                const canSelect = Boolean(item.lead_key && item.post_id);
                const key = canSelect ? selectionKey(item.post_id!, item.lead_key!) : '';
                return (
                  <tr key={`${item.lead_key || item.post_id}-${idx}`}>
                    <td className="select-col">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={Boolean(selected[key])}
                          onChange={(e) => toggleRow(item.post_id!, item.lead_key!, e.target.checked)}
                        />
                      ) : null}
                    </td>
                    <td>
                      <b>{item.name || 'Ẩn danh'}</b>
                      <small>{item.location || item.product_or_service || ''}</small>
                    </td>
                    <td>{item.comment_author || (item.source === 'comment' ? item.name : '-') || '-'}</td>
                    <td className="lead-comment-cell">{item.comment_text || item.evidence || '-'}</td>
                    <td>{item.need || '-'}</td>
                    <td>{item.phone || '-'}</td>
                    <td>
                      {item.platform ? `${item.platform} · ` : ''}
                      {item.source === 'post' ? 'Bài viết' : 'Bình luận'}
                    </td>
                    <td className="mono-cell">{item.post_id || '-'}</td>
                    <td>
                      {(item.comment_url || item.post_url) ? (
                        <a href={item.comment_url || item.post_url} target="_blank" rel="noreferrer">
                          Mở
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{pct(item.confidence) || '-'}</td>
                    <td>
                      {canSelect ? (
                        <button
                          type="button"
                          className="table-icon-button danger"
                          title="Xoá"
                          disabled={busy}
                          onClick={() => void onDelete(item.post_id!, item.lead_key!, item.name)}
                        >
                          ✕
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={11} className="table-empty">
                  Chưa có lead. Bấm Lấy SĐT từ comment hoặc Tách lead AI sau khi tải bài/comment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
