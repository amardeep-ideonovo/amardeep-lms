"use client";

import type { FormEvent, ReactNode } from "react";
import { STR } from "@lms/types";
import { useModalA11y } from "@/lib/useModalA11y";

/**
 * The one shell for an admin form modal: the overlay, the focus-trap / Escape
 * a11y wiring (`useModalA11y`), the header + close button, and the
 * `.modal-form` wrapper. Pages render `{open && <FormModal …>…</FormModal>}` and
 * pass the body + footer as children — normally a `<div className="modal-body">`
 * (the scrolling fields) followed by a `<ModalFooter>` (draft banner → save
 * error → the Save/Cancel `.row-actions`). Keeping the children in that natural
 * order means a modal migrates onto the shell without moving its markup around.
 *
 * Most modals submit a `<form>`; pass `onSubmit` and the shell wraps the
 * children in one. A button-driven modal (no native submit) omits `onSubmit`
 * and gets a plain `<div className="modal-form">` instead.
 */
export function FormModal({
  title,
  onClose,
  onSubmit,
  wide = false,
  maxWidth,
  onEscape,
  closeDisabled = false,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  wide?: boolean;
  maxWidth?: number;
  onEscape?: () => void;
  // Disable the × while a save is in flight (so a mid-save close can't hide the
  // result). Defaults to always-clickable, matching most modals.
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const modalRef = useModalA11y(onEscape ? { onEscape } : undefined);
  return (
    <div
      ref={modalRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={wide ? "modal modal--wide" : "modal"}
        style={maxWidth != null ? { maxWidth } : undefined}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={STR.common.close}
          >
            ×
          </button>
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} className="modal-form">
            {children}
          </form>
        ) : (
          <div className="modal-form">{children}</div>
        )}
      </div>
    </div>
  );
}

export default FormModal;
