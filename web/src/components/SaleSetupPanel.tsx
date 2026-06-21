'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BusinessProfilePanel } from '@/components/BusinessProfilePanel';
import { StaffCookiePanel, type StaffPayload } from '@/components/StaffCookiePanel';
import { api } from '@/lib/api';
import type { StaffAccount } from '@/lib/types';

type AiModelOption = {
  id: string;
  name?: string;
  display_name?: string;
  description?: string;
};

type SetupSectionKey = 'opening' | 'body' | 'ending';

type ContentStudioSetup = {
  sections: Record<SetupSectionKey, {
    label: string;
    name: string;
    description: string;
    rule: string;
  }>;
};

type Props = {
  aiProvider: string;
  onProviderChange: (v: string) => void;
  aiModel: string;
  aiModels: AiModelOption[];
  aiModelStatus: string;
  aiModelsLoading: boolean;
  onModelChange: (v: string) => void;
  onRefreshModels: () => void;
  aiAutoClassify: boolean;
  onAutoClassifyChange: (v: boolean) => void;
  aiStatus: string;
  maskedKey: string;
  hasKey: boolean;
  aiKeyEdit: boolean;
  aiKeyInput: string;
  onAiKeyInput: (v: string) => void;
  onToggleKeyEdit: () => void;
  onTestAi: () => void;
  onSaveKey: () => void;
  onDeleteKey: () => void;
  staff: StaffAccount[];
  currentStaff?: StaffAccount | null;
  canManageStaff: boolean;
  staffStatus: string;
  showStaffManager?: boolean;
  staffTitle?: string;
  staffKicker?: string;
  onSaveStaff: (payload: StaffPayload, staffId?: string) => Promise<{ ok: boolean; error?: string }>;
  onDeleteStaff: (staffId: string) => Promise<void>;
  onStaffModalOpen?: () => void;
};

const SECTION_ORDER: SetupSectionKey[] = ['opening', 'body', 'ending'];

function defaultContentStudioSetup(): ContentStudioSetup {
  return {
    sections: {
      opening: {
        label: 'Mở bài',
        name: 'Hook',
        description: 'Tối đa 3 dòng',
        rule: 'Hook phải thu hút, rõ chủ đề và tối đa 3 dòng.',
      },
      body: {
        label: 'Thân bài',
        name: 'Thân bài',
        description: 'Rõ ý chính',
        rule: 'Triển khai nội dung chính mạch lạc, dễ hiểu, bám đúng sản phẩm và khách hàng.',
      },
      ending: {
        label: 'Kết bài',
        name: 'Kết bài',
        description: 'Chốt hành động',
        rule: 'Kết bài phải có CTA tự nhiên, không bịa ưu đãi hoặc cam kết.',
      },
    },
  };
}

