"use client";

// Keyboard/AT contract for the no-accidental-close modals (#106/#107 +
// docs/coding-standards.md H6). Those PRs removed backdrop/Escape dismissal
// from form modals but nothing trapped focus, so keyboard users could Tab into
// the inert page behind an open dialog — and once out, had no keyboard way to
// dismiss. Attach the returned callback as the overlay's `ref` and it:
//
//   1. moves focus into the dialog on open ([autofocus] target, else the first
//      focusable, else the container) — unless the dialog already placed it
//      (DialogProvider focuses its input/OK button itself);
//   2. traps Tab/Shift-Tab inside, and pulls focus back if anything outside
//      steals it (ignoring dialogs stacked later, e.g. a confirm over a form);
//   3. restores focus to the opener when the dialog goes away;
//   4. leaves Escape OFF unless `onEscape` is passed. Form modals stay
//      non-Escapable BY DESIGN — with the trap in place Tab always reaches
//      ×/Cancel, so keyboard dismissal exists without Escape's risk of
//      discarding a half-filled form. Dialogs with nothing to lose opt in
//      (DialogProvider's confirm/notify, and prompt while pristine).
//
// Ref-callback (not useRef+useEffect) so it works both for overlays rendered
// conditionally inside an always-mounted component ({open && <div ref=…>})
// and for components that mount together with their overlay.
//
// Duplicated verbatim in apps/admin/lib/useModalA11y.ts — folds into the shared
// packages/ui in roadmap phase P2 (docs/coding-standards.md D5).

import { useCallback, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useModalA11y(opts?: { onEscape?: () => void }) {
  // Re-read every render so the Escape closure sees fresh state (e.g. the
  // prompt's pristine check) without re-attaching listeners.
  const escRef = useRef(opts?.onEscape);
  escRef.current = opts?.onEscape;
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((node: HTMLElement | null) => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!node) return;

    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));

    // Deferred a tick so a dialog's own autoFocus/focus-on-open effect wins.
    const t = setTimeout(() => {
      if (node.contains(document.activeElement)) return;
      const target =
        node.querySelector<HTMLElement>("[autofocus]") ?? focusables()[0];
      if (target) {
        target.focus();
      } else {
        node.tabIndex = -1;
        node.focus();
      }
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escRef.current) {
        e.stopPropagation();
        escRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Backstop for focus leaving by routes Tab interception can't see
    // (backdrop mousedown, programmatic focus). A dialog stacked LATER owns
    // focus while it's up — never steal from another [role="dialog"].
    // The pull-back is DEFERRED a tick: a focus() issued from inside a
    // focusin handler can be dropped mid-dispatch, and the delay lets a
    // legitimate move (into this or a stacked dialog) settle before judging.
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (node.contains(target)) return;
      setTimeout(() => {
        if (!node.isConnected) return;
        const active = document.activeElement;
        if (node.contains(active)) return;
        const otherDialog =
          active instanceof HTMLElement
            ? active.closest('[role="dialog"]')
            : null;
        if (otherDialog && otherDialog !== node) return;
        (focusables()[0] ?? node).focus();
      }, 0);
    };

    node.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    cleanupRef.current = () => {
      clearTimeout(t);
      node.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
}
