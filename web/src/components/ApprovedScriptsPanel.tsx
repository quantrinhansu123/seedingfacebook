'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, RefreshCw, ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import './approved-scripts-panel.css';

type ScriptBlock = {
  id: string;
  type: string;
  text: string;
};

type ScriptDocument = {
  id: string;
  title: string;
  platform: string;
  status: string;
  writer: string;
  date: string;
  blocks: ScriptBlock[];
};

function htmlToPlain(text: string) {
  if (!text) return '';
  if (typeof document === 'undefined') return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const div = document.createElement('div');
  div.innerHTML = text;
  return (div.textContent || div.innerText || '').replace(/\u00a0/g, ' ').trim();
}

function blockLabel(type: string) {
  if (type === 'hook' || type === 'h1' || type === 'h2') return 'HOOK';
  if (type === 'cta') return 'CTA';
  if (type === 'scene') return 'SCREEN';
  return 'BODY';
}

function completeText(script: ScriptDocument) {
  return script.blocks
    .map((block) => {
      const text = htmlToPlain(block.text).trim();
      return text ? `[${blockLabel(block.type)}]\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function ApprovedScriptsPanel() {
  const [scripts, setScripts] = useState<ScriptDocument[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState('Đang tải bài đã duyệt...');

  async function load() {
    setStatus('Đang tải bài đã duyệt...');
    try {
      const response = await api('/api/scripts?status=approved', { timeoutMs: 30000 });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không tải được kịch bản');
      const rows = Array.isArray(payload.scripts) ? payload.scripts as ScriptDocument[] : [];
      setScripts(rows);
      setSelectedId((current) => (rows.some((item) => item.id === current) ? current : rows[0]?.id || ''));
      setStatus(
        payload.warning
          || (rows.length
            ? `${rows.length} bài đã duyệt`
            : 'Chưa có bài đã duyệt — vào Kịch bản và bấm Duyệt'),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không tải được bài đã duyệt');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(() => scripts.find((item) => item.id === selectedId) || null, [scripts, selectedId]);

  async function copySelected() {
    if (!selected) return;
    await navigator.clipboard.writeText(completeText(selected));
    setStatus('Đã copy bài đã duyệt.');
  }

  return (
    <section className="approved-scripts">
      <div className="approved-scripts-head">
        <div>
          <h2><CheckCircle2 /> Các bài viết đã duyệt</h2>
          <p>{status}</p>
        </div>
        <button type="button" onClick={() => void load()}><RefreshCw /> Tải lại</button>
      </div>

      <div className="approved-scripts-layout">
        <aside className="approved-scripts-list">
          {scripts.map((script) => (
            <button
              key={script.id}
              type="button"
              className={script.id === selectedId ? 'active' : ''}
              onClick={() => setSelectedId(script.id)}
            >
              <strong>{script.title}</strong>
              <span>{script.writer || 'Chưa gán'} · {script.platform}</span>
            </button>
          ))}
          {!scripts.length ? <div className="approved-scripts-empty">Chưa có bài được duyệt.</div> : null}
        </aside>

        <article className="approved-scripts-detail">
          {selected ? (
            <>
              <div className="approved-scripts-title">
                <div>
                  <span><ScrollText /> Bài hoàn chỉnh</span>
                  <h3>{selected.title}</h3>
                </div>
                <button type="button" onClick={() => void copySelected()}><Clipboard /> Copy</button>
              </div>
              <div className="approved-scripts-content">
                {selected.blocks.map((block) => {
                  const text = htmlToPlain(block.text).trim();
                  return text ? (
                    <section key={block.id}>
                      <b>{blockLabel(block.type)}</b>
                      <p>{text}</p>
                    </section>
                  ) : null;
                })}
              </div>
            </>
          ) : (
            <div className="approved-scripts-empty large">Chọn một bài đã duyệt để xem nội dung.</div>
          )}
        </article>
      </div>
    </section>
  );
}
