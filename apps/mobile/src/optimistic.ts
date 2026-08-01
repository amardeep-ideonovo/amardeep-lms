// Optimistic UI helper for the app's plain-`useState` screens.
//
// The app has no data-fetching library — every screen owns its own state — so
// "optimistic" here means: patch the state the member is looking at NOW, fire
// the request, and put the OLD value back if it fails. This module is the one
// place that pattern lives, so the snapshot/revert bookkeeping isn't retyped
// (and subtly mis-typed) at each call site.
//
// What must NEVER go through here: anything entitlement-bearing or
// money-related. Access grants, unlocks, certificate claims and plan changes
// are the server's call and stay pessimistic — the client may only ever
// pre-render a change it is allowed to be wrong about.
import type { Dispatch, SetStateAction } from "react";

/**
 * Apply an optimistic patch and get back the undo.
 *
 * `apply` runs against the CURRENT state (it's a functional update, so it sees
 * the freshest value, not whatever the handler closed over at render time).
 * The value it replaced is kept verbatim, and `revert()` puts that exact object
 * back — it never re-derives the old state by inverting the patch, which is
 * what quietly drifts when a patch touches more than it looks like it does.
 *
 * Usage:
 *
 *   const revert = optimistic(setUser, (u) => (u ? { ...u, avatarUrl: uri } : u));
 *   try {
 *     setUser(await api.uploadAvatar(uri));
 *   } catch (e) {
 *     revert();
 *     setError(...);
 *   }
 *
 * Note on races: `revert()` restores the pre-patch snapshot unconditionally. If
 * a background refetch replaced the state while the request was in flight, the
 * revert wins and the screen is briefly stale — self-healing on the next
 * focus/pull-to-refresh, and the honest choice over leaving a failed write
 * rendered as if it had succeeded.
 */
export function optimistic<T>(
  setState: Dispatch<SetStateAction<T>>,
  apply: (prev: T) => T,
): () => void {
  let snapshot!: T;
  let captured = false;

  setState((prev) => {
    // React may invoke a state updater more than once for a single update
    // (StrictMode double-renders it to surface impure reducers), so only the
    // FIRST call defines the snapshot. `apply` must stay pure for the same
    // reason — patch and return, no side effects.
    if (!captured) {
      snapshot = prev;
      captured = true;
    }
    return apply(prev);
  });

  return () => {
    // Nothing was applied (the caller bailed before patching) => nothing to undo.
    if (!captured) return;
    setState(() => snapshot);
  };
}
