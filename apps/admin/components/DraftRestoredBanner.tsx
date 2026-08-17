"use client";

/**
 * "Draft restored" notice for a form whose in-progress values were recovered
 * from a persisted draft (see `usePersistedDraft`). Rendered by `ModalFooter`
 * for modal forms and directly above the Save row for inline editors, so the
 * markup stays in one place. Pass the hook's `restored` (to gate rendering) and
 * `discard` (to revert + clear the draft).
 */
export function DraftRestoredBanner({ onDiscard }: { onDiscard?: () => void }) {
  return (
    <div className="alert-warning modal-footer__draft" role="status">
      <span>Draft restored — you have unsaved changes from earlier.</span>
      {onDiscard && (
        <button type="button" className="linklike" onClick={onDiscard}>
          Discard
        </button>
      )}
    </div>
  );
}

export default DraftRestoredBanner;