function limitWords(value: string, maxWords: number) {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function limitLines(value: string, maxLines: number) {
  return value.replace(/\r\n/g, '\n').split('\n').slice(0, maxLines).join('\n');
}

export function SaleSetupPanel(props: Props) {
  const {
    aiProvider,
    onProviderChange,
    aiModel,
    aiModels,
    aiModelStatus,
    aiModelsLoading,
    onModelChange,
    onRefreshModels,
    aiAutoClassify,
    onAutoClassifyChange,
    aiStatus,
    maskedKey,
    hasKey,
    aiKeyEdit,
    aiKeyInput,
    onAiKeyInput,
    onToggleKeyEdit,
    onTestAi,
    onSaveKey,
    onDeleteKey,
    staff,
    currentStaff,
    canManageStaff,
    staffStatus,
    showStaffManager = true,
    staffTitle = 'Cookie nhân sự',
    staffKicker = 'Quản lý đăng nhập',
    onSaveStaff,
    onDeleteStaff,
    onStaffModalOpen,
  } = props;
  const [studioSetup, setStudioSetup] = useState<ContentStudioSetup>(defaultContentStudioSetup);
  const [setupStatus, setSetupStatus] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    const rows: AiModelOption[] = [];
    if (aiModel) {
      rows.push({ id: aiModel, display_name: aiModel });
      seen.add(aiModel);
    }
    aiModels.forEach((item) => {
      if (!item.id || seen.has(item.id)) return;
      seen.add(item.id);
      rows.push(item);
    });
    return rows;
  }, [aiModel, aiModels]);

  const loadStudioSetup = useCallback(async () => {
    try {
      const r = await api('/api/content-studio/setup');
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok && d.setup) {
        setStudioSetup({ ...defaultContentStudioSetup(), ...d.setup });
        if (d.warning) setSetupStatus(d.warning);
      }
    } catch {
      setSetupStatus('Không tải được cài đặt chung');
    }
  }, []);

  useEffect(() => {
    void loadStudioSetup();
  }, [loadStudioSetup]);

  function updateSetupSection(section: SetupSectionKey, field: 'name' | 'description' | 'rule', value: string) {
    const nextValue =
      field === 'description'
        ? limitWords(value, 3)
        : field === 'rule' && section === 'opening'
          ? limitLines(value, 3)
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
    setSetupStatus('Đang lưu cài đặt chung...');
    try {
      const r = await api('/api/content-studio/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: studioSetup }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setStudioSetup({ ...defaultContentStudioSetup(), ...(d.setup || studioSetup) });
        setSetupStatus(d.warning || (d.storage === 'supabase' ? 'Đã lưu Supabase' : 'Đã lưu local'));
      } else {
        setSetupStatus(d.error || 'Không lưu được cài đặt chung');
      }
    } catch {
      setSetupStatus('Không kết nối được backend khi lưu cài đặt chung');
    } finally {
      setSetupBusy(false);
      window.setTimeout(() => setSetupStatus(''), 5000);
    }
  }

  return (
    <div className="setup-panel">
      <div className="setup-section">
        <div className="setup-section-title">Cấu hình AI</div>
        <div className="ai-row">
          <select value={aiProvider || 'gemini'} onChange={(e) => onProviderChange(e.target.value)}>
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI / ChatGPT</option>
            <option value="groq">Groq</option>
          </select>
          <select className="ai-model-select" value={aiModel} onChange={(e) => onModelChange(e.target.value)}>
            {modelOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {(item.display_name || item.id).replace(/^models\//, '')}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ai-sm btn-ai-test" onClick={() => void onRefreshModels()} disabled={aiModelsLoading}>
            {aiModelsLoading ? 'Đang tải model' : 'Tải model'}
          </button>
          <button type="button" className="btn-ai-sm btn-ai-test" onClick={() => void onTestAi()}>
            Test AI
          </button>
          <label className="ai-auto-label">
            <input type="checkbox" checked={aiAutoClassify} onChange={(e) => onAutoClassifyChange(e.target.checked)} /> Tự động
          </label>
        </div>
        <div className="ai-row">
          <span className="ai-key-label">API Key</span>
          <span className="ai-key-display">{hasKey ? maskedKey : 'Chưa có key'}</span>
          {aiKeyEdit ? (
            <>
              <input
                className="ai-key-input"
                placeholder="Nhập API Key..."
                value={aiKeyInput}
                onChange={(e) => onAiKeyInput(e.target.value)}
              />
              <button type="button" className="btn-ai-sm btn-ai-save" onClick={() => void onSaveKey()}>
                Lưu
              </button>
            </>
          ) : null}
          {hasKey ? (
            <button type="button" className="btn-ai-sm btn-ai-del" onClick={() => void onDeleteKey()}>
              Xóa
            </button>
          ) : null}
          <button type="button" className="btn-ai-sm btn-ai-test" onClick={onToggleKeyEdit}>
            {hasKey ? 'Sửa key' : 'Thêm key'}
          </button>
        </div>
        {aiStatus ? <div className="setup-hint">{aiStatus}</div> : null}
        {aiModelStatus ? <div className="setup-hint">{aiModelStatus}</div> : null}
      </div>

      <div className="setup-divider" />

      <div className="setup-section">
        <div className="ai-row">
          <div className="setup-section-title">Cài đặt chung</div>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-ai-sm btn-ai-save" disabled={setupBusy} onClick={() => void saveStudioSetup()}>
            {setupBusy ? 'Đang lưu' : 'Lưu rule'}
          </button>
          {setupStatus ? <span className="profile-status">{setupStatus}</span> : null}
        </div>
        <div className="content-setup-grid">
          {SECTION_ORDER.map((section) => {
            const row = studioSetup.sections[section];
            return (
              <div className="content-setup-card" key={section}>
                <div className="content-setup-card-head">
                  <strong>{row.label}</strong>
                  {section === 'opening' ? <span>Hook tối đa 3 dòng</span> : null}
                </div>
                <div className="profile-grid">
                  <div className="profile-field">
                    <label>Tên</label>
                    <input
                      type="text"
                      value={row.name}
                      placeholder="Tên mục"
                      onChange={(e) => updateSetupSection(section, 'name', e.target.value)}
                    />
                  </div>
                  <div className="profile-field">
                    <label>Mô tả</label>
                    <input
                      type="text"
                      value={row.description}
                      placeholder="Tối đa 3 từ"
                      onChange={(e) => updateSetupSection(section, 'description', e.target.value)}
                    />
                  </div>
                  <div className="profile-field full">
                    <label>Rule</label>
                    <textarea
                      value={row.rule}
                      rows={section === 'opening' ? 3 : 4}
                      placeholder="Quy tắc AI phải tuân theo"
                      onChange={(e) => updateSetupSection(section, 'rule', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showStaffManager ? (
        <>
          <div className="setup-divider" />

          <StaffCookiePanel
            staff={staff}
            currentStaff={currentStaff}
            canManage={canManageStaff}
            status={staffStatus}
            title={staffTitle}
            kicker={staffKicker}
            onSave={onSaveStaff}
            onDelete={onDeleteStaff}
            onModalOpen={onStaffModalOpen}
          />
        </>
      ) : null}

      <div className="setup-divider" />

      <BusinessProfilePanel embedded />
    </div>
  );
}
