"use client";

// Typed query hooks over the api client (lib/api.ts) for the member web app
// (docs/coding-standards.md D4, roadmap P4). Mirrors apps/admin/lib/queries.ts
// and apps/mobile/src/queries.ts: every query key lives in the single `qk`
// object so a cache read, an invalidation and a write can never drift on a
// hand-typed string. Keys are plain arrays; when a parameterized key is added
// (none yet), prefix it with a stable segment — ["thing", id] as const — so a
// broad invalidate (all "thing" entries) matches by prefix.
//
// These hooks are the member-site reads: the dashboard payload (shared by
// /dashboard, /classes and /certificates — the cache collapses three visits
// into one request per stale window), the signed-in profile, and the /account
// billing reads. A page-local read added later may keep its useQuery call in
// the page but MUST take its key from `qk`.
//
// Auth: every endpoint here requires the member token, and the pages that
// mount these sit behind <AuthGate>, so a token exists before the first
// automatic fetch — no per-hook `enabled` gating is needed. An expired/revoked
// token 401s and is handled globally by the query client (lib/query.tsx):
// clear token, redirect to /login?session=expired. ⚠ If a dependent read is
// added, remember `enabled` only gates the AUTOMATIC fetch — `refetch()`
// bypasses it in react-query v5; prefer
// `queryClient.invalidateQueries({ queryKey: qk.x })`, which respects
// `enabled`, over calling refetch() directly.

import { useQuery } from "@tanstack/react-query";

import { api, setCachedMe } from "./api";
import { fetchMemberDashboard } from "./memberData";

export const qk = {
  memberDashboard: ["memberDashboard"] as const,
  me: ["me"] as const,
  mySubscriptions: ["mySubscriptions"] as const,
  myInvoices: ["myInvoices"] as const,
  myCertificates: ["myCertificates"] as const,
};

// Class tiles + per-class enrichment (counts, next lesson) in ONE request.
// fetchMemberDashboard is the single call that replaced the 17-request
// per-class fan-out (PR #44) and stays the queryFn verbatim. Read by
// /dashboard, /classes and /certificates; a focus refetch revalidates in the
// background and updates in place instead of discarding the rendered page.
export function useMemberDashboard() {
  return useQuery({
    queryKey: qk.memberDashboard,
    queryFn: fetchMemberDashboard,
  });
}

// Signed-in member (dashboard greeting + /account details). The queryFn also
// refreshes the localStorage me-cache — same as the old dashboard fetch — so
// the nav avatar/greeting paint instantly on the next hard reload. /account's
// profile mutations write their responses back with
// `queryClient.setQueryData(qk.me, updated)` instead of refetching.
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      const u = await api.me();
      setCachedMe(u);
      return u;
    },
  });
}

// Enriched subscriptions — actual price/interval per plan — for /account's
// plan tiles (the endpoint is /billing/subscription-details). Consumers render
// `data ?? []`: loading and load errors alike show the no-plan state, exactly
// as the old catch-to-[] did. The member cancel flow writes the server's
// updated list back via `queryClient.setQueryData(qk.mySubscriptions, …)`.
export function useMySubscriptions() {
  return useQuery({
    queryKey: qk.mySubscriptions,
    queryFn: () => api.mySubscriptionDetails(),
  });
}

// The member's full payment history (/account/payments).
export function useMyInvoices() {
  return useQuery({ queryKey: qk.myInvoices, queryFn: () => api.myInvoices() });
}

// Earned class-completion certificates (/certificates grid + dashboard count).
export function useMyCertificates() {
  return useQuery({
    queryKey: qk.myCertificates,
    queryFn: () => api.myCertificates(),
  });
}
