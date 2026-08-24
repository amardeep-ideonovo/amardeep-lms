// Shared member-screen data helpers for the Ink Hero screens (dashboard,
// /classes, /certificates): per-class enrichment (course/lesson counts + the
// next incomplete lesson) computed from the existing member endpoints, plus
// small formatting utilities. No new API surface.
import type { ClassExtrasDTO, ClassTileDTO } from "@lms/types";
import { api } from "./api";

// The server now computes these; the local aliases keep the call sites stable.
export type NextLessonInfo = NonNullable<ClassExtrasDTO["next"]>;
export type ClassExtras = ClassExtrasDTO;

/** Percent complete for an owned class tile (0 when no progress data). */
export function classPct(cls: ClassTileDTO): number {
  const p = cls.progress;
  if (!p || p.total <= 0) return 0;
  return Math.round((p.completed / p.total) * 100);
}

/**
 * Lesson-weighted completion across the given (owned) classes — the "journey" %.
 * Pools every completed lesson over every lesson so each class counts in
 * proportion to its length, rather than averaging per-class percentages (which
 * over-weighted a done 1-lesson class against an untouched 5-lesson one). This
 * matches the class/course-detail rings here and the mobile dashboard, so the
 * headline figure is the same number everywhere. A class with null/zero-lesson
 * progress contributes nothing (0/0) to the ratio.
 */
export function overallPct(owned: ClassTileDTO[]): number {
  const totals = owned.reduce(
    (acc, c) => ({
      done: acc.done + (c.progress?.completed ?? 0),
      total: acc.total + (c.progress?.total ?? 0),
    }),
    { done: 0, total: 0 },
  );
  return totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;
}

/** "9:10" from seconds; null when unknown so callers can omit the segment. */
export function fmtDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Total runtime as "1h 47m" / "28 min"; null when unknown. */
export function fmtTotalMinutes(
  seconds: number | null | undefined,
): string | null {
  if (!seconds || seconds <= 0) return null;
  const totalMin = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

/** Time-of-day greeting for the dashboard band. */
export function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Tiles + per-class enrichment in ONE request.
 *
 * This replaces a client-side fan-out that issued up to 17 calls per visit —
 * my-classes, then my-courses for each owned class, then course-lessons for
 * each of those — and re-ran the whole thing on every tab focus. The server
 * computes the same numbers in a fixed number of queries.
 */
export async function fetchMemberDashboard(): Promise<{
  classes: ClassTileDTO[];
  extras: Map<string, ClassExtras>;
}> {
  const res = await api.myDashboard();
  return {
    classes: res.classes,
    extras: new Map(Object.entries(res.extras ?? {})),
  };
}

/** Stable class-color cycle: accent slot → class-c{0..5}. */
export function classColorClass(index: number): string {
  return `class-c${((index % 6) + 6) % 6}`;
}

// Accent-slot selection lives in @lms/types now — the single source across
// web/admin/mobile (docs/coding-standards.md D2; this file was one of three
// verbatim copies). Re-exported here so existing web imports stay stable;
// `classIndexMap` is the shared `accentIndexMap` under its original web name.
export { classAccentIndex, accentIndexMap as classIndexMap } from "@lms/types";
