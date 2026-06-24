'use client';

import { ChevronRight } from 'lucide-react';

type SettingsSectionCardProps = {
  icon?: string;
  title: string;
  summary?: string;
  hint?: string;
  onOpen: () => void;
};

export function SettingsSectionCard({ icon, title, summary, hint, onOpen }: SettingsSectionCardProps) {
  return (
    <button type="button" className="settings-section-card" onClick={onOpen}>
      <div className="settings-section-card-main">
        <div className="settings-section-card-title">
          {icon ? <span className="settings-section-card-icon" aria-hidden="true">{icon}</span> : null}
          <strong>{title}</strong>
        </div>
        {summary ? <p className="settings-section-card-summary">{summary}</p> : null}
        {hint ? <p className="settings-section-card-hint">{hint}</p> : null}
      </div>
      <ChevronRight className="settings-section-card-chevron" size={18} aria-hidden="true" />
    </button>
  );
}
