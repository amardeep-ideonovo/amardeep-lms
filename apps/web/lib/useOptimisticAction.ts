"use client";

import { useCallback, useRef } from "react";

// Apply-then-confirm for reversible, single-owner state.
//
// React 18 has no `useOptimistic`, so this is the hand-rolled equivalent: take a
// snapshot, paint the success state, run the request, and put the snapshot back
// if it fails. It is deliberately small — the caller owns its own state and this
// only sequences the three steps around it.
//
// Two rules it enforces, both of which are correctness rather than polish:
//
//  1. ONE in-flight action per key. Two overlapping actions on the same entity
//     can revert each other's work — the second would snapshot the first's
//     optimistic value and, on failure, restore a state the server never had.
//     Overlapping calls are dropped, not queued: the caller's control is already
//     disabled while pending, so a second call means a double-fire, and the
//     right answer to a double-fire is to ignore it.
//
//  2. The snapshot is restored VERBATIM, never re-derived. Recomputing "what it
//     probably was" is how a revert quietly invents state.
//
// The server always wins: a later refetch overwrites whatever this painted.
export function useOptimisticAction() {
  const inFlight = useRef(new Set<string>());

  const run = useCallback(
    async <T>(
      key: string,
      steps: {
        /** Capture the exact slice `apply` is about to change. */
        snapshot: () => T;
        /** Paint the success state now. */
        apply: () => void;
        /** The request. Its result is returned to the caller on success. */
        commit: () => Promise<unknown>;
        /** Put the captured slice back. Must not re-derive it. */
        revert: (snapshot: T) => void;
        /** Called with the error after `revert` has already run. */
        onError?: (err: unknown) => void;
      },
    ): Promise<unknown> => {
      if (inFlight.current.has(key)) return undefined;
      inFlight.current.add(key);
      const snap = steps.snapshot();
      steps.apply();
      try {
        return await steps.commit();
      } catch (err) {
        steps.revert(snap);
        steps.onError?.(err);
        return undefined;
      } finally {
        inFlight.current.delete(key);
      }
    },
    [],
  );

  return run;
}
