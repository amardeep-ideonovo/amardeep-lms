"use client";

// TanStack Query provider for the admin app (docs/coding-standards.md D4,
// roadmap P4). Mirrors the mobile app's proven config — apps/mobile/src/
// query.tsx is the house pattern: one client per mount, a short stale window,
// no retries on 4xx (ApiError carries status; a 403/404 won't change on
// retry), no mutation retries (mutations are never safe to blind-repeat).
//
// Adoption order (D4): new pages use useQuery from day one; the module-level
// cached+inflight dedupe singletons (app-brand, FormPickerField,
// MenuPickerField) migrated first (they are now hooks in lib/queries.ts, which
// also owns the `qk` query-key registry), then the heavy list surfaces, then
// useOptimisticAction is replaced by useMutation + onMutate snapshot/rollback.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@lms/types";

export const STALE = {
  // Same 15s the mobile app settled on: fresh enough that another admin's
  // change shows quickly, long enough to kill refetch storms on tab focus.
  entitlement: 15_000,
  live: 0,
  // Instance branding (app title): ~never changes, and its readers (sidebar,
  // login card) are mounted all day — a long window stops focus refetches
  // while an edited title still lands within a minute.
  brand: 60_000,
} as const;

function makeQueryClient() {
  return new QueryClient({
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
