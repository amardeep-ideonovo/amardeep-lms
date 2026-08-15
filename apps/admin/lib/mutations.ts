"use client";

// Shared glue for the admin's optimistic TanStack `useMutation` call sites
// (docs/coding-standards.md D4). The sites that migrated off the hand-rolled
// optimistic hook keep its contract — fresh snapshot when the run starts,
// verbatim restore on failure, auto-toast with Retry — but the pieces every
// site would otherwise copy by hand live here.

import { useEffect, useRef } from "react";
import { ApiError } from "@/lib/api";

// Fallback toast text; an ApiError's own message wins when there is one.
// (Same rule the hand-rolled hook applied to every failure toast.)
export function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

// The hand-rolled optimistic sites always FIRED their write and let fetch
// fail — an offline click meant an immediate error toast + rollback. TanStack
// mutations default to networkMode "online", which would instead PAUSE the
// write while offline: the optimistic paint would sit there looking saved,
// with no request and no toast. Optimistic call sites pass this so the old
// fail-fast behavior survives the migration.
export const OPTIMISTIC_NETWORK_MODE = "always" as const;

// NEVER OPTIMISTIC ACROSS A NAVIGATION BOUNDARY: a mutation's commit, revert
// and failure toast must stop applying once the owning component unmounts (a
// route change unmounts the page), because the state they would write no
// longer exists. TanStack still runs a mutation's callbacks after its owner is
// gone — they live on the cached Mutation, not the component — so optimistic
// call sites gate onSuccess/onError on this ref. Anything that navigates as
// part of the action must therefore either live in the persistent shell (the
// notification bell does) or stay pessimistic.
export function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
