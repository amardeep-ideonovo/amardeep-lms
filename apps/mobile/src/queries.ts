// Typed query hooks over the api client (src/api.ts). One hook per endpoint a
// screen reads — single-reader and public screens included — so every screen's
// server state lives in the ONE shared cache: multi-reader requests are deduped
// (my-classes is fetched by Home, Classes AND Certificates), and every screen
// gets the same paint-from-cache-then-revalidate loading language.
//
// Everything here sits inside the cache's two auth-isolation invariants (see
// query.tsx): an academy switch remounts the tree into a brand-new cache, and a
// member switch on the same instance clears it. The authed entries depend on
// that for correctness; the public ones (blog, class pages) are per-instance
// content, so the remount-on-switch is what keeps THEM right too — a member
// switch merely refetches them, which is harmless. Only the CMS machinery
// (PageRenderer, PopupHost and their form/menu embeds) still fetches outside
// the cache.
import { useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { LessonDTO, SubscriptionDetailDTO } from "@lms/types";

import { api } from "./api";
import { STALE } from "./query";

// Every query key in one place, so a cache read, an invalidation and a write can
// never drift on a hand-typed string. Parameterized keys are prefixed by a stable
// segment so a broad invalidate (e.g. all `myClassCourses`) matches by prefix.
export const qk = {
  myClasses: ["myClasses"] as const,
  me: ["me"] as const,
  liveCurrent: ["liveCurrent"] as const,
  myCertificates: ["myCertificates"] as const,
  courses: ["courses"] as const,
  dashboard: ["dashboard"] as const,
  levels: ["levels"] as const,
  mySubscriptionDetails: ["mySubscriptionDetails"] as const,
  myInvoices: ["myInvoices"] as const,
  posts: ["posts"] as const,
  myClassCourses: (slugOrId: string) => ["myClassCourses", slugOrId] as const,
  classPage: (slugOrId: string) => ["classPage", slugOrId] as const,
  courseLessons: (courseId: string) => ["courseLessons", courseId] as const,
  post: (slug: string) => ["post", slug] as const,
  lesson: (lessonId: string) => ["lesson", lessonId] as const,
  liveSession: (sessionId: string) => ["liveSession", sessionId] as const,
  // Member helpdesk (guided support widget).
  helpdeskConfig: ["helpdeskConfig"] as const,
  helpdeskArticles: ["helpdeskArticles"] as const,
  helpdeskConversations: ["helpdeskConversations"] as const,
  helpdeskThread: (id: string) => ["helpdeskThread", id] as const,
};

// ---------- read hooks ----------
// Owned classes + per-class progress + locked state. Read by Home, Classes and
// Certificates — this is the fetch the cache collapses from three into one.
export function useMyClasses() {
  return useQuery({ queryKey: qk.myClasses, queryFn: api.myClasses });
}

// Signed-in member — ONE entry read by Home (greeting + avatar) and Account,
// and the slice Account's profile/avatar mutations write back into.
export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: api.me });
}

// Entitlement-filtered live sessions (Home strip + Live tab). Never stale: a
// session going live / doors opening is time-sensitive, so revalidate on every
// mount and focus.
export function useLiveCurrent() {
  return useQuery({
    queryKey: qk.liveCurrent,
    queryFn: api.liveCurrent,
    staleTime: STALE.live,
  });
}

// Earned certificates (Certificates screen + Home count).
export function useMyCertificates() {
  return useQuery({ queryKey: qk.myCertificates, queryFn: api.myCertificates });
}

// Course cards with completion counts (Course hero, best-effort).
export function useCourses() {
  return useQuery({ queryKey: qk.courses, queryFn: api.courses });
}

// A class's owned course list + certificate status. Dependent: disabled until the
// caller knows which class (Classes derives the active one from useMyClasses).
//
// ⚠ CALLERS: `enabled` only gates the AUTOMATIC fetch — `refetch()` bypasses it
// in react-query v5. Never call this query's refetch() without first checking
// that you passed a real `slugOrId`, or the queryFn builds
// `/levels/undefined/my-courses` and fires a guaranteed 404.
export function useMyClassCourses(slugOrId: string | undefined) {
  return useQuery({
    queryKey: qk.myClassCourses(slugOrId ?? ""),
    queryFn: () => api.myClassCourses(slugOrId as string),
    enabled: !!slugOrId,
  });
}

// Public marketing page for a class (hero, prices, trailer, skills). No auth.
export function useClassPage(slugOrId: string) {
  return useQuery({
    queryKey: qk.classPage(slugOrId),
    queryFn: () => api.classPage(slugOrId),
  });
}

// Lessons of a course (Course list; Lesson reads it too, on completion). Returned
// unsorted — callers sort by `order` for display, and the completion writer below
// maps over it in place, so a shared sort would only add churn.
export function useCourseLessons(courseId: string | undefined) {
  return useQuery({
    queryKey: qk.courseLessons(courseId ?? ""),
    queryFn: () => api.courseLessons(courseId as string),
    enabled: !!courseId,
  });
}

// Full category → courses breakdown (CourseList drill-down). Same endpoint the
// old dashboard tiles were built from; the screen derives one category's slice.
export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard });
}

// Every published level (Plans). Pairs with useMySubscriptionDetails below for
// the current-vs-available split.
export function useLevels() {
  return useQuery({ queryKey: qk.levels, queryFn: api.levels });
}

