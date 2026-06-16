'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bot,
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  FileDown,
  GripVertical,
  Italic,
  Plus,
  Printer,
  Pencil,
  Save,
  Send,
  Sparkles,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import './script-writer-panel.css';

type ScriptStatus = 'draft' | 'pending' | 'approved';
type BlockType = 'text' | 'h1' | 'h2' | 'hook' | 'body' | 'cta' | 'scene' | 'quote';
type BlockAlign = 'left' | 'center' | 'right' | 'justify';

type ScriptBlock = {
  id: string;
  type: BlockType;
  text: string;
  align?: BlockAlign;
};

type ScriptDocument = {
  id: string;
  title: string;
  platform: string;
  status: ScriptStatus;
  writer: string;
  date: string;
  blocks: ScriptBlock[];
};

const BLOCK_TYPES: Array<{ id: BlockType; label: string; icon: string; placeholder: string }> = [
  { id: 'text', label: 'TEXT', icon: '📝', placeholder: 'Nhập nội dung...' },
  { id: 'h1', label: 'H1', icon: '🔠', placeholder: 'Tiêu đề lớn...' },
  { id: 'h2', label: 'H2', icon: '🔡', placeholder: 'Đề mục...' },
  { id: 'hook', label: 'HOOK', icon: '⚡', placeholder: 'Hook bắt đầu...' },
  { id: 'body', label: 'BODY', icon: '📄', placeholder: 'Nội dung chính...' },
  { id: 'cta', label: 'CTA', icon: '🔔', placeholder: 'Kêu gọi hành động...' },
  { id: 'scene', label: 'SCENE', icon: '🎬', placeholder: '[Cảnh quay / góc máy]...' },
  { id: 'quote', label: 'QUOTE', icon: '💬', placeholder: 'Trích dẫn...' },
];

const STATUS_LABELS: Record<ScriptStatus, string> = {
  draft: 'Nháp',
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
};

const INITIAL_SCRIPTS: ScriptDocument[] = [
  {
    id: 'script-truss-rod',
    title: 'Hướng dẫn điều chỉnh ty đàn',
    platform: 'TikTok',
    status: 'approved',
    writer: 'An',
    date: '01/06/2026',
    blocks: [
      { id: 'b1', type: 'hook', text: 'Bạn đang bị rè dây, tiếng đàn không chuẩn? Đây là cách xử lý!' },
      { id: 'b2', type: 'scene', text: '[Cảnh: Cận đàn guitar, tay điều chỉnh ốc ty]' },
      { id: 'b3', type: 'body', text: 'Ty đàn (truss rod) là thanh kim loại bên trong cần đàn giúp điều chỉnh độ cong. Khi thời tiết thay đổi, ty có thể bị lệch.' },
      { id: 'b4', type: 'cta', text: 'Like và follow Guitar Sài Thành để nhận thêm mẹo chăm sóc đàn mỗi ngày! 🎸' },
    ],
  },
  {
    id: 'script-acoustic-review',
    title: 'Review đàn acoustic 3 triệu',
    platform: 'YouTube',
    status: 'pending',
    writer: 'Bình',
    date: '02/06/2026',
    blocks: [
      { id: 'b5', type: 'hook', text: '3 triệu mua được đàn acoustic ngon? Mình sẽ review thật 100%!' },
      { id: 'b6', type: 'body', text: 'Hôm nay mình review 3 cây đàn acoustic tầm giá 3 triệu đồng...' },
    ],
  },
];

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function plainText(script: ScriptDocument) {
  return buildCompleteScriptText(script);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function isHtmlText(text: string) {
  return /<[a-z][\s\S]*>/i.test(text || '');
}

function htmlToPlain(text: string) {
  if (!text) return '';
  if (typeof document === 'undefined') return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const div = document.createElement('div');
  div.innerHTML = text;
  return (div.textContent || div.innerText || '').replace(/\u00a0/g, ' ').trim();
}

function sanitizeInlineHtml(raw: string) {
  if (!raw) return '';
  if (typeof DOMParser === 'undefined') return escapeHtml(htmlToPlain(raw));
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'P', 'DIV', 'SPAN']);
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    if (!allowed.has(el.tagName)) return Array.from(el.childNodes).map(walk).join('');
    const tag = el.tagName.toLowerCase();
    const style = el.getAttribute('style') || '';
    const safeStyle = /text-align\s*:\s*(left|center|right|justify)/i.test(style)
      ? ` style="text-align:${style.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1]?.toLowerCase() || 'left'}"`
      : '';
    if (tag === 'br') return '<br>';
    return `<${tag}${safeStyle}>${Array.from(el.childNodes).map(walk).join('')}</${tag}>`;
  }

  return Array.from(doc.body.childNodes).map(walk).join('') || escapeHtml(htmlToPlain(raw));
}

