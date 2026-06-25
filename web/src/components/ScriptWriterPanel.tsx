'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AtSign,
  Bot,
  Bold,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  FileDown,
  GripVertical,
  Image as ImageIcon,
  Italic,
  Maximize2,
  MessageSquare,
  Plus,
  Printer,
  Pencil,
  RefreshCw,
  Save,
  SendHorizontal,
  Sparkles,
  Trash2,
  Underline,
  Wand2,
  X,
} from 'lucide-react';
import { AI_TIMEOUT_MS, api, getApiBase } from '@/lib/api';
import { viewToPath } from '@/lib/app-routes';
import { BusinessProfilePanel } from '@/components/BusinessProfilePanel';
import { SettingsFormModal } from '@/components/SettingsFormModal';
import { SettingsSectionCard } from '@/components/SettingsSectionCard';
import './script-writer-panel.css';
import './script-writer-panel-v3.css';

type ScriptStatus = 'draft' | 'pending' | 'approved';
type BlockType = 'text' | 'h1' | 'h2' | 'hook' | 'body' | 'cta' | 'scene' | 'quote' | 'image';
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
  plan_task_id?: string;
  plan_task_title?: string;
};

type SectionKey = 'opening' | 'body' | 'ending';

type ScriptSection = {
  id: SectionKey;
  label: string;
  blockType: BlockType;
  emptyText: string;
};

type ContentTechnique = {
  id: string;
  name: string;
  content: string;
  system?: boolean;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'ai';
  text: string;
};

type ScriptAiResult = {
  reply?: string;
  target_section?: SectionKey | 'all' | 'none';
  action?: 'replace' | 'append' | 'none';
  image_prompt?: string;
  sections?: Partial<Record<SectionKey, string>>;
};

type AiModelOption = {
  id: string;
  name?: string;
  display_name?: string;
  description?: string;
};

type AiConfig = {
  provider?: string;
  model?: string;
  customer_name?: string;
  keys_masked?: Record<string, string>;
  storage?: string;
  warning?: string;
};

const BLOCK_TYPES: Array<{ id: BlockType; label: string; icon: string; placeholder: string }> = [
  { id: 'text', label: 'TỰ VIẾT', icon: '📝', placeholder: 'Nhập nội dung của bạn tại đây...' },
  { id: 'h1', label: 'TIÊU ĐỀ LỚN', icon: '🔠', placeholder: 'Tiêu đề lớn...' },
  { id: 'h2', label: 'TIÊU ĐỀ PHỤ', icon: '🔡', placeholder: 'Đề mục / tiêu đề phụ...' },
  { id: 'hook', label: 'HOOK', icon: '⚡', placeholder: 'Hook thu hút 3 giây đầu...' },
  { id: 'body', label: 'BODY', icon: '📄', placeholder: 'Nội dung chính...' },
  { id: 'cta', label: 'CTA', icon: '🔔', placeholder: 'Kêu gọi hành động...' },
  { id: 'scene', label: 'SCREEN', icon: '🎬', placeholder: '[Cảnh quay / góc máy]...' },
  { id: 'quote', label: 'TRÍCH DẪN', icon: '💬', placeholder: 'Trích dẫn...' },
  { id: 'image', label: 'ẢNH', icon: '🖼️', placeholder: 'URL ảnh đã tạo/đính kèm...' },
];

const BLOCK_V3_META: Record<BlockType, { label: string; tone: 'hook' | 'intro' | 'cta' | 'custom' }> = {
  hook: { label: 'HOOK', tone: 'hook' },
  h1: { label: 'TIÊU ĐỀ LỚN', tone: 'intro' },
  h2: { label: 'TIÊU ĐỀ PHỤ', tone: 'intro' },
  body: { label: 'BODY', tone: 'intro' },
  scene: { label: 'SCREEN', tone: 'intro' },
  cta: { label: 'CTA', tone: 'cta' },
  image: { label: 'ẢNH', tone: 'custom' },
  text: { label: 'TỰ VIẾT', tone: 'custom' },
  quote: { label: 'TRÍCH DẪN', tone: 'custom' },
};

type AiStudioTab = 'quick' | 'hook' | 'chat' | 'settings';
type SetupSectionKey = SectionKey;

type ContentStudioSetup = {
  sections: Record<SetupSectionKey, {
    label: string;
    name: string;
    description: string;
    rule: string;
  }>;
};

const AI_STUDIO_TABS: Array<{ id: AiStudioTab; label: string }> = [
  { id: 'quick', label: 'Viết nhanh' },
  { id: 'hook', label: 'Hook/Ý tưởng' },
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Cài đặt' },
];

const SCRIPT_SECTIONS: ScriptSection[] = [
  { id: 'opening', label: 'HOOK', blockType: 'hook', emptyText: 'Chưa có hook' },
  { id: 'body', label: 'BODY', blockType: 'body', emptyText: 'Chưa có body' },
  { id: 'ending', label: 'CTA', blockType: 'cta', emptyText: 'Chưa có CTA' },
];

const SECTION_BLOCK_TYPES: Record<SectionKey, BlockType[]> = {
  opening: ['hook', 'h1', 'h2'],
  body: ['body', 'text', 'scene', 'quote', 'image'],
  ending: ['cta'],
};

const SECTION_LABELS: Record<SectionKey, string> = {
  opening: 'HOOK',
  body: 'BODY',
  ending: 'CTA',
};

const SECTION_ORDER: SetupSectionKey[] = ['opening', 'body', 'ending'];

function defaultContentStudioSetup(): ContentStudioSetup {
  return {
    sections: {
      opening: {
        label: 'HOOK',
        name: 'Hook',
        description: 'Tối đa 3 dòng',
        rule: 'Hook phải thu hút, rõ chủ đề và tối đa 3 dòng.',
      },
      body: {
        label: 'BODY',
        name: 'Body',
        description: 'Rõ ý chính',
        rule: 'Triển khai nội dung chính mạch lạc, dễ hiểu, bám đúng sản phẩm và khách hàng.',
      },
      ending: {
        label: 'CTA',
        name: 'CTA',
        description: 'Chốt hành động',
        rule: 'CTA phải tự nhiên, không bịa ưu đãi hoặc cam kết.',
      },
    },
  };
}

function limitWords(value: string, maxWords: number) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

const STATUS_LABELS: Record<ScriptStatus, string> = {
  draft: 'Nháp',
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
};

const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-3.1-pro-preview',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
};

