'use client';

import type { ReactNode } from 'react';

type SettingsFormModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

export function SettingsFormModal({ open, title, onClose, children, footer, wide }: SettingsFormModalProps) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay open settings-form-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className={`modal settings-form-modal${wide ? ' modal-wide' : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-hd">
          <span>{title}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="settings-form-modal-body">{children}</div>
        {footer ? <div className="modal-actions settings-form-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