function blockContentHtml(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return isHtmlText(trimmed) ? sanitizeInlineHtml(trimmed) : escapeHtml(trimmed).replace(/\n/g, '<br>');
}

function blockAlignStyle(align?: BlockAlign) {
  return align && align !== 'left' ? `text-align:${align};` : '';
}

function buildCompleteScriptText(script: ScriptDocument) {
  const lines = [
    script.title,
    `${script.platform} · ${script.writer} · ${script.date}`,
    '─'.repeat(40),
    '',
  ];
  script.blocks.forEach((block) => {
    const text = htmlToPlain(block.text).trim();
    if (!text) return;
    const type = BLOCK_TYPES.find((item) => item.id === block.type);
    if (block.type !== 'text') lines.push(`【${type?.label || block.type.toUpperCase()}】`);
    lines.push(text, '');
  });
  return lines.join('\n').trim();
}

const FB_BLOCK_STYLES: Partial<Record<BlockType, string>> = {
  hook: 'font-size:15px;font-weight:600;',
  h1: 'font-size:18px;font-weight:800;',
  h2: 'font-size:16px;font-weight:700;',
  body: 'line-height:1.65;',
  cta: 'font-weight:700;',
  scene: 'font-size:12px;color:#65676b;font-style:italic;',
  quote: 'font-style:italic;border-left:3px solid #e4e6eb;padding-left:10px;',
  text: 'line-height:1.65;',
};

function buildFacebookPost(script: ScriptDocument) {
  const htmlParts: string[] = [];
  const plainParts: string[] = [];

  script.blocks.forEach((block) => {
    const plain = htmlToPlain(block.text).trim();
    if (!plain) return;
    plainParts.push(plain);
    const inner = blockContentHtml(block.text);
    const style = `${FB_BLOCK_STYLES[block.type] || FB_BLOCK_STYLES.text || ''}${blockAlignStyle(block.align)}`;
    htmlParts.push(`<p class="script-fb-para script-fb-${block.type}" style="margin:0 0 12px;${style}">${inner}</p>`);
  });

  return {
    html: htmlParts.join(''),
    plain: plainParts.join('\n\n').trim(),
    hasContent: plainParts.length > 0,
  };
}

type ScriptFacebookPreviewProps = {
  script: ScriptDocument;
  postHtml: string;
  hasContent: boolean;
};

function ScriptFacebookPreview({ script, postHtml, hasContent }: ScriptFacebookPreviewProps) {
  const pageName = script.writer?.trim() || 'Seeding Fsolution';
  const avatar = pageName.slice(0, 1).toUpperCase();

  return (
    <div className="script-fb-preview-wrap">
      <div className="seeding-fb-preview script-fb-preview-large">
        <div className="seeding-fb-preview-label">
          <span>👁 Xem trước bài đăng Facebook</span>
          <em>Sẵn sàng copy &amp; đăng</em>
        </div>
        <article className="seeding-fb-post-card script-fb-post-card-large">
          <header className="seeding-fb-post-head">
            <div className="seeding-fb-avatar" aria-hidden="true">{avatar}</div>
            <div>
              <b>{pageName}</b>
              <small>Vừa xong · 🌐 · {script.platform}</small>
            </div>
          </header>
          {hasContent ? (
            <div
              className="seeding-fb-post-text script-fb-post-rich"
              dangerouslySetInnerHTML={{ __html: postHtml }}
            />
          ) : (
            <div className="seeding-fb-post-text seeding-fb-post-placeholder">
              Thêm nội dung block để xem bài đăng hoàn chỉnh…
            </div>
          )}
          <div className="script-fb-post-foot">
            <div className="script-fb-reactions" aria-hidden="true">
              <span>👍</span><span>❤️</span><span>😮</span>
              <small>Thích · Bình luận · Chia sẻ</small>
            </div>
            <p className="script-fb-post-note">Khi đăng lên Facebook, thêm ảnh/video phù hợp với kịch bản.</p>
          </div>
        </article>
      </div>
    </div>
  );
}

