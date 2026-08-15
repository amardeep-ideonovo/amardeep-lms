"use client";

// TanStack Query provider for the member web app (docs/coding-standards.md D4,
// roadmap P4). Mirrors the mobile app's proven config — apps/mobile/src/
// query.tsx is the house pattern: one client per mount, a short stale window,
// no retries on 4xx (ApiError carries status; a 403/404 won't change on
// retry), no mutation retries (mutations are never safe to blind-repeat).
//
// Adoption order (D4): new pages use useQuery from day one; the member read
// surfaces (dashboard/classes/certificates/account/payments) migrated first
// (hooks in lib/queries.ts, which also owns the `qk` query-key registry), then
// the remaining hand-rolled loads, then useOptimisticAction was retired for
// useMutation + onMutate snapshot/rollback (scope ids keep its one-in-flight-
// per-entity rule).

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@lms/types";

import { clearToken, getToken } from "./api";

export const STALE = {
  // Same 15s the mobile app settled on: fresh enough that another admin's
  // change shows quickly, long enough to kill refetch storms on tab focus.
  entitlement: 15_000,
  live: 0,
} as const;

// Global expired-session handling — the 401 story web previously did NOT have
// (docs/coding-standards.md M3/D4): every page hand-rolled `clearToken();
// router.replace("/login")` in its own load() catch, and any surface that
// forgot simply rendered "Unauthorized". Wiring it into the query/mutation
// caches replaces that per-page handling for everything on TanStack Query:
// any query or mutation that fails with ApiError 401 funnels here, mirroring
// admin's semantics (its request core does the same clear-token + redirect to
// /login?session=expired). Guards:
//   • member token present — public pages fetch with `auth: false` and carry
//     no token, so a tokenless 401 has no session to expire and stays a plain
//     query error for the page to render (it also makes a burst of failing
//     queries redirect only once: the first one clears the token);
//   • not already on /login — no redirect loop.
function onApiError(error: unknown): void {
  if (typeof window === "undefined") return;
  if (!(error instanceof ApiError) || error.status !== 401) return;
  if (!getToken()) return;
  clearToken();
  if (window.location.pathname !== "/login") {
    window.location.href = "/login?session=expired";
  }
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onApiError }),
    mutationCache: new MutationCache({ onError: onApiError }),
    defaultOptions: {
      queries: {
        staleTime: STALE.entitlement,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState(fn) so the client is created exactly once per mount and never
  // recreated by re-renders.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