// The member's subscriptions (Account + Plans — one shared entry). Billing is
// best-effort everywhere it appears: a billing hiccup must never blank the
// profile or the plan list, so the queryFn keeps the long-standing catch-to-[]
// behavior — this query resolves empty instead of erroring.
export function useMySubscriptionDetails() {
  return useQuery({
    queryKey: qk.mySubscriptionDetails,
    queryFn: () =>
      api.mySubscriptionDetails().catch(() => [] as SubscriptionDetailDTO[]),
  });
}

// Invoice history (Payments).
export function useMyInvoices() {
  return useQuery({ queryKey: qk.myInvoices, queryFn: api.myInvoices });
}

// Blog list + a single post. Public (no auth) but per-instance content — the
// academy-switch remount is what keeps these right on a shared build.
export function usePosts() {
  return useQuery({ queryKey: qk.posts, queryFn: api.posts });
}

export function usePost(slug: string) {
  return useQuery({ queryKey: qk.post(slug), queryFn: () => api.post(slug) });
}

// A single lesson (Lesson player). THE entry for that lesson: the completion
// mutation snapshots and paints this exact slice, and propagateLessonComplete
// (below) keeps the course list consistent with it — so the `completed` flag
// has ONE source of truth, the cache.
export function useLesson(lessonId: string) {
  return useQuery({
    queryKey: qk.lesson(lessonId),
    queryFn: () => api.lesson(lessonId),
  });
}

// One live session's shell (join screen). Same never-stale rule as
// useLiveCurrent — the join window is time-sensitive.
export function useLiveSession(sessionId: string) {
  return useQuery({
    queryKey: qk.liveSession(sessionId),
    queryFn: () => api.liveSession(sessionId),
    staleTime: STALE.live,
  });
}

// ---------- helpers ----------
// Refetch when a screen REGAINS focus (react-navigation), skipping the first
// focus — the query's own mount fetch already covers that, and skipping it is
// what preserves the cross-screen dedupe on the opening tab sweep. react-query's
// built-in focus refetch only fires on app foreground (AppState); this adds
// screen-to-screen focus, keeping the app's long-standing "refresh on return".
export function useRefreshOnFocus(refetch: () => void): void {
  const firstTime = useRef(true);
  // Hold the latest callback in a ref so the focus subscription is set up once,
  // not re-created every render (the inline arrow callers pass is new each time).
  const cb = useRef(refetch);
  cb.current = refetch;
  useFocusEffect(
    useCallback(() => {
      if (firstTime.current) {
        firstTime.current = false;
        return;
      }
      cb.current();
    }, []),
  );
}

// After a lesson is completed, reflect it across the cache so screens the member
// navigates back to are already right:
//   • the course's lesson list flips THIS lesson's ✓ in place — instant, no
//     refetch, so backing out to the Course screen shows it done immediately;
//   • class/course progress counts and certificate grants are INVALIDATED, so
//     they refetch server-truthed in the background. Counts and grants are the
//     server's call and are never derived optimistically on the client.
// Called only on a confirmed 200 from /complete — never on the optimistic tap.
export function propagateLessonComplete(
  queryClient: QueryClient,
  courseId: string,
  lessonId: string,
): void {
  queryClient.setQueryData<LessonDTO[]>(qk.courseLessons(courseId), (prev) =>
    prev
      ? prev.map((l) => (l.id === lessonId ? { ...l, completed: true } : l))
      : prev,
  );
  void queryClient.invalidateQueries({ queryKey: qk.myClasses });
  void queryClient.invalidateQueries({ queryKey: qk.courses });
  // Prefix match: every ["myClassCourses", <slug>] entry.
  void queryClient.invalidateQueries({ queryKey: ["myClassCourses"] });
  void queryClient.invalidateQueries({ queryKey: qk.myCertificates });
}

// ---------- member helpdesk ----------

// First-screen config (greeting, open requests, unread). Authed; short stale so
// a newly-opened/answered request reflects fast (matches web's 15s).
export function useHelpdeskConfig() {
  return useQuery({
    queryKey: qk.helpdeskConfig,
    queryFn: api.helpdeskConfig,
    staleTime: STALE.entitlement,
  });
}

// This academy's published FAQ — listed on Support home, fed to the composer's
// router, and read by the article screen. Gated so it only loads with support.
export function useHelpdeskArticles(enabled: boolean) {
  return useQuery({
    queryKey: qk.helpdeskArticles,
    queryFn: api.helpdeskArticles,
    enabled,
  });
}

// The member's own conversations (the "My requests" list). Only fetched when
// the helpdesk screen is mounted, so gate with `enabled`.
export function useHelpdeskConversations(enabled: boolean) {
  return useQuery({
    queryKey: qk.helpdeskConversations,
    queryFn: async () => (await api.helpdeskMyConversations()).items,
    enabled,
  });
}

// One conversation thread; polled while the screen shows it so an admin reply
// appears without a manual pull-to-refresh. `enabled` gates the AUTOMATIC fetch
// only — never call refetch() with a null id.
export function useHelpdeskThread(id: string | null) {
  return useQuery({
    queryKey: qk.helpdeskThread(id ?? "none"),
    queryFn: () => api.helpdeskThread(id as string),
    enabled: !!id,
    refetchInterval: id ? 10_000 : false,
  });
}