type ScriptBlockEditorProps = {
  block: ScriptBlock;
  placeholder: string;
  onChange: (patch: Partial<ScriptBlock>) => void;
};

function ScriptBlockEditor({ block, placeholder, onChange }: ScriptBlockEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const mountedBlockId = useRef('');

  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    if (mountedBlockId.current !== block.id) {
      node.innerHTML = block.text || '';
      mountedBlockId.current = block.id;
    }
  }, [block.id]);

  function syncEditor() {
    const node = editorRef.current;
    if (!node) return;
    onChange({ text: node.innerHTML });
  }

  function runCommand(command: string, value?: string) {
    const node = editorRef.current;
    if (!node) return;
    node.focus();
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* trình duyệt cũ */
    }
    document.execCommand(command, false, value);
    syncEditor();
  }

  function handleFormatMouseDown(event: MouseEvent, command: string, value?: string) {
    event.preventDefault();
    runCommand(command, value);
  }

  function setAlign(align: BlockAlign) {
    onChange({ align });
    const node = editorRef.current;
    if (!node) return;
    node.focus();
    const commandMap: Record<BlockAlign, string> = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
      justify: 'justifyFull',
    };
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* ignore */
    }
    document.execCommand(commandMap[align], false);
    syncEditor();
  }

  function handleAlignMouseDown(event: MouseEvent, align: BlockAlign) {
    event.preventDefault();
    setAlign(align);
  }

  return (
    <div className="script-block-editor">
      <div className="script-block-toolbar" role="toolbar" aria-label="Định dạng văn bản">
        <button type="button" title="In đậm" onMouseDown={(event) => handleFormatMouseDown(event, 'bold')}>
          <Bold />
        </button>
        <button type="button" title="In nghiêng" onMouseDown={(event) => handleFormatMouseDown(event, 'italic')}>
          <Italic />
        </button>
        <button type="button" title="Gạch chân" onMouseDown={(event) => handleFormatMouseDown(event, 'underline')}>
          <Underline />
        </button>
        <span className="script-block-toolbar-divider" aria-hidden="true" />
        <button type="button" className={block.align === 'left' || !block.align ? 'active' : ''} title="Căn trái" onMouseDown={(event) => handleAlignMouseDown(event, 'left')}>
          <AlignLeft />
        </button>
        <button type="button" className={block.align === 'center' ? 'active' : ''} title="Căn giữa" onMouseDown={(event) => handleAlignMouseDown(event, 'center')}>
          <AlignCenter />
        </button>
        <button type="button" className={block.align === 'right' ? 'active' : ''} title="Căn phải" onMouseDown={(event) => handleAlignMouseDown(event, 'right')}>
          <AlignRight />
        </button>
        <button type="button" className={block.align === 'justify' ? 'active' : ''} title="Căn đều" onMouseDown={(event) => handleAlignMouseDown(event, 'justify')}>
          <AlignJustify />
        </button>
      </div>
      <div
        ref={editorRef}
        className="script-rich-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        style={{ textAlign: block.align || 'left' }}
        onInput={syncEditor}
        onBlur={syncEditor}
      />
    </div>
  );
}

