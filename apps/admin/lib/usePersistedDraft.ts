"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// One localStorage namespace for every admin modal draft. The version segment
// lets a form invalidate drafts saved under an older field shape (bump it when
// `data`'s shape changes incompatibly); `sweepOldVersions` clears the stale
// ones on open so they can never be restored into a form that outgrew them.
const KEY_PREFIX = "lms.admin.draft";

function keyFor(version: number, formKey: string, entityId: string | null) {
  return `${KEY_PREFIX}.v${version}.${formKey}.${entityId ?? "new"}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null"; // a non-serializable payload simply doesn't persist
  }
}

function sweepOldVersions(
  version: number,
  formKey: string,
  entityId: string | null,
) {
  if (typeof window === "undefined") return;
  const suffix = `.${formKey}.${entityId ?? "new"}`;
  const current = keyFor(version, formKey, entityId);
  const stale: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith(`${KEY_PREFIX}.v`) &&
      k.endsWith(suffix) &&
      k !== current
    ) {
      stale.push(k);
    }
  }
  for (const k of stale) window.localStorage.removeItem(k);
}

export type PersistedDraft = {
  /** True while a saved draft (one that differs from the seeded form) is showing. */
  restored: boolean;
  /** Drop the saved draft and disarm — call on a SUCCESSFUL save (or on delete of the edited row). */
  clearSaved: () => void;
  /** Revert the form to its freshly-seeded baseline and drop the saved draft (stays armed). */
  discard: () => void;
};

/**
 * Persist a modal form's in-progress values to localStorage so a half-filled
 * form resumes when the modal is reopened. Render-driven: pass the CURRENT form
 * values as `data` (recomputed each render — omit File/blob fields, which don't
 * serialize) and a `restore` that writes a saved snapshot back into state.
 *
 * Lifecycle, keyed by `lms.admin.draft.v<version>.<formKey>.<entityId|"new">`:
 *  • On open: capture the seeded values as the baseline, sweep older versions,
 *    and if a saved draft exists that DIFFERS from the baseline, restore it and
 *    flag `restored` (so the footer can show a "draft restored" banner).
 *  • While open: debounced writes whenever `data` differs from the baseline;
 *    when `data` returns to the baseline the draft is removed — so a draft in
 *    storage always means "real unsaved changes".
 *  • On close / Cancel: the last persisted draft is KEPT (reopen resumes it).
 *    We deliberately DON'T flush on close — a page that resets its fields inside
 *    closeModal would otherwise overwrite the good draft with empty values.
 *  • On save: the caller invokes `clearSaved()`, which also disarms the flush
 *    so the subsequent close can't resurrect the just-saved draft.
 *  • On tab close: a `beforeunload` handler flushes the latest value (the form
 *    isn't reset in that path, so the values are real).
 *
 * `enabled: false` opts a form out entirely (e.g. one holding a temp password).
 */
export function usePersistedDraft<T>({
  formKey,
  version,
  entityId,
  open,
  enabled = true,
  data,
  restore,
  debounceMs = 500,
}: {
  formKey: string;
  version: number;
  entityId: string | null;
  open: boolean;
  enabled?: boolean;
  data: T;
  restore: (draft: T) => void;
  debounceMs?: number;
}): PersistedDraft {
  const [restored, setRestored] = useState(false);

  // Latest values, read by effects/handlers without re-subscribing them.
  const serialized = safeStringify(data);
  const serializedRef = useRef(serialized);
  serializedRef.current = serialized;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const key = keyFor(version, formKey, entityId);
  const keyRef = useRef(key);
  keyRef.current = key;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const baselineRef = useRef<string | null>(null); // seeded snapshot for this open
  const readyRef = useRef(false); // writes armed only after the open-effect ran
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback(() => {
    if (typeof window === "undefined") return;
    const k = keyRef.current;
    if (serializedRef.current === baselineRef.current) {
      window.localStorage.removeItem(k); // back to pristine → no draft
    } else {
      window.localStorage.setItem(k, serializedRef.current);
    }
  }, []);

  const clearSaved = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(keyRef.current);
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    readyRef.current = false; // disarm so a save's ensuing close can't re-save it
    setRestored(false);
  }, []);

  const discard = useCallback(() => {
    if (baselineRef.current != null) {
      try {
        restoreRef.current(JSON.parse(baselineRef.current) as T);
      } catch {
        /* baseline unparseable — leave the form as-is */
      }
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(keyRef.current);
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setRestored(false); // stays armed: further edits should persist again
  }, []);

  // ----- On open: seed baseline, sweep, restore a differing draft -----
  useEffect(() => {
    if (!open) {
      // Closing: clear any pending debounce and disarm. No flush — see the
      // header note (a reset-on-close would clobber the good draft otherwise).
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      readyRef.current = false;
      baselineRef.current = null;
      setRestored(false);
      return;
    }
    if (!enabledRef.current || typeof window === "undefined") return;

    // The seeding setState()s (resetForm / startEdit) ran in the same event
    // that flipped `open`, so by this post-commit effect `data` holds them.
    baselineRef.current = serializedRef.current;
    sweepOldVersions(version, formKey, entityId);

    const saved = window.localStorage.getItem(keyRef.current);
    if (saved != null && saved !== baselineRef.current) {
      try {
        restoreRef.current(JSON.parse(saved) as T);
        setRestored(true);
      } catch {
        window.localStorage.removeItem(keyRef.current); // corrupt → drop it
        setRestored(false);
      }
    } else {
      setRestored(false);
    }
    readyRef.current = true;
  }, [open, formKey, version, entityId]);

  // ----- While open: debounced persistence on change -----
  useEffect(() => {
    if (!open || !enabledRef.current || !readyRef.current) return;
    if (typeof window === "undefined") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      write();
    }, debounceMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [serialized, open, debounceMs, write]);

  // ----- Flush the latest value if the tab is closing -----
  useEffect(() => {
    if (!open || !enabled || typeof window === "undefined") return;
    const onBeforeUnload = () => {
      if (readyRef.current) write();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, enabled, write]);

  return { restored, clearSaved, discard };
}

export default usePersistedDraft;
