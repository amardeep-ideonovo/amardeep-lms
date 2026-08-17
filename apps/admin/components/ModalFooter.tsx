"use client";

import type { ReactNode } from "react";
import DraftRestoredBanner from "./DraftRestoredBanner";

/**
 * Pinned footer for an admin form modal. It lives OUTSIDE the scrolling
 * `.modal-body` (as the last child of a `.modal-form`), so the Save/Cancel
 * actions and any save error stay put while the body scrolls. It stacks,
 * top → bottom:
 *   1. an optional "draft restored" banner (with a Discard button),
 *   2. the save error — `role="alert"` so screen readers announce it, and it
 *      sits right next to Save instead of at the top of the scroll, and
 *   3. the actions passed as `children` (a `.row-actions` with Save/Cancel).
 *
 * Pairs with `usePersistedDraft` for (1); pass its `restored`/`discard` through.
 */
export function ModalFooter({
  error,
  draftRestored = false,
  onDiscardDraft,
  children,
}: {
  error?: string | null;
  draftRestored?: boolean;
  onDiscardDraft?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-footer">
      {draftRestored && <DraftRestoredBanner onDiscard={onDiscardDraft} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

export default ModalFooter;
