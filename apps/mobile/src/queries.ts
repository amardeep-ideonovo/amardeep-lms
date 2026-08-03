// Typed query hooks over the api client (src/api.ts). One hook per endpoint that
// more than one screen reads, so the shared cache dedupes the request and every
// reader paints from — and revalidates against — the same entry.
//
// What is NOT here: purely-public leaf screens (Blog, Page, Plans, Payments,
// LiveSession) still fetch locally — they share nothing and gain nothing from the
// cache. And the Account screen keeps its own `me` fetch (its forms/mutations are
// intricate); Home revalidates `me` on focus, so profile edits still propagate.
import { useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { LessonDTO } from "@lms/types";

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
  myClassCourses: (slugOrId: string) => ["myClassCourses", slugOrId] as const,
  classPage: (slugOrId: string) => ["classPage", slugOrId] as const,
  courseLessons: (courseId: string) => ["courseLessons", courseId] as const,
};

// ---------- read hooks ----------
// Owned classes + per-class progress + locked state. Read by Home, Classes and
// Certificates — this is the fetch the cache collapses from three into one.
export function useMyClasses() {
  return useQuery({ queryKey: qk.myClasses, queryFn: api.myClasses });
}

// Signed-in member (greeting + avatar on Home). Account owns its own copy.
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
