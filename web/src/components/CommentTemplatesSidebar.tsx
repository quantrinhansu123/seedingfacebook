'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type ReplyTemplate = {
  id: string;
  trigger: string;
  title: string;
  text: string;
  system?: boolean;
};

const EMPTY_FORM = { title: '', trigger: '', text: '' };

export function CommentTemplatesSidebar() {
  const [templates, setTemplates] = useState<ReplyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/api/comment-templates');
      const d = await r.json();
      if (d.ok && Array.isArray(d.templates)) {
        setTemplates(
          d.templates.map((item: ReplyTemplate) => ({
            id: String(item.id || ''),
            trigger: String(item.trigger || ''),
            title: String(item.title || ''),
            text: String(item.text || ''),
            system: Boolean(item.system),
          })),
        );
      }
    } catch {
      setStatus('Không tải được mẫu comment');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function copyTemplate(item: ReplyTemplate) {
    try {
      await navigator.clipboard.writeText(item.text);
      setStatus(`✅ Đã sao chép: ${item.title}`);
    } catch {
      setStatus('❌ Không sao chép được');
    }
    setTimeout(() => setStatus(''), 3000);
  }

  async function createTemplate() {
    if (!form.title.trim() || !form.text.trim()) {
      setStatus('Nhập tên và nội dung mẫu');
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const r = await api('/api/comment-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.ok) {
        setForm(EMPTY_FORM);
        setFormOpen(false);
        setTemplates(
          (d.templates || []).map((item: ReplyTemplate) => ({
            id: String(item.id || ''),
            trigger: String(item.trigger || ''),
            title: String(item.title || ''),
            text: String(item.text || ''),
            system: Boolean(item.system),
          })),
        );
        setStatus('✅ Đã thêm mẫu comment');
      } else {
        setStatus(`❌ ${d.error || 'Lỗi lưu mẫu'}`);
      }
    } catch {
      setStatus('❌ Lỗi kết nối');
    }
    setBusy(false);
    setTimeout(() => setStatus(''), 4000);
  }

  async function deleteTemplate(id: string) {
    setBusy(true);
    try {
      const r = await api(`/api/comment-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.ok) {
        setTemplates(
          (d.templates || []).map((item: ReplyTemplate) => ({
            id: String(item.id || ''),
            trigger: String(item.trigger || ''),
            title: String(item.title || ''),
            text: String(item.text || ''),
            system: Boolean(item.system),
          })),
        );
        setStatus('✅ Đã xoá mẫu');
      } else {
        setStatus(`❌ ${d.error || 'Không xoá được'}`);
      }
    } catch {
      setStatus('❌ Lỗi kết nối');
    }
    setBusy(false);
    setTimeout(() => setStatus(''), 4000);
  }

  return (
    <aside className="md-templates no-scrollbar">
      <div className="md-templates-head">
        <div>
          <i className="fa-regular fa-message" />
          <span>Mẫu comment</span>
        </div>
        <button type="button" className="md-templates-add" onClick={() => setFormOpen((v) => !v)} title="Thêm mẫu">
          <i className="fa-solid fa-plus" />
        </button>
      </div>

      <div className="md-templates-body">
        {formOpen ? (
          <div className="md-template-form">
            <input
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              placeholder="Tên mẫu (vd: Báo giá)"
            />
            <input
              value={form.trigger}
              onChange={(e) => setForm((s) => ({ ...s, trigger: e.target.value }))}
              placeholder="Lệnh /, vd: baogia"
            />
            <textarea
              value={form.text}
              onChange={(e) => setForm((s) => ({ ...s, text: e.target.value }))}
              placeholder="Nội dung comment / trả lời..."
              rows={4}
            />
            <div className="md-template-form-actions">
              <button type="button" className="md-ghost-btn" onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); }}>
                Huỷ
              </button>
              <button type="button" className="md-join-btn" disabled={busy} onClick={() => void createTemplate()}>
                {busy ? 'Đang lưu...' : 'Lưu mẫu'}
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="md-empty">Đang tải mẫu...</p>
        ) : templates.length ? (
          <div className="md-template-list">
            {templates.map((item) => (
              <div key={item.id} className="md-template-card">
                <div className="md-template-card-head">
                  <b>{item.title}</b>
                  {item.trigger ? <small>/{item.trigger}</small> : null}
                </div>
                <p>{item.text}</p>
                <div className="md-template-card-actions">
                  <button type="button" className="md-join-btn" onClick={() => void copyTemplate(item)}>
                    Sao chép
                  </button>
                  {!item.system ? (
                    <button type="button" className="md-ghost-btn" disabled={busy} onClick={() => void deleteTemplate(item.id)}>
                      Xoá
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="md-empty">Chưa có mẫu comment. Bấm + để thêm.</p>
        )}

        {status ? <p className="md-template-status">{status}</p> : null}
      </div>
    </aside>
  );
}
