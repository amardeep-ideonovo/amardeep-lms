"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";

// The admin's hand-rolled optimistic update, in one place.
//
// React 18 has no `useOptimistic`, so the app already carried three copies of
// the same five steps (sidebar order, the notification bell, the menu-tree
// reorder): snapshot what you're about to touch, paint the new state, fire the
// write, and on failure put the snapshot back. This is that shape, with the
// two rules those copies each got slightly differently:
//
//  1. ONE IN-FLIGHT ACTION PER ENTITY. Reverting means restoring a snapshot,
//     and a snapshot is only true for as long as nothing else has written to
//     that entity. If two writes for the same row overlapped, a late failure
//     could restore a value the admin has since changed. So a run whose `key`
//     is already busy does not start: it waits, and starts (taking a FRESH
//     snapshot of the state it will actually revert to) once the in-flight run
//     settles. Only the newest waiting run survives — an older one still
//     queued for the same key is superseded, since every call site here sends
//     an absolute value ("set status = PUBLISHED"), not a relative one, so the
//     newest intent is the whole truth.
//
//  2. THE SERVER IS ALWAYS THE WINNER. `commit` applies the write's response,
//     so the optimistic paint is only ever a placeholder for the real answer.
//     Where a response can't say what changed ({ok:true} endpoints), the call
//     site heals with its normal refetch instead. Background refetches stay
//     free to overwrite anything this wrote — `hasPending()` lets a poll skip
//     a tick rather than fight a write that is still in the air.
//
// NEVER OPTIMISTIC ACROSS A NAVIGATION BOUNDARY: the hook stops applying
// commits and reverts once its owner unmounts (a route change unmounts the
// page), because the state they would write no longer exists. Anything that
// navigates as part of the action must therefore either live in the persistent
// shell (the notification bell does) or stay pessimistic.

export type OptimisticAction<S, R> = {
  // Entity identity. Runs sharing a key are serialized (see rule 1); runs with
  // different keys are free to overlap. Scope it to the thing being written —
  // `level:${id}`, `list-item:${id}` — not to the control that was clicked.
  key: string;
  // Capture ONLY the slice about to change, read at run time (not render time)
  // so a queued run snapshots the state it will really revert to.
  snapshot: () => S;
  // Paint the optimistic state. Must go through the same state the list already
  // renders from — never a parallel copy.
  apply: () => void;
  // The write.
  request: () => Promise<R>;
  // Apply the server's authoritative answer. Omit when the response can't
  // describe the new state ({ok:true}) and heal with a refetch instead.
  commit?: (result: R) => void;
  // Put the snapshot back. Should be keyed by id, not by array index — the
  // list may have re-ordered underneath.
  revert: (snapshot: S) => void;
  // Fallback toast text; an ApiError's own message wins when there is one.
  errorMessage: string;
  // Extra failure handling (a refetch to heal, a page-level error strip, …).
  onError?: (error: unknown) => void;
  // Set false for a write that can't sensibly be repeated; the toast then has
  // no Retry button and auto-dismisses like any other error.
  retry?: boolean;
};

export type OptimisticOutcome<R> =
  | { status: "ok"; result: R }
  | { status: "failed"; error: unknown }
  // Never started: superseded by a newer run for the same key, or the owner
  // unmounted before its turn came.
  | { status: "superseded" };

type Waiting = { start: () => void; supersede: () => void };

type RunFn = <S, R>(
  action: OptimisticAction<S, R>,
) => Promise<OptimisticOutcome<R>>;

export function optimisticErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export function useOptimisticAction() {
  const toast = useToast();
  const mounted = useRef(true);
  // Keys with a run in flight, and at most one waiting run per key.
  const running = useRef(new Set<string>());
  const waiting = useRef(new Map<string, Waiting>());
  // `run` refers to itself (the Retry button re-runs the same action), so it
  // goes through a ref to stay a stable callback.
  const runRef = useRef<RunFn | null>(null);

  useEffect(() => {
    mounted.current = true;
    const pending = waiting.current;
    return () => {
      mounted.current = false;
      pending.forEach((w) => w.supersede());
      pending.clear();
    };
  }, []);

  const execute = useCallback(
    async <S, R>(
      action: OptimisticAction<S, R>,
    ): Promise<OptimisticOutcome<R>> => {
      running.current.add(action.key);
      const snapshot = action.snapshot();
      action.apply();
      try {
        const result = await action.request();
        if (mounted.current) action.commit?.(result);
        return { status: "ok", result };
      } catch (error) {
        if (mounted.current) {
          action.revert(snapshot);
          action.onError?.(error);
          toast(optimisticErrorMessage(error, action.errorMessage), {
            action:
              action.retry === false
                ? undefined
                : {
                    label: "Retry",
                    onAction: () => void runRef.current?.(action),
                  },
          });
        }
        return { status: "failed", error };
      } finally {
        running.current.delete(action.key);
        // Hand the key over to whatever queued up behind this run. It snapshots
        // now, on top of whatever this run just committed or reverted.
        const next = waiting.current.get(action.key);
        if (next) {
          waiting.current.delete(action.key);
          if (mounted.current) next.start();
          else next.supersede();
        }
      }
    },
    [toast],
  );

  const run = useCallback(
    <S, R>(action: OptimisticAction<S, R>): Promise<OptimisticOutcome<R>> => {
      if (!mounted.current) return Promise.resolve({ status: "superseded" });
      if (!running.current.has(action.key)) return execute(action);
      return new Promise<OptimisticOutcome<R>>((resolve) => {
        waiting.current.get(action.key)?.supersede();
        waiting.current.set(action.key, {
          start: () => resolve(execute(action)),
          supersede: () => resolve({ status: "superseded" }),
        });
      });
    },
    [execute],
  );
  runRef.current = run;

  // Imperative reads for background refreshes — they don't re-render, so drive
  // disabled/saving UI from the call site's own pending flag (Phase 0), not
  // from these.
  const isPending = useCallback(
    (key: string) => running.current.has(key) || waiting.current.has(key),
    [],
  );
  const hasPending = useCallback(() => running.current.size > 0, []);

  // Stable identity: call sites list it in useCallback/useEffect deps.
  return useMemo(
    () => ({ run, isPending, hasPending }),
    [run, isPending, hasPending],
  );
}
