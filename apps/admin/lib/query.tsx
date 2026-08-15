"use client";

// TanStack Query provider for the admin app (docs/coding-standards.md D4,
// roadmap P4). Mirrors the mobile app's proven config — apps/mobile/src/
// query.tsx is the house pattern: one client per mount, a short stale window,
// no retries on 4xx (ApiError carries status; a 403/404 won't change on
// retry), no mutation retries (mutations are never safe to blind-repeat).
//
// Adoption state (D4, complete for the admin): new pages use useQuery from
// day one; the dedupe singletons are hooks in lib/queries.ts (which owns the
// `qk` registry); mutations use useMutation with the lib/mutations.ts glue.
// The ONE deliberate exception is lib/useOptimisticAction.ts — the narrow
// primitive for dynamic-entity-key serialized optimistic writes on the
// realtime projects board, a shape v5 mutation scopes cannot express (its
// header has the full argument). The board's reads also stay socket-fed
// local state on purpose: on a realtime surface the socket stream is the
// freshness authority, and a parallel query cache would be a second one.

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