const MODEL_FALLBACKS: Record<string, AiModelOption[]> = {
  gemini: [
    { id: 'gemini-3.1-pro-preview', display_name: 'Gemini Pro 3.1 Preview' },
    { id: 'gemini-2.5-pro', display_name: 'Gemini Pro 2.5' },
    { id: 'gemini-3.5-flash', display_name: 'Gemini 3.5 Flash' },
    { id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash' },
  ],
  openai: [
    { id: 'gpt-4o-mini', display_name: 'ChatGPT / GPT-4o mini' },
    { id: 'gpt-4o', display_name: 'ChatGPT / GPT-4o' },
    { id: 'gpt-4.1-mini', display_name: 'GPT-4.1 mini' },
    { id: 'gpt-4.1', display_name: 'GPT-4.1' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', display_name: 'Groq Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-8b-instant', display_name: 'Groq Llama 3.1 8B Instant' },
    { id: 'openai/gpt-oss-120b', display_name: 'Groq GPT OSS 120B' },
    { id: 'openai/gpt-oss-20b', display_name: 'Groq GPT OSS 20B' },
  ],
};

function fallbackModels(provider: string) {
  return MODEL_FALLBACKS[provider] || MODEL_FALLBACKS.gemini;
}

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

function limitOpeningLines(text: string) {
  return text.replace(/\r\n/g, '\n').split('\n').slice(0, 3).join('\n').trim();
}

function sectionForBlock(type: BlockType): SectionKey {
  if (SECTION_BLOCK_TYPES.opening.includes(type)) return 'opening';
  if (SECTION_BLOCK_TYPES.ending.includes(type)) return 'ending';
  return 'body';
}

function sectionBlocks(script: ScriptDocument | null, section: SectionKey) {
  if (!script) return [];
  const allowed = SECTION_BLOCK_TYPES[section];
  return script.blocks.filter((block) => allowed.includes(block.type));
}

function sectionText(script: ScriptDocument | null, section: SectionKey) {
  return sectionBlocks(script, section)
    .map((block) => htmlToPlain(block.text))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function scriptSectionPayload(script: ScriptDocument | null): Record<SectionKey, string> {
  return {
    opening: sectionText(script, 'opening'),
    body: sectionText(script, 'body'),
    ending: sectionText(script, 'ending'),
  };
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
    if (block.type === 'image') {
      lines.push(`【${type?.label || 'ẢNH'}】`, text, '');
      return;
    }
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
  const mediaUrls: string[] = [];

  script.blocks.forEach((block) => {
    const plain = htmlToPlain(block.text).trim();
    if (!plain) return;
    if (block.type === 'image') {
      mediaUrls.push(plain);
      return;
    }
    plainParts.push(plain);
    const inner = blockContentHtml(block.text);
    const style = `${FB_BLOCK_STYLES[block.type] || FB_BLOCK_STYLES.text || ''}${blockAlignStyle(block.align)}`;
    htmlParts.push(`<p class="script-fb-para script-fb-${block.type}" style="margin:0 0 12px;${style}">${inner}</p>`);
  });

  return {
    html: htmlParts.join(''),
    plain: plainParts.join('\n\n').trim(),
    mediaUrls,
    hasContent: plainParts.length > 0,
  };
}

type ScriptFacebookPreviewProps = {
  script: ScriptDocument;
  postHtml: string;
  hasContent: boolean;
  mediaUrls?: string[];
};

function ScriptFacebookPreview({ script, postHtml, hasContent, mediaUrls = [] }: ScriptFacebookPreviewProps) {
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
          {mediaUrls.length ? (
            <div className="script-fb-media-grid">
              {mediaUrls.slice(0, 4).map((url) => (
                <img key={url} src={url} alt="Ảnh đính kèm bài viết" />
              ))}
            </div>
          ) : null}
          <div className="script-fb-post-foot">
            <div className="script-fb-reactions" aria-hidden="true">
              <span>👍</span><span>❤️</span><span>😮</span>
              <small>Thích · Bình luận · Chia sẻ</small>
            </div>
            <p className="script-fb-post-note">{mediaUrls.length ? `${mediaUrls.length} ảnh đã sẵn sàng đính kèm.` : 'Khi đăng lên Facebook, thêm ảnh/video phù hợp với kịch bản.'}</p>
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
  onBlurSave?: () => void;
  minimal?: boolean;
};

function ScriptBlockEditor({ block, placeholder, onChange, onBlurSave, minimal = false }: ScriptBlockEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const mountedBlockId = useRef('');

  useEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    if (mountedBlockId.current !== block.id || (document.activeElement !== node && node.innerHTML !== (block.text || ''))) {
      node.innerHTML = block.text || '';
      mountedBlockId.current = block.id;
    }
  }, [block.id, block.text]);

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

  if (block.type === 'image') {
    const imageUrl = htmlToPlain(block.text).trim();
    return (
      <div className={`script-block-editor${minimal ? ' minimal' : ''}`}>
        <div className="script-image-block-preview">
          {imageUrl ? <img src={imageUrl} alt="Ảnh đính kèm" /> : <div>Chưa có URL ảnh</div>}
        </div>
        <input
          className="script-image-url-input"
          value={imageUrl}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder={placeholder}
        />
      </div>
    );
  }

  return (
    <div className={`script-block-editor${minimal ? ' minimal' : ''}`}>
      {!minimal ? (
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
          <button type="button" className="script-font-size-button" title="Chữ nhỏ" onMouseDown={(event) => handleFormatMouseDown(event, 'fontSize', '2')}>
            A−
          </button>
          <button type="button" className="script-font-size-button" title="Chữ thường" onMouseDown={(event) => handleFormatMouseDown(event, 'fontSize', '3')}>
            A
          </button>
          <button type="button" className="script-font-size-button" title="Chữ lớn" onMouseDown={(event) => handleFormatMouseDown(event, 'fontSize', '5')}>
            A+
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
      ) : null}
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
        onBlur={() => {
          syncEditor();
          onBlurSave?.();
        }}
      />
    </div>
  );
}

export function ScriptWriterPanel() {
  const router = useRouter();
  const [scripts, setScripts] = useState<ScriptDocument[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ScriptStatus | ''>('');
  const [showCreate, setShowCreate] = useState(false);
  const [showAi, setShowAi] = useState(true);
  const [showFbPreview, setShowFbPreview] = useState(false);
  const [aiTab, setAiTab] = useState<AiStudioTab>('quick');
  const [newTitle, setNewTitle] = useState('');
  const [newPlatform, setNewPlatform] = useState('TikTok');
  const [newWriter, setNewWriter] = useState('An');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Đang tải từ Supabase...');
  const [syncError, setSyncError] = useState('');
  const [syncWarning, setSyncWarning] = useState('');
  const [activeSection, setActiveSection] = useState<SectionKey>('opening');
  const [techniques, setTechniques] = useState<ContentTechnique[]>([]);
  const [techniqueName, setTechniqueName] = useState('');
  const [techniqueContent, setTechniqueContent] = useState('');
  const [techniqueStatus, setTechniqueStatus] = useState('');
  const [techniqueBusy, setTechniqueBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'ai',
      text: 'Chọn HOOK, BODY hoặc CTA ở bên trái rồi nhập yêu cầu. Gõ @ để gọi kỹ thuật content đã lưu.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState<ScriptAiResult | null>(null);
  const [selectedTechniqueIds, setSelectedTechniqueIds] = useState<string[]>([]);
  const [aiProvider, setAiProvider] = useState('gemini');
  const [aiModel, setAiModel] = useState(DEFAULT_MODELS.gemini);
  const [aiModels, setAiModels] = useState<AiModelOption[]>(MODEL_FALLBACKS.gemini);
  const [aiCustomerName, setAiCustomerName] = useState('');
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiKeyMasked, setAiKeyMasked] = useState('');
  const [aiConfigStatus, setAiConfigStatus] = useState('');
  const [aiConfigBusy, setAiConfigBusy] = useState(false);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [studioSetup, setStudioSetup] = useState<ContentStudioSetup>(defaultContentStudioSetup);
  const [setupStatus, setSetupStatus] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const [settingsModal, setSettingsModal] = useState<'prompt' | 'ai' | 'techniques' | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [publishTargetType, setPublishTargetType] = useState<'group' | 'page'>('group');
  const [publishTargetId, setPublishTargetId] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const userEditedRef = useRef(false);
  const skipNextAutosaveRef = useRef(false);
  const scriptsRef = useRef(scripts);
  const saveTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const loadSeqRef = useRef(0);
  scriptsRef.current = scripts;

  function flushSaveKeepalive(rows: ScriptDocument[]) {
    if (typeof window === 'undefined' || !rows.length) return;
    const url = `${getApiBase()}/api/scripts`;
    void fetch(url, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scripts: rows, full_documents: true }),
      keepalive: true,
    });
  }

  function queueSave(showNotice = false, immediate = false) {
    if (!loaded || !detailsLoaded) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    dirtyRef.current = true;
    const run = () => {
      dirtyRef.current = false;
      void saveScripts(scriptsRef.current, showNotice);
    };
    const delay = immediate ? 80 : 500;
    saveTimerRef.current = window.setTimeout(run, delay);
  }

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;

    function scriptIdFromUrl() {
      return typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('script')?.trim() || ''
        : '';
    }

    function applyScriptRows(rows: ScriptDocument[], payload: { warning?: string; storage?: string; scripts?: unknown[] }) {
      if (userEditedRef.current) return;
      const preferred = rows.find((script) => script.id === scriptIdFromUrl());
      skipNextAutosaveRef.current = true;
      setScripts(rows);
      setSelectedId((current) => (rows.some((script) => script.id === current) ? current : preferred?.id || rows[0]?.id || ''));
      setSyncWarning(typeof payload.warning === 'string' ? payload.warning : '');
      if (payload.storage === 'local') {
        setSyncStatus(
          payload.warning
            ? 'Đang chờ Supabase API cập nhật cache…'
            : rows.length
              ? `Đã lưu tạm trên máy chủ · ${rows.length} kịch bản`
              : 'Chưa có kịch bản — bấm + để tạo mới',
        );
      } else {
        setSyncStatus(rows.length ? `Đã tải ${rows.length} kịch bản từ Supabase` : 'Chưa có kịch bản — bấm + để tạo mới');
      }
    }

    async function loadScripts() {
      setSyncStatus('Đang tải từ Supabase...');
      setSyncError('');
      setSyncWarning('');
      try {
        const liteResponse = await api('/api/scripts?lite=1', { timeoutMs: 30000 });
        const litePayload = await liteResponse.json().catch(() => ({}));
        if (isStale()) return;
        if (!liteResponse.ok || !litePayload.ok) {
          throw new Error(litePayload.error || 'Không tải được thư viện kịch bản');
        }
        const liteRows = Array.isArray(litePayload.scripts) ? litePayload.scripts as ScriptDocument[] : [];
        applyScriptRows(liteRows, litePayload);

        setSyncStatus(liteRows.length ? 'Đang tải nội dung chi tiết...' : 'Chưa có kịch bản — bấm + để tạo mới');
        const response = await api('/api/scripts', { timeoutMs: 60000 });
        const payload = await response.json().catch(() => ({}));
        if (isStale() || userEditedRef.current) return;
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không tải được nội dung kịch bản');
        const rows = Array.isArray(payload.scripts) ? payload.scripts as ScriptDocument[] : [];
        applyScriptRows(rows, payload);
        setDetailsLoaded(true);
      } catch (error) {
        if (isStale()) return;
        setSyncError(error instanceof Error ? error.message : 'Không kết nối được Supabase');
        setSyncStatus('Chưa đồng bộ Supabase');
      } finally {
        if (!isStale()) setLoaded(true);
      }
    }
    void loadScripts();
    return () => { loadSeqRef.current += 1; };
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === 'undefined') return;
    const scriptId = new URLSearchParams(window.location.search).get('script')?.trim();
    if (!scriptId) return;
    if (scripts.some((script) => script.id === scriptId)) {
      setSelectedId(scriptId);
    }
  }, [loaded, scripts]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      void loadTechniques();
      void loadAiConfig();
      void loadStudioSetup();
    }, 0);
    return () => window.clearTimeout(timer);
    // Defer AI settings bootstrap until scripts are on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    queueSave(false, false);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
    // queueSave is intentionally driven by the latest scripts snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, scripts]);

  useEffect(() => {
    if (!loaded) return;
    const onPageHide = () => {
      if (dirtyRef.current) flushSaveKeepalive(scriptsRef.current);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (dirtyRef.current) flushSaveKeepalive(scriptsRef.current);
    };
  }, [loaded]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selected = detailsLoaded ? scripts.find((script) => script.id === selectedId) || null : null;
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

  const mentionMatch = useMemo(() => {
    const matches = Array.from(chatInput.matchAll(/@([^\s@]*)/g));
    const match = matches[matches.length - 1];
    return match ? match[1].toLocaleLowerCase('vi') : '';
  }, [chatInput]);

  const mentionOpen = /@([^\s@]*)/.test(chatInput);
  const mentionSuggestions = useMemo(() => {
    if (!mentionOpen) return [];
    return techniques
      .filter((item) => item.name.toLocaleLowerCase('vi').includes(mentionMatch))
      .slice(0, 6);
  }, [mentionMatch, mentionOpen, techniques]);

  async function saveScripts(rows: ScriptDocument[], showNotice: boolean) {
    setSyncStatus('Đang lưu...');
    setSyncError('');
    try {
      const response = await api('/api/scripts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scripts: rows, full_documents: true }),
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
        setSyncStatus(`Đã lưu Supabase · ${rows.length} kịch bản · ${savedAt}`);
        if (showNotice) setNotice(`Đã lưu ${rows.length} kịch bản lên Supabase.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không kết nối được Supabase';
      setSyncError(message);
      setSyncStatus('Lưu Supabase thất bại');
      if (showNotice) setNotice(message);
    }
  }

  async function loadTechniques() {
    setTechniqueStatus('Đang tải kỹ thuật...');
    try {
      const response = await api('/api/content-techniques', { timeoutMs: 30000 });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không tải được kỹ thuật content');
      setTechniques(Array.isArray(payload.techniques) ? payload.techniques : []);
      setTechniqueStatus(
        payload.warning
        || (payload.seeded ? 'Đã tự thêm kỹ thuật marketing mặc định cho khách.' : ''),
      );
    } catch (error) {
      setTechniqueStatus(error instanceof Error ? error.message : 'Không tải được kỹ thuật content');
    }
  }

  async function loadAiModels(provider = aiProvider) {
    if (provider === 'openai') {
      setAiModels(MODEL_FALLBACKS.openai);
      return;
    }
    try {
      const query = provider === 'groq' ? '?provider=groq' : '';
      const response = await api(`/api/ai/models${query}`, { timeoutMs: 45000 });
      const payload = await response.json().catch(() => ({}));
      const rows = Array.isArray(payload.models) && payload.models.length ? payload.models : fallbackModels(provider);
      setAiModels(rows);
      if (payload.warning) setAiConfigStatus(payload.warning);
    } catch {
      setAiModels(fallbackModels(provider));
    }
  }

  async function loadAiConfig() {
    setAiConfigStatus('Đang tải cấu hình AI...');
    try {
      const response = await api('/api/ai/config', { timeoutMs: 30000 });
      const cfg: AiConfig = await response.json().catch(() => ({}));
      const provider = cfg.provider === 'openai' || cfg.provider === 'groq' ? cfg.provider : 'gemini';
      const model = cfg.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini;
      setAiProvider(provider);
      setAiModel(model);
      setAiCustomerName(cfg.customer_name || '');
      setAiKeyMasked((cfg.keys_masked || {})[provider] || '');
      setAiConfigStatus(cfg.warning || (cfg.storage === 'supabase' ? 'Đã nạp cấu hình AI theo user.' : ''));
      setAiModels(fallbackModels(provider));
      void loadAiModels(provider);
    } catch {
      setAiConfigStatus('Không tải được cấu hình AI.');
    }
  }

  async function saveAiConfig() {
    setAiConfigBusy(true);
    setAiConfigStatus('Đang lưu cấu hình AI...');
    try {
      const body: Record<string, string> = {
        provider: aiProvider,
        model: aiModel || DEFAULT_MODELS[aiProvider] || DEFAULT_MODELS.gemini,
        customer_name: aiCustomerName,
      };
      if (aiKeyInput.trim()) body.key = aiKeyInput.trim();
      const response = await api('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 30000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không lưu được cấu hình AI');
      setAiKeyInput('');
      await loadAiConfig();
      setAiConfigStatus(payload.warning || (payload.storage === 'supabase' ? 'Đã lưu AI key/model theo user.' : 'Đã lưu cấu hình AI.'));
    } catch (error) {
      setAiConfigStatus(error instanceof Error ? error.message : 'Không lưu được cấu hình AI');
    } finally {
      setAiConfigBusy(false);
    }
  }

  async function testAiConfig() {
    setAiConfigBusy(true);
    setAiConfigStatus('Đang test AI...');
    try {
      const body: Record<string, string> = {
        provider: aiProvider,
        model: aiModel || DEFAULT_MODELS[aiProvider] || DEFAULT_MODELS.gemini,
      };
      if (aiKeyInput.trim()) body.key = aiKeyInput.trim();
      const response = await api('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 45000,
      });
      const payload = await response.json().catch(() => ({}));
      const providerLabel = payload.provider === 'openai' ? 'OpenAI/ChatGPT' : payload.provider === 'groq' ? 'Groq' : 'Gemini';
      setAiConfigStatus(payload.ok ? `Kết nối ${providerLabel} OK (${payload.model || body.model}).` : (payload.error || 'AI chưa kết nối được.'));
    } catch {
      setAiConfigStatus('Không gọi được backend để test AI.');
    } finally {
      setAiConfigBusy(false);
    }
  }

  async function saveCurrentWithStatus(status: ScriptStatus, message: string) {
    if (!selected) return;
    const nextRows = scripts.map((script) => (script.id === selected.id ? { ...script, status } : script));
    setScripts(nextRows);
    await saveScripts(nextRows, false);
    setNotice(message);
  }

  async function loadStudioSetup() {
    setSetupStatus('Đang tải cài đặt...');
    try {
      const response = await api('/api/content-studio/setup', { timeoutMs: 30000 });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không tải được cài đặt');
      setStudioSetup({ ...defaultContentStudioSetup(), ...(payload.setup || {}) });
      setSetupStatus(payload.warning || (payload.storage === 'supabase' ? 'Đã nạp cài đặt từ Supabase.' : ''));
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : 'Không tải được cài đặt');
    }
  }

  function updateSetupSection(section: SetupSectionKey, field: 'name' | 'description' | 'rule', value: string) {
    const nextValue =
      field === 'description'
        ? limitWords(value, 3)
        : field === 'rule' && section === 'opening'
          ? limitOpeningLines(value)
          : value;
    setStudioSetup((current) => ({
      sections: {
        ...current.sections,
        [section]: {
          ...current.sections[section],
          [field]: nextValue,
        },
      },
    }));
  }

  async function saveStudioSetup() {
    setSetupBusy(true);
    setSetupStatus('Đang lưu cài đặt...');
    try {
      const response = await api('/api/content-studio/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: studioSetup }),
        timeoutMs: 30000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không lưu được cài đặt');
      setStudioSetup({ ...defaultContentStudioSetup(), ...(payload.setup || studioSetup) });
      setSetupStatus(payload.warning || (payload.storage === 'supabase' ? 'Đã lưu cài đặt vào Supabase.' : 'Đã lưu cài đặt.'));
    } catch (error) {
      setSetupStatus(error instanceof Error ? error.message : 'Không lưu được cài đặt');
    } finally {
      setSetupBusy(false);
    }
  }

  async function addTechnique() {
    const name = techniqueName.trim();
    const content = techniqueContent.trim();
    if (!name || !content) {
      setTechniqueStatus('Nhập đủ Tên kỹ thuật và Nội dung.');
      return;
    }
    setTechniqueBusy(true);
    setTechniqueStatus('Đang lưu kỹ thuật...');
    try {
      const response = await api('/api/content-techniques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
        timeoutMs: 30000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không lưu được kỹ thuật');
      setTechniques(Array.isArray(payload.techniques) ? payload.techniques : []);
      setTechniqueName('');
      setTechniqueContent('');
      setTechniqueStatus(payload.warning || 'Đã lưu kỹ thuật vào database.');
    } catch (error) {
      setTechniqueStatus(error instanceof Error ? error.message : 'Không lưu được kỹ thuật');
    } finally {
      setTechniqueBusy(false);
    }
  }

  async function deleteTechnique(techniqueId: string) {
    if (!window.confirm('Xóa kỹ thuật content này?')) return;
    setTechniqueBusy(true);
    try {
      const response = await api(`/api/content-techniques/${encodeURIComponent(techniqueId)}`, {
        method: 'DELETE',
        timeoutMs: 30000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không xóa được kỹ thuật');
      setTechniques(Array.isArray(payload.techniques) ? payload.techniques : []);
      setSelectedTechniqueIds((ids) => ids.filter((id) => id !== techniqueId));
      setTechniqueStatus(payload.warning || 'Đã xóa kỹ thuật.');
    } catch (error) {
      setTechniqueStatus(error instanceof Error ? error.message : 'Không xóa được kỹ thuật');
    } finally {
      setTechniqueBusy(false);
    }
  }

  function selectMentionTechnique(technique: ContentTechnique) {
    setChatInput((value) => {
      const matches = Array.from(value.matchAll(/@([^\s@]*)/g));
      const match = matches[matches.length - 1];
      if (!match || typeof match.index !== 'number') return `${value}@${technique.name} `;
      const start = match.index;
      const end = start + match[0].length;
      const suffix = value.slice(end);
      const spacer = suffix.startsWith(' ') || !suffix ? '' : ' ';
      return `${value.slice(0, start)}@${technique.name}${spacer}${suffix}`;
    });
    setSelectedTechniqueIds((ids) => (ids.includes(technique.id) ? ids : [...ids, technique.id]));
  }

  function updateSelected(updater: (script: ScriptDocument) => ScriptDocument) {
    if (!detailsLoaded) return;
    userEditedRef.current = true;
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
    userEditedRef.current = true;
    const next = scripts.filter((item) => item.id !== scriptId);
    setScripts(next);
    if (selectedId === scriptId) {
      setSelectedId(next[0]?.id || '');
    }
    setNotice('Đã xóa kịch bản — đang lưu Supabase...');
    skipNextAutosaveRef.current = true;
    void saveScripts(next, true);
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
    userEditedRef.current = true;
    const nextScripts = [script, ...scripts];
    setScripts(nextScripts);
    setSelectedId(script.id);
    setNewTitle('');
    setShowCreate(false);
    setNotice('Đã tạo kịch bản mới — đang lưu Supabase...');
    void saveScripts(nextScripts, true);
  }

  function handleEditorBlurSave() {
    queueSave(false, true);
  }

  function addBlock(type: BlockType = 'text', afterIndex?: number, text = '') {
    updateSelected((script) => {
      const blocks = [...script.blocks];
      const index = afterIndex === undefined ? blocks.length : afterIndex + 1;
      blocks.splice(index, 0, { id: newId('block'), type, text });
      return { ...script, blocks };
    });
  }

  function viewSection(section: SectionKey) {
    setActiveSection(section);
    setNotice(`Đang xem ${SECTION_LABELS[section]}.`);
  }

  function editSection(section: SectionKey) {
    if (!selected) return;
    setActiveSection(section);
    if (!sectionBlocks(selected, section).length) {
      addBlock(SCRIPT_SECTIONS.find((item) => item.id === section)?.blockType || 'text');
    }
    setNotice(`Đang sửa ${SECTION_LABELS[section]}.`);
  }

  function removeSection(section: SectionKey) {
    if (!selected) return;
    if (!window.confirm(`Xóa nội dung ${SECTION_LABELS[section]}?`)) return;
    const allowed = SECTION_BLOCK_TYPES[section];
    updateSelected((script) => ({
      ...script,
      blocks: script.blocks.filter((block) => !allowed.includes(block.type)),
    }));
    setActiveSection(section);
    setNotice(`Đã xóa ${SECTION_LABELS[section]}.`);
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

  async function generateAndAttachImage(prompt?: string) {
    const finalPrompt = (prompt || aiDraft?.image_prompt || '').trim();
    if (!selected) {
      setNotice('Chọn kịch bản trước khi tạo ảnh.');
      return;
    }
    if (!finalPrompt) {
      setNotice('Chưa có prompt ảnh. Bấm Prompt ảnh hoặc nhập yêu cầu ảnh trước.');
      return;
    }
    setImageBusy(true);
    setNotice('AI đang tạo ảnh...');
    try {
      const response = await api('/api/scripts/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          title: selected.title,
          script_id: selected.id,
          size: '1024x1024',
        }),
        timeoutMs: 180000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Không tạo được ảnh');
      const imageUrl = String(payload.image_url || payload.media_url || '').trim();
      if (!imageUrl) throw new Error('AI đã tạo ảnh nhưng không có URL ảnh');
      addBlock('image', undefined, imageUrl);
      setShowFbPreview(true);
      setNotice('Đã tạo ảnh và đính vào bài viết.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không tạo được ảnh');
    } finally {
      setImageBusy(false);
    }
  }

  async function publishFacebookPost() {
    if (!selected || !facebookPost?.hasContent) {
      setNotice('Bài chưa có nội dung để đăng.');
      return;
    }
    const targetId = publishTargetId.trim();
    if (!targetId) {
      setNotice('Nhập Page ID hoặc Group ID trước khi đăng.');
      return;
    }
    setPublishBusy(true);
    setNotice('Đang đăng Facebook...');
    try {
      const response = await api('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: facebookPost.plain,
          media_urls: facebookPost.mediaUrls,
          targets: [{ type: publishTargetType, id: targetId }],
        }),
        timeoutMs: 120000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Facebook chưa nhận bài đăng');
      setNotice(`Đã gửi đăng Facebook${facebookPost.mediaUrls.length ? ` kèm ${facebookPost.mediaUrls.length} ảnh` : ''}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không đăng được Facebook');
    } finally {
      setPublishBusy(false);
    }
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
    const prompts: Record<typeof type, string> = {
      hook: `Viết 1 hook ngắn (tối đa 2 câu) cho chủ đề "${topic}".`,
      intro: `Viết đoạn mở đầu ngắn cho chủ đề "${topic}".`,
      full: `Viết khung nội dung HOOK / BODY / CTA cho chủ đề "${topic}".`,
      cta: `Viết 1 CTA ngắn cho chủ đề "${topic}".`,
    };
    const section: SectionKey = type === 'hook' ? 'opening' : type === 'cta' ? 'ending' : 'body';
    setAiTab('chat');
    void quickAi(prompts[type], section);
  }

  function mentionedTechniqueIds(message: string) {
    const lower = message.toLocaleLowerCase('vi');
    const ids = new Set(selectedTechniqueIds);
    techniques.forEach((item) => {
      const name = item.name.toLocaleLowerCase('vi');
      if (lower.includes(`@${name}`) || lower.includes(name)) ids.add(item.id);
    });
    return [...ids];
  }

  async function sendAiChat(overrideMessage?: string, overrideSection?: SectionKey) {
    const message = (overrideMessage ?? chatInput).trim();
    const targetSection = overrideSection || activeSection;
    if (!message) return;
    if (!selected) {
      setNotice('Chọn kịch bản trước khi chat AI.');
      return;
    }
    const userMessage: ChatMessage = { id: newId('msg'), role: 'user', text: message };
    setChatMessages((rows) => [...rows, userMessage]);
    setChatInput('');
    setAiDraft(null);
    setChatBusy(true);
    try {
      const response = await api('/api/scripts/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          script: selected,
          active_section: targetSection,
          selected_technique_ids: mentionedTechniqueIds(message),
        }),
        timeoutMs: AI_TIMEOUT_MS,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        const fallback =
          response.status === 404
            ? 'Backend live chưa có API chat AI. Chờ backend Render deploy commit mới rồi thử lại.'
            : `AI chưa trả kết quả${response.status ? ` (HTTP ${response.status})` : ''}`;
        throw new Error(payload.error || fallback);
      }
      const result = payload.result as ScriptAiResult;
      setAiDraft(result);
      setChatMessages((rows) => [
        ...rows,
        { id: newId('msg'), role: 'ai', text: result.reply || 'AI đã tạo bản nháp. Bấm Add để đưa vào cấu trúc.' },
      ]);
      if (Array.isArray(payload.techniques) && payload.techniques.length) {
        setTechniqueStatus(`Đã áp dụng kỹ thuật: ${payload.techniques.map((item: ContentTechnique) => item.name).join(', ')}`);
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Không gọi được AI';
      setChatMessages((rows) => [...rows, { id: newId('msg'), role: 'ai', text: messageText }]);
      setNotice(messageText);
    } finally {
      setChatBusy(false);
    }
  }

  function insertionIndexForSection(blocks: ScriptBlock[], section: SectionKey) {
    if (section === 'opening') return 0;
    if (section === 'ending') return blocks.length;
    const firstEnding = blocks.findIndex((block) => sectionForBlock(block.type) === 'ending');
    return firstEnding >= 0 ? firstEnding : blocks.length;
  }

  function applySectionContent(script: ScriptDocument, section: SectionKey, text: string, action: 'replace' | 'append' | 'none') {
    const value = section === 'opening' ? limitOpeningLines(text) : text.trim();
    if (!value || action === 'none') return script;
    const sectionDef = SCRIPT_SECTIONS.find((item) => item.id === section) || SCRIPT_SECTIONS[1];
    const allowed = SECTION_BLOCK_TYPES[section];
    const nextBlock: ScriptBlock = { id: newId('block'), type: sectionDef.blockType, text: value };
    const blocks = [...script.blocks];
    if (action === 'append') {
      const lastIndex = [...blocks].map((block, index) => ({ block, index })).reverse()
        .find((item) => allowed.includes(item.block.type))?.index;
      const insertAt = lastIndex === undefined ? insertionIndexForSection(blocks, section) : lastIndex + 1;
      blocks.splice(insertAt, 0, nextBlock);
      return { ...script, blocks };
    }

    const firstIndex = blocks.findIndex((block) => allowed.includes(block.type));
    const kept = blocks.filter((block) => !allowed.includes(block.type));
    const insertAt = firstIndex >= 0 ? Math.min(firstIndex, kept.length) : insertionIndexForSection(kept, section);
    kept.splice(insertAt, 0, nextBlock);
    return { ...script, blocks: kept };
  }

  function applyAiDraft() {
    if (!aiDraft) return;
    const sections = aiDraft.sections || {};
    const target = aiDraft.target_section || activeSection;
    const action = aiDraft.action === 'append' ? 'append' : 'replace';
    updateSelected((script) => {
      let next = script;
      const keys: SectionKey[] = target === 'all'
        ? ['opening', 'body', 'ending']
        : target === 'opening' || target === 'body' || target === 'ending'
          ? [target]
          : [activeSection];
      keys.forEach((key) => {
        const value = sections[key];
        if (value) next = applySectionContent(next, key, value, action);
      });
      return next;
    });
    setAiDraft(null);
    setNotice('Đã Add nội dung AI vào cấu trúc bên trái.');
  }

  function quickAi(message: string, section: SectionKey = activeSection) {
    setActiveSection(section);
    void sendAiChat(message, section);
  }

  function renderChatInterface(large = false) {
    return (
      <>
        <div className={`script-ai-chat-log${large ? ' large' : ''}`} aria-live="polite">
          {chatMessages.map((message) => (
            <div className={`script-ai-bubble ${message.role}`} key={message.id}>
              <span>{message.role === 'user' ? 'Bạn' : 'AI'}</span>
              <p>{message.text}</p>
            </div>
          ))}
          {chatBusy ? <div className="script-ai-thinking"><RefreshCw /> AI đang xử lý...</div> : null}
        </div>

        {aiDraft && Object.values(aiDraft.sections || {}).some(Boolean) ? (
          <div className="script-ai-draft">
            <div className="script-ai-draft-head">
              <strong>Bản nháp AI</strong>
              <span>
                {aiDraft.action === 'append' ? 'Thêm vào' : 'Thay thế'} · {' '}
                {aiDraft.target_section === 'all'
                  ? 'Toàn bài'
                  : aiDraft.target_section === 'opening' || aiDraft.target_section === 'body' || aiDraft.target_section === 'ending'
                    ? SECTION_LABELS[aiDraft.target_section]
                    : SECTION_LABELS[activeSection]}
              </span>
            </div>
            {SCRIPT_SECTIONS.map((section) => {
              const text = aiDraft.sections?.[section.id];
              return text ? (
                <div className="script-ai-draft-section" key={section.id}>
                  <b>{section.label}</b>
                  <p>{text}</p>
                </div>
              ) : null;
            })}
            <div className="script-ai-draft-actions">
              <button type="button" className="script-primary compact" onClick={applyAiDraft}><Plus /> Add</button>
              <button type="button" onClick={() => setAiDraft(null)}><X /> Hủy</button>
            </div>
          </div>
        ) : null}

        {aiDraft?.image_prompt ? (
          <div className="script-ai-draft image-prompt">
            <div className="script-ai-draft-head">
              <strong>Mô tả ảnh AI</strong>
              <span>Dùng để tạo/đính kèm ảnh</span>
            </div>
            <div className="script-ai-draft-section">
              <p>{aiDraft.image_prompt}</p>
            </div>
            <div className="script-ai-draft-actions">
              <button type="button" className="script-primary compact" onClick={() => { void navigator.clipboard.writeText(aiDraft.image_prompt || ''); setNotice('Đã copy mô tả ảnh.'); }}>
                <Clipboard /> Copy prompt ảnh
              </button>
              <button type="button" className="script-primary compact" disabled={imageBusy} onClick={() => void generateAndAttachImage(aiDraft.image_prompt || '')}>
                <ImageIcon /> {imageBusy ? 'Đang tạo...' : 'Tạo & đính ảnh'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="script-ai-composer">
          {mentionSuggestions.length ? (
            <div className="script-mention-menu">
              {mentionSuggestions.map((technique) => (
                <button type="button" key={technique.id} onClick={() => selectMentionTechnique(technique)}>
                  <AtSign />
                  <span>{technique.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void sendAiChat();
              }
            }}
            placeholder={`Nhập yêu cầu cho ${SECTION_LABELS[activeSection]}...`}
            rows={large ? 5 : 3}
          />
          <button type="button" className="script-primary compact" disabled={chatBusy || !chatInput.trim()} onClick={() => void sendAiChat()}>
            <SendHorizontal /> Gửi
          </button>
        </div>
      </>
    );
  }

  function renderSettingsPanel() {
    const promptSummary = SECTION_ORDER.map((section) => studioSetup.sections[section].label).join(' · ');
    const aiSummary = [
      aiCustomerName.trim() || 'Chưa đặt tên khách',
      aiProvider === 'openai' ? 'OpenAI' : aiProvider === 'groq' ? 'Groq' : 'Gemini',
      aiModel.replace(/^models\//, ''),
    ].join(' · ');
    const techniqueSummary = techniques.length
      ? techniques.map((item) => `@${item.name}`).slice(0, 4).join(' ') + (techniques.length > 4 ? ` +${techniques.length - 4}` : '')
      : 'Chưa có kỹ thuật';

    return (
      <div className="script-ai-settings-tab">
        <BusinessProfilePanel embedded compact />

        <SettingsSectionCard
          icon="✨"
          title="Cài đặt Prompt"
          summary={promptSummary}
          hint="Hook · Mở đầu · CTA"
          onOpen={() => setSettingsModal('prompt')}
        />

        <SettingsSectionCard
          icon="🤖"
          title="Cấu hình AI theo khách"
          summary={aiSummary}
          hint={aiKeyMasked ? `API key: ${aiKeyMasked}` : 'Chưa lưu API key'}
          onOpen={() => setSettingsModal('ai')}
        />

        <SettingsSectionCard
          icon="📚"
          title="Kỹ thuật content"
          summary={techniqueSummary}
          hint={`${techniques.length} kỹ thuật · gõ @ khi chat AI`}
          onOpen={() => setSettingsModal('techniques')}
        />

        <SettingsFormModal
          open={settingsModal === 'prompt'}
          title="Cài đặt Prompt"
          wide
          onClose={() => setSettingsModal(null)}
          footer={(
            <div className="settings-modal-actions">
              {setupStatus ? <span className="profile-status">{setupStatus}</span> : <span />}
              <button type="button" className="script-primary compact" disabled={setupBusy} onClick={() => void saveStudioSetup()}>
                <Save /> Lưu rule
              </button>
            </div>
          )}
        >
          <div className="script-settings-grid">
            {SECTION_ORDER.map((section) => {
              const row = studioSetup.sections[section];
              return (
                <div className="content-setup-card compact" key={section}>
                  <div className="content-setup-card-head">
                    <strong>{row.label}</strong>
                    {section === 'opening' ? <span>Hook tối đa 3 dòng</span> : null}
                  </div>
                  <div className="profile-field">
                    <label>Tên</label>
                    <input value={row.name} onChange={(event) => updateSetupSection(section, 'name', event.target.value)} />
                  </div>
                  <div className="profile-field">
                    <label>Mô tả</label>
                    <input value={row.description} onChange={(event) => updateSetupSection(section, 'description', event.target.value)} />
                  </div>
                  <div className="profile-field full">
                    <label>Rule</label>
                    <textarea rows={section === 'opening' ? 3 : 4} value={row.rule} onChange={(event) => updateSetupSection(section, 'rule', event.target.value)} />
                  </div>
                </div>
              );
            })}
          </div>
        </SettingsFormModal>

        <SettingsFormModal
          open={settingsModal === 'ai'}
          title="Cấu hình AI theo khách"
          onClose={() => setSettingsModal(null)}
          footer={(
            <div className="settings-modal-actions">
              {aiConfigStatus ? <span className="profile-status">{aiConfigStatus}</span> : <span />}
              <div className="settings-modal-actions-buttons">
                <button type="button" title="Tải lại" disabled={aiConfigBusy} onClick={() => void loadAiConfig()}>
                  <RefreshCw size={14} /> Tải lại
                </button>
                <button type="button" disabled={aiConfigBusy} onClick={() => void testAiConfig()}>
                  <Sparkles size={14} /> Test
                </button>
                <button type="button" className="script-primary compact" disabled={aiConfigBusy} onClick={() => void saveAiConfig()}>
                  <Save /> Lưu AI
                </button>
              </div>
            </div>
          )}
        >
          <div className="script-ai-config-grid">
            <div className="profile-field full">
              <label>Tên khách / thương hiệu</label>
              <input value={aiCustomerName} onChange={(event) => setAiCustomerName(event.target.value)} placeholder="Tên khách / thương hiệu" />
            </div>
            <div className="profile-field">
              <label>Provider</label>
              <select
                value={aiProvider}
                onChange={(event) => {
                  const provider = event.target.value;
                  setAiProvider(provider);
                  setAiModel(DEFAULT_MODELS[provider] || DEFAULT_MODELS.gemini);
                  setAiModels(fallbackModels(provider));
                  setAiKeyMasked('');
                  void loadAiModels(provider);
                }}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI / ChatGPT API</option>
                <option value="groq">Groq</option>
              </select>
            </div>
            <div className="profile-field">
              <label>Model</label>
              <select value={aiModel} onChange={(event) => setAiModel(event.target.value)}>
                {aiModels.map((item) => (
                  <option key={item.id} value={item.id}>{item.display_name || item.id}</option>
                ))}
              </select>
            </div>
            <div className="profile-field full">
              <label>API key</label>
              <input value={aiKeyInput} onChange={(event) => setAiKeyInput(event.target.value)} placeholder={aiKeyMasked ? `Đã lưu ${aiKeyMasked}` : 'Nhập API key'} />
            </div>
          </div>
        </SettingsFormModal>

        <SettingsFormModal
          open={settingsModal === 'techniques'}
          title="Kỹ thuật content"
          wide
          onClose={() => setSettingsModal(null)}
          footer={techniqueStatus ? <span className="profile-status">{techniqueStatus}</span> : undefined}
        >
          <div className="script-tech-manager modal-inner">
            <div className="script-tech-form">
              <input value={techniqueName} onChange={(event) => setTechniqueName(event.target.value)} placeholder="Tên kỹ thuật, VD: AIDA" />
              <textarea value={techniqueContent} onChange={(event) => setTechniqueContent(event.target.value)} placeholder="Nội dung rule của kỹ thuật" rows={3} />
              <button type="button" className="script-primary compact" disabled={techniqueBusy} onClick={() => void addTechnique()}>
                <Plus /> Lưu kỹ thuật
              </button>
            </div>
            <div className="script-tech-list">
              {techniques.map((technique) => (
                <button
                  type="button"
                  key={technique.id}
                  className={selectedTechniqueIds.includes(technique.id) ? 'active' : ''}
                  title={technique.content}
                  onClick={() => setSelectedTechniqueIds((ids) => (ids.includes(technique.id) ? ids.filter((id) => id !== technique.id) : [...ids, technique.id]))}
                >
                  <span>@{technique.name}</span>
                  {!technique.system ? <em onClick={(event) => { event.stopPropagation(); void deleteTechnique(technique.id); }}>x</em> : null}
                </button>
              ))}
            </div>
            <button type="button" className="settings-inline-reload" disabled={techniqueBusy} onClick={() => void loadTechniques()}>
              <RefreshCw size={14} /> Tải lại danh sách
            </button>
          </div>
        </SettingsFormModal>
      </div>
    );
  }

  const aiModelLabel = useMemo(() => {
    const found = aiModels.find((item) => item.id === aiModel);
    return found?.display_name || aiModel || 'Gemini';
  }, [aiModel, aiModels]);

  return (
    <section className="script-studio" aria-label="Trình soạn kịch bản">
      {syncWarning ? (
        <div className="script-sync-warning" role="status">{syncWarning}</div>
      ) : null}
      <div className="script-studio-body">
      <aside className="script-library">
        <div className="script-library-head">
          <div>
            <h2>Scripts</h2>
          </div>
          <button type="button" className="script-primary compact" onClick={() => setShowCreate(true)}>
            <Plus /> Mới
          </button>
        </div>
        <div className="script-library-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm..." />
          <select value={filter} onChange={(event) => setFilter(event.target.value as ScriptStatus | '')}>
            <option value="">Tất cả</option>
            <option value="draft">Nháp</option>
            <option value="pending">Chờ</option>
            <option value="approved">OK</option>
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
                <button type="button" className="script-list-delete" title="Xóa kịch bản" onClick={(event) => { event.stopPropagation(); deleteScript(script.id); }}>
                  <Trash2 /> Xóa
                </button>
              </div>
            </div>
          ))}
          {!loaded ? (
            <div className="script-empty-list">Đang tải kịch bản...</div>
          ) : syncError && !scripts.length ? (
            <div className="script-empty-list script-sync-error">{syncError}</div>
          ) : !visibleScripts.length ? (
            <div className="script-empty-list">Không tìm thấy kịch bản.</div>
          ) : null}
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
              <select className="script-status-select" value={selected.status} onChange={(event) => updateSelected((script) => ({ ...script, status: event.target.value as ScriptStatus }))} aria-label="Trạng thái">
                <option value="draft">Nháp</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
              </select>
              <div className="script-editor-toolbar">
                {selected.plan_task_id ? (
                  <button
                    type="button"
                    className="script-save plan-link"
                    title={selected.plan_task_title ? `Task kế hoạch: ${selected.plan_task_title}` : 'Mở task trên Kế hoạch content'}
                    onClick={() => router.push(`${viewToPath('plan')}?task=${encodeURIComponent(selected.plan_task_id!)}`)}
                  >
                    <CalendarDays /> Kế hoạch
                  </button>
                ) : null}
                <button type="button" className="script-save" onClick={() => queueSave(true, true)}><Save /> Lưu bài</button>
                <button type="button" className="script-save review" onClick={() => void saveCurrentWithStatus('pending', 'Đã gửi duyệt. Task đã chuyển sang Chờ duyệt.')}><SendHorizontal /> Gửi duyệt</button>
                {selected.status === 'pending' ? (
                  <button type="button" className="script-save approve" onClick={() => void saveCurrentWithStatus('approved', 'Đã duyệt bài và lưu vào Bài đã duyệt.')}><Check /> Duyệt</button>
                ) : null}
                <button type="button" className="script-icon-button" title="Xuất file" onClick={exportScript}><FileDown /></button>
                <button type="button" className="script-icon-button" title="Copy" onClick={() => void copyCompleteVersion()}><Clipboard /></button>
                <button type="button" className="script-icon-button" title="Xóa kịch bản" onClick={() => deleteScript(selected.id)}><Trash2 /></button>
                <button type="button" className={`script-icon-button${showAi ? ' active' : ''}`} title="Trợ lý AI" onClick={() => setShowAi((value) => !value)}><Bot /></button>
              </div>
            </div>
            <div className="script-editor-meta script-doc-hint">
              <span>{wordCount} từ</span>
              <span>{selected.blocks.length} blocks</span>
              <div className="script-editor-copy">
                <button type="button" onClick={() => setShowFbPreview((v) => !v)}>{showFbPreview ? 'Ẩn FB' : 'Xem FB'}</button>
                <button type="button" onClick={printCompleteVersion}><Printer /> In</button>
              </div>
              <span className={syncError ? 'script-sync-error script-sync-line' : 'script-sync-line script-doc-hint-muted'} title={syncError || syncWarning || syncStatus}>
                {syncError || syncStatus}
              </span>
            </div>

            {showFbPreview && facebookPost ? (
              <div className="script-fb-inline-preview">
                <ScriptFacebookPreview script={selected} postHtml={facebookPost.html} hasContent={facebookPost.hasContent} mediaUrls={facebookPost.mediaUrls} />
                <div className="script-preview-actions">
                  <button type="button" className="script-primary compact" onClick={() => void copyFacebookPost()} disabled={!facebookPost.hasContent}>
                    <Clipboard /> Copy FB
                  </button>
                </div>
                <div className="script-publish-row">
                  <select value={publishTargetType} onChange={(event) => setPublishTargetType(event.target.value as 'group' | 'page')}>
                    <option value="group">Group</option>
                    <option value="page">Page</option>
                  </select>
                  <input value={publishTargetId} onChange={(event) => setPublishTargetId(event.target.value)} placeholder="Group ID / Page ID" />
                  <button type="button" className="script-primary compact" disabled={publishBusy || !facebookPost.hasContent} onClick={() => void publishFacebookPost()}>
                    <SendHorizontal /> {publishBusy ? 'Đang đăng...' : `Đăng FB${facebookPost.mediaUrls.length ? ` + ${facebookPost.mediaUrls.length} ảnh` : ''}`}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="script-block-list script-block-list-v3">
              {selected.blocks.map((block, index) => {
                const definition = BLOCK_TYPES.find((item) => item.id === block.type) || BLOCK_TYPES[0];
                const v3 = BLOCK_V3_META[block.type] || BLOCK_V3_META.text;
                return (
                  <div className={`script-block-card tone-${v3.tone} block-${block.type}`} key={block.id}>
                    <div className="script-block-accent" aria-hidden="true" />
                    <div className="script-block-card-inner">
                      <div className="script-block-card-head">
                        <GripVertical className="script-drag" />
                        <span className="script-block-label">{v3.label}</span>
                        <select className="script-block-type-mini" value={block.type} onChange={(event) => updateBlock(block.id, { type: event.target.value as BlockType })} aria-label="Loại block">
                          {BLOCK_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </select>
                        <div className="script-block-actions">
                          <button type="button" title="Lên" disabled={index === 0} onClick={() => moveBlock(index, -1)}><ChevronUp /></button>
                          <button type="button" title="Xuống" disabled={index === selected.blocks.length - 1} onClick={() => moveBlock(index, 1)}><ChevronDown /></button>
                          <button type="button" title="Nhân bản" onClick={() => duplicateBlock(block, index)}><Copy /></button>
                          <button type="button" title="Xóa block" onClick={() => removeBlock(block.id)}><X /></button>
                        </div>
                      </div>
                      <ScriptBlockEditor
                        block={block}
                        placeholder={definition.placeholder}
                        onChange={(patch) => updateBlock(block.id, patch)}
                        onBlurSave={handleEditorBlurSave}
                      />
                    </div>
                  </div>
                );
              })}
              <button type="button" className="script-add-block-v3" onClick={() => addBlock('text')}>
                <Plus /> Thêm block (tự viết tay)
              </button>
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
        ) : selectedId && !detailsLoaded ? (
          <div className="script-empty-editor full"><RefreshCw /><h3>Đang tải nội dung kịch bản...</h3><p>Vui lòng chờ nội dung đầy đủ trước khi chỉnh sửa.</p></div>
        ) : (
          <div className="script-empty-editor full"><Sparkles /><h3>Chọn hoặc tạo kịch bản mới</h3></div>
        )}
      </div>

      <div className="script-right-rail">
        {showAi ? (
          <aside className="script-ai-panel script-ai-panel-v3">
            <div className="script-ai-head">
              <div><Bot /><strong>AI {aiModelLabel}</strong></div>
              <button type="button" title="Phóng to chat" onClick={() => { setAiTab('chat'); setChatFullscreen(true); }}><Maximize2 /></button>
              <button type="button" title="Ẩn panel AI" onClick={() => setShowAi(false)}><X /></button>
            </div>
            <div className="script-ai-tabs" role="tablist">
              {AI_STUDIO_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={aiTab === tab.id}
                  className={aiTab === tab.id ? 'active' : ''}
                  onClick={() => setAiTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="script-ai-tab-body">
              {aiTab === 'quick' ? (
                <div className="script-ai-tab-panel">
                  <p className="script-ai-tab-hint">Viết nhanh theo cấu trúc kịch bản hiện tại.</p>
                  <div className="script-ai-templates script-ai-quick-actions">
                    <button type="button" disabled={chatBusy} onClick={() => { setAiTab('chat'); quickAi(`Viết toàn bộ kịch bản cho "${selected?.title || 'chủ đề này'}", chia HOOK / BODY / CTA rõ ràng.`); }}>
                      <Wand2 /> Viết toàn bài
                    </button>
                    <button type="button" disabled={chatBusy} onClick={() => addAiTemplate('hook')}>
                      <AtSign /> Gợi ý Hook (AI)
                    </button>
                    <button type="button" disabled={chatBusy} onClick={() => addAiTemplate('cta')}>
                      <MessageSquare /> Gợi ý CTA (AI)
                    </button>
                    <button type="button" disabled={chatBusy} onClick={() => { setAiTab('chat'); quickAi(`Chỉ tạo image_prompt mô tả ảnh minh họa cho bài "${selected?.title || 'nội dung này'}". Không sửa HOOK/BODY/CTA, action none, sections để rỗng.`); }}>
                      <Sparkles /> Prompt ảnh
                    </button>
                  </div>
                </div>
              ) : null}

              {aiTab === 'hook' ? (
                <div className="script-ai-tab-panel">
                  <p className="script-ai-tab-hint">Gợi ý hook và ý tưởng cho chủ đề đang soạn.</p>
                  <div className="script-ai-templates script-ai-quick-actions">
                    <button type="button" disabled={chatBusy} onClick={() => { setAiTab('chat'); quickAi('Đề xuất 5 hook khác nhau, mỗi hook tối đa 2 câu.', 'opening'); }}>
                      <Sparkles /> 5 hook
                    </button>
                    <button type="button" disabled={chatBusy} onClick={() => { setAiTab('chat'); quickAi('Đề xuất 3 góc nội dung khác nhau cho cùng chủ đề.', 'body'); }}>
                      <Wand2 /> 3 góc ý tưởng
                    </button>
                    <button type="button" disabled={chatBusy} onClick={() => addAiTemplate('hook')}>
                      <Plus /> Gợi ý hook (AI)
                    </button>
                  </div>
                </div>
              ) : null}

              {aiTab === 'chat' ? (
                renderChatInterface()
              ) : null}

              {aiTab === 'settings' ? renderSettingsPanel() : null}
            </div>
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

      {chatFullscreen ? (
        <div className="script-chat-modal-backdrop" role="presentation" onMouseDown={() => setChatFullscreen(false)}>
          <div className="script-chat-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="script-chat-modal-head">
              <div><Bot /><strong>Chat AI lớn</strong><span>{selected?.title || 'Chưa chọn kịch bản'}</span></div>
              <button type="button" onClick={() => setChatFullscreen(false)}><X /></button>
            </div>
            {renderChatInterface(true)}
          </div>
        </div>
      ) : null}

      {notice ? <div className="script-toast"><Check /> {notice}</div> : null}
    </section>
  );
}
