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
import type {
  ClassExtrasDTO,
  ClassTileDTO,
  CourseCard,
  LessonDTO,
} from "@lms/types";

import { api, getCachedMe, getToken, setCachedMe } from "./api";
import { readMemberCache, writeMemberCache } from "./member-cache";
import { fetchMemberDashboard } from "./memberData";

export const qk = {
  memberDashboard: ["memberDashboard"] as const,
  me: ["me"] as const,
  mySubscriptions: ["mySubscriptions"] as const,
  myInvoices: ["myInvoices"] as const,
  myCertificates: ["myCertificates"] as const,
  // Parameterized keys: the stable "courseLessons" prefix lets a broad
  // invalidate (all courses) match by prefix; the id scopes a single course.
  courses: ["courses"] as const,
  courseLessons: (courseId: string) => ["courseLessons", courseId] as const,
};

// localStorage snapshot keys (lib/member-cache.ts): the dashboard payload and
// the certificate list are seeded as initialData so a reload paints the REAL
// page instantly instead of a skeleton, then the normal staleTime-driven
// refetch revalidates in the background and updates in place. The query cache
// itself is memory-only (rebuilt every page load) — these snapshots are what
// carry the last-known answer across reloads. extras is a Map at runtime, so
// it round-trips through the snapshot as a plain object.
const DASH_CACHE_KEY = "dash";
const CERTS_CACHE_KEY = "certs";
type DashSnapshot = {
  classes: ClassTileDTO[];
  extras: Record<string, ClassExtrasDTO>;
};
type CertsSnapshot = Awaited<ReturnType<typeof api.myCertificates>>;

// Class tiles + per-class enrichment (counts, next lesson) in ONE request.
// fetchMemberDashboard is the single call that replaced the 17-request
// per-class fan-out (PR #44). Read by /dashboard, /classes and /certificates;
// a focus refetch revalidates in the background and updates in place instead
// of discarding the rendered page.
export function useMemberDashboard() {
  return useQuery({
    queryKey: qk.memberDashboard,
    queryFn: async () => {
      const d = await fetchMemberDashboard();
      writeMemberCache<DashSnapshot>(DASH_CACHE_KEY, getToken(), {
        classes: d.classes,
        extras: Object.fromEntries(d.extras),
      });
      return d;
    },
    initialData: () => {
      const c = readMemberCache<DashSnapshot>(DASH_CACHE_KEY, getToken());
      if (!c) return undefined;
      return {
        classes: c.data.classes,
        extras: new Map(Object.entries(c.data.extras ?? {})),
      };
    },
    // Stamp the snapshot's real age so staleTime still triggers the background
    // refetch — initial data without a timestamp would count as fresh.
    initialDataUpdatedAt: () =>
      readMemberCache<DashSnapshot>(DASH_CACHE_KEY, getToken())?.t,
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
    // Paint the cached profile immediately; updatedAt 0 marks it stale so the
    // live /auth/me still fires right away and reconciles in place.
    initialData: () => getCachedMe() ?? undefined,
    initialDataUpdatedAt: 0,
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
// Snapshot-seeded like the dashboard so the count/grid paint instantly.
export function useMyCertificates() {
  return useQuery({
    queryKey: qk.myCertificates,
    queryFn: async () => {
      const list = await api.myCertificates();
      writeMemberCache<CertsSnapshot>(CERTS_CACHE_KEY, getToken(), list);
      return list;
    },
    initialData: () =>
      readMemberCache<CertsSnapshot>(CERTS_CACHE_KEY, getToken())?.data,
    initialDataUpdatedAt: () =>
      readMemberCache<CertsSnapshot>(CERTS_CACHE_KEY, getToken())?.t,
  });
}

// ---------- course page (/courses/[id]) ----------
// The course page needs two reads: the course card (cover/title/meta/progress)
// and its ordered lessons. Both are snapshot-seeded like the dashboard so the
// Ink Hero page paints instantly on a repeat visit and revalidates in place —
// the same instant-paint the class page gets from member-cache, now behind the
// standard TanStack layer (global 401 handling, focus revalidation).

const COURSES_CACHE_KEY = "courses";
const courseLessonsCacheKey = (courseId: string) => `courseLessons:${courseId}`;

// All courses the member can access. The course page finds its one course here
// (there is no single-course member endpoint); the list is small and shared, so
// caching it also warms any sibling course link.
export function useCourses() {
  return useQuery({
    queryKey: qk.courses,
    queryFn: async () => {
      const list = await api.courses();
      writeMemberCache<CourseCard[]>(COURSES_CACHE_KEY, getToken(), list);
      return list;
    },
    initialData: () =>
      readMemberCache<CourseCard[]>(COURSES_CACHE_KEY, getToken())?.data,
    initialDataUpdatedAt: () =>
      readMemberCache<CourseCard[]>(COURSES_CACHE_KEY, getToken())?.t,
  });
}

// A course's lessons, ordered. A 403 (course locked for this member) surfaces
// as the query error for the page to render its locked state; a 401 is handled
// globally (lib/query.tsx). Sorted in the queryFn so the snapshot is stored
// already-ordered and every reader gets the same sequence.
export function useCourseLessons(courseId: string) {
  return useQuery({
    queryKey: qk.courseLessons(courseId),
    queryFn: async () => {
      const list = await api.courseLessons(courseId);
      const ordered = [...list].sort((a, b) => a.order - b.order);
      writeMemberCache<LessonDTO[]>(
        courseLessonsCacheKey(courseId),
        getToken(),
        ordered,
      );
      return ordered;
    },
    initialData: () =>
      readMemberCache<LessonDTO[]>(courseLessonsCacheKey(courseId), getToken())
        ?.data,
    initialDataUpdatedAt: () =>
      readMemberCache<LessonDTO[]>(courseLessonsCacheKey(courseId), getToken())
        ?.t,
  });
}