export function ScriptWriterPanel() {
  const [scripts, setScripts] = useState<ScriptDocument[]>(INITIAL_SCRIPTS);
  const [selectedId, setSelectedId] = useState(INITIAL_SCRIPTS[0].id);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ScriptStatus | ''>('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPlatform, setNewPlatform] = useState('TikTok');
  const [newWriter, setNewWriter] = useState('An');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Đang tải từ Supabase...');
  const [syncError, setSyncError] = useState('');
  const [syncWarning, setSyncWarning] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadScripts() {
      setSyncStatus('Đang tải từ Supabase...');
      setSyncError('');
      setSyncWarning('');
      try {
        const response = await api('/api/scripts', { timeoutMs: 30000 });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không tải được thư viện kịch bản');
        if (cancelled) return;
        const rows = Array.isArray(payload.scripts) && payload.scripts.length
          ? payload.scripts as ScriptDocument[]
          : INITIAL_SCRIPTS;
        setScripts(rows);
        setSelectedId(rows[0]?.id || '');
        setSyncWarning(typeof payload.warning === 'string' ? payload.warning : '');
        if (payload.storage === 'local') {
          setSyncStatus(
            payload.warning
              ? 'Đang chờ Supabase API cập nhật cache…'
              : payload.scripts?.length
                ? 'Đã lưu tạm trên máy chủ'
                : 'Chưa có Supabase — dùng dữ liệu mẫu',
          );
        } else {
          setSyncStatus(payload.scripts?.length ? 'Đã tải từ Supabase' : 'Đang tạo dữ liệu mẫu trên Supabase...');
        }
      } catch (error) {
        if (cancelled) return;
        setSyncError(error instanceof Error ? error.message : 'Không kết nối được Supabase');
        setSyncStatus('Chưa đồng bộ Supabase');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void loadScripts();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded || syncError) return;
    const timer = window.setTimeout(() => {
      void saveScripts(scripts, false);
    }, 900);
    return () => window.clearTimeout(timer);
    // saveScripts is intentionally driven by the latest scripts snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, scripts]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selected = scripts.find((script) => script.id === selectedId) || null;
  const facebookPost = useMemo(() => (selected ? buildFacebookPost(selected) : null), [selected]);
  const visibleScripts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi');
    return scripts.filter((script) => {
      if (filter && script.status !== filter) return false;
      return !normalized || script.title.toLocaleLowerCase('vi').includes(normalized);
    });
  }, [filter, query, scripts]);

  const wordCount = useMemo(() => {
    const text = selected?.blocks.map((block) => htmlToPlain(block.text)).join(' ').trim() || '';
    return text ? text.split(/\s+/).length : 0;
  }, [selected]);

  async function saveScripts(rows: ScriptDocument[], showNotice: boolean) {
    setSyncStatus('Đang lưu...');
    setSyncError('');
    try {
      const response = await api('/api/scripts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scripts: rows }),
        timeoutMs: 30000,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không lưu được thư viện kịch bản');
      setSyncWarning(typeof payload.warning === 'string' ? payload.warning : '');
      const savedAt = new Date().toLocaleTimeString('vi-VN');
      if (payload.storage === 'local') {
        setSyncStatus(payload.warning ? `Đã lưu tạm · chờ Supabase API · ${savedAt}` : `Đã lưu tạm trên máy chủ · ${savedAt}`);
        if (showNotice) setNotice(payload.warning ? 'Đã lưu tạm. Supabase API chưa nhận bảng — xem hướng dẫn vàng phía trên.' : 'Đã lưu tạm trên máy chủ.');
      } else {
        setSyncStatus(`Đã lưu Supabase · ${savedAt}`);
        if (showNotice) setNotice('Đã lưu kịch bản lên Supabase.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không kết nối được Supabase';
      setSyncError(message);
      setSyncStatus('Lưu Supabase thất bại');
      if (showNotice) setNotice(message);
    }
  }

  function updateSelected(updater: (script: ScriptDocument) => ScriptDocument) {
    setScripts((rows) => rows.map((script) => (script.id === selectedId ? updater(script) : script)));
  }

  function editScript(scriptId: string) {
    setSelectedId(scriptId);
    setNotice('Đang sửa kịch bản.');
  }

  function deleteScript(scriptId: string) {
    const script = scripts.find((item) => item.id === scriptId);
    if (!script) return;
    if (!window.confirm(`Xóa kịch bản "${script.title}"?`)) return;
    const next = scripts.filter((item) => item.id !== scriptId);
    setScripts(next);
    if (selectedId === scriptId) {
      setSelectedId(next[0]?.id || '');
    }
    setNotice('Đã xóa kịch bản.');
  }

  function createScript() {
    const title = newTitle.trim();
    if (!title) {
      setNotice('Nhập tiêu đề kịch bản.');
      return;
    }
    const script: ScriptDocument = {
      id: newId('script'),
      title,
      platform: newPlatform,
      status: 'draft',
      writer: newWriter,
      date: new Date().toLocaleDateString('vi-VN'),
      blocks: [{ id: newId('block'), type: 'hook', text: '' }],
    };
    setScripts((rows) => [script, ...rows]);
    setSelectedId(script.id);
    setNewTitle('');
    setShowCreate(false);
    setNotice('Đã tạo kịch bản mới.');
  }

  function addBlock(type: BlockType = 'text', afterIndex?: number, text = '') {
    updateSelected((script) => {
      const blocks = [...script.blocks];
      const index = afterIndex === undefined ? blocks.length : afterIndex + 1;
      blocks.splice(index, 0, { id: newId('block'), type, text });
      return { ...script, blocks };
    });
  }

  function updateBlock(id: string, patch: Partial<ScriptBlock>) {
    updateSelected((script) => ({
      ...script,
      blocks: script.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    }));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    updateSelected((script) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= script.blocks.length) return script;
      const blocks = [...script.blocks];
      [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
      return { ...script, blocks };
    });
  }

  function removeBlock(id: string) {
    updateSelected((script) => ({ ...script, blocks: script.blocks.filter((block) => block.id !== id) }));
  }

  function duplicateBlock(block: ScriptBlock, index: number) {
    updateSelected((script) => {
      const blocks = [...script.blocks];
      blocks.splice(index + 1, 0, { ...block, id: newId('block') });
      return { ...script, blocks };
    });
  }

  async function copyScript() {
    if (!selected) return;
    await navigator.clipboard.writeText(plainText(selected));
    setNotice('Đã copy toàn bộ kịch bản.');
  }

  function buildPrintableHtml() {
    if (!selected) return '';
    const post = facebookPost || buildFacebookPost(selected);
    const printedAt = new Date().toLocaleDateString('vi-VN');
    const bodyHtml = post.html || '<p style="color:#9CA3AF">Kịch bản chưa có nội dung.</p>';
    return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${escapeHtml(selected.title)}</title><style>
      @page { margin: 18mm; }
      body { font-family: "Segoe UI", Arial, sans-serif; max-width: 680px; margin: 36px auto; color: #1E1B4B; padding: 0 18px; }
      .head { border-bottom: 3px solid #1877F2; padding-bottom: 12px; margin-bottom: 22px; }
      .brand { font-size: 9px; color: #9CA3AF; margin-bottom: 3px; }
      h1 { font-size: 20px; font-weight: 800; margin: 0 0 4px; }
      .meta { font-size: 10px; color: #6B7280; }
      .post { font-size: 14px; line-height: 1.65; }
      .post b, .post strong { font-weight: 800; }
      .post i, .post em { font-style: italic; }
      .post u { text-decoration: underline; }
      .foot { margin-top: 36px; border-top: 1px solid #eee; padding-top: 9px; font-size: 9px; color: #ccc; text-align: center; }
    </style></head><body>
      <div class="head">
        <div class="brand">Seeding Fsolution · Bài đăng Facebook</div>
        <h1>${escapeHtml(selected.title)}</h1>
        <div class="meta">${escapeHtml(selected.writer)} · ${escapeHtml(selected.platform)} · ${escapeHtml(selected.date)}</div>
      </div>
      <div class="post">${bodyHtml}</div>
      <div class="foot">In ngày ${printedAt}</div>
    </body></html>`;
  }

  function printCompleteVersion() {
    if (!selected) {
      setNotice('Chọn kịch bản trước khi in.');
      return;
    }
    const printable = buildPrintableHtml();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDoc = iframe.contentDocument || frameWindow?.document;
    if (!frameWindow || !frameDoc) {
      iframe.remove();
      setNotice('Trình duyệt không hỗ trợ in. Thử Chrome hoặc Edge.');
      return;
    }

    const cleanup = () => {
      window.setTimeout(() => iframe.remove(), 500);
    };

    const triggerPrint = () => {
      try {
        frameWindow.focus();
        frameWindow.print();
        setNotice('Đã mở hộp thoại in.');
      } catch {
        setNotice('Không mở được hộp thoại in. Thử lại hoặc dùng Copy rồi dán vào Word.');
      } finally {
        window.setTimeout(cleanup, 60000);
      }
    };

    frameDoc.open();
    frameDoc.write(printable);
    frameDoc.close();

    if (frameWindow.document.readyState === 'complete') {
      window.setTimeout(triggerPrint, 150);
    } else {
      frameWindow.onload = () => window.setTimeout(triggerPrint, 150);
      window.setTimeout(triggerPrint, 600);
    }
  }

  async function copyFacebookPost() {
    if (!selected || !facebookPost?.hasContent) return;
    const html = `<div>${facebookPost.html}</div>`;
    const plain = facebookPost.plain;
    try {
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setNotice('Đã copy bài Facebook (giữ in đậm/nghiêng khi dán).');
    } catch {
      await navigator.clipboard.writeText(plain);
      setNotice('Đã copy nội dung bài đăng.');
    }
  }

  async function copyCompleteVersion() {
    if (!selected) return;
    await navigator.clipboard.writeText(facebookPost?.plain || buildCompleteScriptText(selected));
    setNotice('Đã copy text thuần.');
  }

  function exportScript() {
    if (!selected) return;
    const text = buildCompleteScriptText(selected);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selected.title.replace(/[^a-z0-9\p{L}]+/giu, '-').replace(/^-|-$/g, '') || 'kich-ban'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Đã xuất file .txt.');
  }

  function addAiTemplate(type: 'hook' | 'intro' | 'full' | 'cta') {
    if (!selected) return;
    const topic = selected.title || 'nội dung này';
    const templates = {
      hook: `Bạn có chắc mình đã hiểu đúng về ${topic.toLocaleLowerCase('vi')}? 30 giây tới sẽ giúp bạn tránh lỗi phổ biến nhất.`,
      intro: `Trong video này, mình sẽ chia sẻ ngắn gọn và thực tế về ${topic.toLocaleLowerCase('vi')}, kèm ví dụ để bạn có thể áp dụng ngay.`,
      full: `Bắt đầu bằng vấn đề khách hàng thường gặp.\n\nGiải thích nguyên nhân bằng ngôn ngữ đơn giản.\n\nĐưa ra 3 bước xử lý cụ thể và minh họa trực quan.`,
      cta: 'Theo dõi Seeding Fsolution để nhận thêm kịch bản và mẹo triển khai nội dung hiệu quả mỗi ngày.',
    };
    const blockType: BlockType = type === 'intro' || type === 'full' ? 'body' : type;
    addBlock(blockType, undefined, templates[type]);
    setNotice('Đã chèn gợi ý vào kịch bản.');
  }

  return (
    <section className="script-studio" aria-label="Trình soạn kịch bản">
      {syncWarning ? (
        <div className="script-sync-warning" role="status">{syncWarning}</div>
      ) : null}
      <div className="script-studio-body">
      <aside className="script-library">
        <div className="script-library-head">
          <div>
            <span>Content Studio v3</span>
            <h2>Kịch bản</h2>
          </div>
          <button type="button" className="script-primary compact" onClick={() => setShowCreate(true)}>
            <Plus /> Mới
          </button>
        </div>
        <div className="script-library-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kịch bản..." />
          <select value={filter} onChange={(event) => setFilter(event.target.value as ScriptStatus | '')}>
            <option value="">Tất cả trạng thái</option>
            <option value="draft">Nháp</option>
            <option value="pending">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
          </select>
        </div>
        <div className="script-library-list">
          {visibleScripts.map((script) => (
            <div
              key={script.id}
              className={`script-list-item${selectedId === script.id ? ' active' : ''}`}
            >
              <button
                type="button"
                className="script-list-body"
                onClick={() => editScript(script.id)}
              >
                <strong>{script.title}</strong>
                <span>{script.platform}</span>
                <div>
                  <small>✍ {script.writer}</small>
                  <em className={`script-status ${script.status}`}>{STATUS_LABELS[script.status]}</em>
                </div>
              </button>
              <div className="script-list-actions">
                <button type="button" className="script-list-edit" title="Sửa kịch bản" onClick={() => editScript(script.id)}>
                  <Pencil /> Sửa
                </button>
                <button type="button" className="script-list-delete" title="Xóa kịch bản" onClick={() => deleteScript(script.id)}>
                  <Trash2 /> Xóa
                </button>
              </div>
            </div>
          ))}
          {!visibleScripts.length ? <div className="script-empty-list">Không tìm thấy kịch bản.</div> : null}
        </div>
      </aside>

      <div className="script-editor">
        {selected ? (
          <>
            <div className="script-editor-bar">
              <input
                className="script-title-input"
                value={selected.title}
                onChange={(event) => updateSelected((script) => ({ ...script, title: event.target.value }))}
                placeholder="Tiêu đề kịch bản..."
              />
              <select value={selected.platform} onChange={(event) => updateSelected((script) => ({ ...script, platform: event.target.value }))}>
                <option>TikTok</option>
                <option>YouTube</option>
                <option>Reels</option>
                <option>Facebook</option>
              </select>
              <select value={selected.status} onChange={(event) => updateSelected((script) => ({ ...script, status: event.target.value as ScriptStatus }))}>
                <option value="draft">Nháp</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
              </select>
              <button type="button" className="script-save" onClick={() => void saveScripts(scripts, true)}><Save /> Lưu</button>
              <button type="button" className="script-icon-button" title="Gửi duyệt" onClick={() => { updateSelected((script) => ({ ...script, status: 'pending' })); setNotice('Đã chuyển sang chờ duyệt.'); }}><Send /></button>
              <button type="button" className="script-icon-button" title="In kịch bản" onClick={printCompleteVersion}><Printer /></button>
              <button type="button" className={`script-icon-button${showAi ? ' active' : ''}`} title="Trợ lý AI" onClick={() => setShowAi((value) => !value)}><Bot /></button>
            </div>
            <div className="script-editor-meta">
              <span>{wordCount} từ</span>
              <span>{selected.blocks.length} blocks</span>
              <span className={syncError ? 'script-sync-error' : ''} title={syncError || syncWarning}>{syncError || syncStatus}</span>
              <div className="script-editor-copy">
                <button type="button" onClick={() => void copyScript()}><Clipboard /> Copy</button>
                <button type="button" onClick={() => { setScripts((rows) => rows.filter((script) => script.id !== selected.id)); setSelectedId(scripts.find((script) => script.id !== selected.id)?.id || ''); }}><Trash2 /> Xóa</button>
              </div>
            </div>

            <div className="script-block-list">
              {selected.blocks.map((block, index) => {
                const definition = BLOCK_TYPES.find((item) => item.id === block.type) || BLOCK_TYPES[0];
                return (
                  <div className={`script-block block-${block.type}`} key={block.id}>
                    <GripVertical className="script-drag" />
                    <select className="script-block-type" value={block.type} onChange={(event) => updateBlock(block.id, { type: event.target.value as BlockType })}>
                      {BLOCK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <ScriptBlockEditor
                      block={block}
                      placeholder={definition.placeholder}
                      onChange={(patch) => updateBlock(block.id, patch)}
                    />
                    <div className="script-block-actions">
                      <button type="button" title="Lên" disabled={index === 0} onClick={() => moveBlock(index, -1)}><ChevronUp /></button>
                      <button type="button" title="Xuống" disabled={index === selected.blocks.length - 1} onClick={() => moveBlock(index, 1)}><ChevronDown /></button>
                      <button type="button" title="Nhân bản" onClick={() => duplicateBlock(block, index)}><Copy /></button>
                      <button type="button" title="Xóa block" onClick={() => removeBlock(block.id)}><X /></button>
                    </div>
                  </div>
                );
              })}
              <div className="script-add-row">
                <span />
                <button type="button" onClick={() => addBlock('text')}><Plus /> Thêm block</button>
                <span />
              </div>
              {!selected.blocks.length ? (
                <div className="script-empty-editor">
                  <Sparkles />
                  <h3>Kịch bản đang trống</h3>
                  <p>Thêm Hook hoặc Text để bắt đầu.</p>
                  <div><button type="button" className="script-primary" onClick={() => addBlock('hook')}>⚡ Hook</button><button type="button" onClick={() => addBlock('text')}>📝 Text</button></div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="script-empty-editor full"><Sparkles /><h3>Chọn hoặc tạo kịch bản mới</h3></div>
        )}
      </div>

      <div className="script-right-rail">
        <aside className="script-preview-panel" aria-label="Xem trước bài Facebook">
          <div className="script-preview-head">
            <div>
              <span>Review</span>
              <strong>Bài Facebook</strong>
            </div>
          </div>
          {selected && facebookPost ? (
            <>
              <div className="script-preview-actions">
                <button type="button" className="script-primary compact" onClick={() => void copyFacebookPost()} disabled={!facebookPost.hasContent}>
                  <Clipboard /> Copy FB
                </button>
                <button type="button" onClick={printCompleteVersion} title="In kịch bản"><Printer /></button>
                <button type="button" onClick={() => void copyCompleteVersion()} disabled={!facebookPost.hasContent} title="Copy text"><Copy /></button>
                <button type="button" onClick={exportScript} title="Xuất .txt"><FileDown /></button>
              </div>
              <ScriptFacebookPreview script={selected} postHtml={facebookPost.html} hasContent={facebookPost.hasContent} />
            </>
          ) : (
            <div className="script-preview-empty">
              <Sparkles />
              <p>Chọn kịch bản để xem trước bài đăng Facebook.</p>
            </div>
          )}
        </aside>

        {showAi ? (
          <aside className="script-ai-panel script-ai-overlay">
            <div className="script-ai-head"><div><Bot /><strong>Trợ lý AI</strong></div><button type="button" onClick={() => setShowAi(false)}><X /></button></div>
            <p>Chèn nhanh cấu trúc nội dung theo phong cách Content Studio v3.</p>
            <div className="script-ai-templates">
              <button type="button" onClick={() => addAiTemplate('hook')}>⚡ Viết Hook</button>
              <button type="button" onClick={() => addAiTemplate('intro')}>🎬 Mở đầu</button>
              <button type="button" onClick={() => addAiTemplate('full')}>📄 Dàn ý đầy đủ</button>
              <button type="button" onClick={() => addAiTemplate('cta')}>🔔 Viết CTA</button>
            </div>
            <div className="script-ai-message"><Sparkles /><span>Chọn một mẫu để tạo block mới dựa trên tiêu đề kịch bản hiện tại.</span></div>
          </aside>
        ) : null}
      </div>
      </div>

      {showCreate ? (
        <div className="script-modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <div className="script-modal" role="dialog" aria-modal="true" aria-labelledby="new-script-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="script-modal-head"><div><span>Content Studio v3</span><h3 id="new-script-title">Kịch bản mới</h3></div><button type="button" onClick={() => setShowCreate(false)}><X /></button></div>
            <label>Tiêu đề<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="VD: Review đàn guitar acoustic 3 triệu" onKeyDown={(event) => { if (event.key === 'Enter') createScript(); }} /></label>
            <div className="script-modal-grid">
              <label>Nền tảng<select value={newPlatform} onChange={(event) => setNewPlatform(event.target.value)}><option>TikTok</option><option>YouTube</option><option>Reels</option><option>Facebook</option></select></label>
              <label>Người viết<select value={newWriter} onChange={(event) => setNewWriter(event.target.value)}><option>An</option><option>Bình</option><option>Chi</option><option>Dung</option></select></label>
            </div>
            <div className="script-modal-actions"><button type="button" onClick={() => setShowCreate(false)}>Hủy</button><button type="button" className="script-primary" onClick={createScript}><Plus /> Tạo</button></div>
          </div>
        </div>
      ) : null}

      {notice ? <div className="script-toast"><Check /> {notice}</div> : null}
    </section>
  );
}
