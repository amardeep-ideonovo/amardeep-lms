// Shared member-screen data helpers for the Ink Hero screens (dashboard,
// /classes, /certificates): per-class enrichment (course/lesson counts + the
// next incomplete lesson) computed from the existing member endpoints, plus
// small formatting utilities. No new API surface.
import type { ClassTileDTO, LessonDTO } from "@lms/types";
import { api } from "./api";

export interface NextLessonInfo {
  lesson: LessonDTO;
  courseTitle: string;
  courseThumb: string | null;
}

export interface ClassExtras {
  courseCount: number;
  lessonTotal: number;
  /** courses that still have incomplete lessons */
  coursesLeft: number;
  /** lessons not yet completed (from the course counters) */
  lessonsLeft: number;
  /** the next incomplete lesson to resume (null when class is done/empty) */
  next: NextLessonInfo | null;
}

/** Percent complete for an owned class tile (0 when no progress data). */
export function classPct(cls: ClassTileDTO): number {
  const p = cls.progress;
  if (!p || p.total <= 0) return 0;
  return Math.round((p.completed / p.total) * 100);
}

/** Average completion across the given (owned) classes — the "journey" %. */
export function overallPct(owned: ClassTileDTO[]): number {
  const withProgress = owned.filter((c) => c.progress && c.progress.total > 0);
  if (withProgress.length === 0) return 0;
  const sum = withProgress.reduce((n, c) => n + classPct(c), 0);
  return Math.round(sum / withProgress.length);
}

/** "9:10" from seconds; null when unknown so callers can omit the segment. */
export function fmtDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Total runtime as "1h 47m" / "28 min"; null when unknown. */
export function fmtTotalMinutes(seconds: number | null | undefined): string | null {
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

async function loadExtras(cls: ClassTileDTO): Promise<ClassExtras | null> {
  try {
    const res = await api.myClassCourses(cls.slug ?? cls.id);
    const courses = res.courses;
    const courseCount = courses.length;
    const lessonTotal = courses.reduce((n, c) => n + c.lessonCount, 0);
    const lessonsDone = courses.reduce((n, c) => n + c.completedCount, 0);
    const coursesLeft = courses.filter(
      (c) => c.lessonCount === 0 || c.completedCount < c.lessonCount,
    ).length;

    let next: NextLessonInfo | null = null;
    const target = courses.find(
      (c) => c.lessonCount > 0 && c.completedCount < c.lessonCount,
    );
    if (target) {
      try {
        const lessons = await api.courseLessons(target.id);
        const sorted = [...lessons].sort((a, b) => a.order - b.order);
        const lesson = sorted.find((l) => !l.completed) ?? sorted[0];
        if (lesson) {
          next = {
            lesson,
            courseTitle: target.title,
            courseThumb: target.thumbnailUrl ?? target.coverImageUrl ?? null,
          };
        }
      } catch {
        /* lesson detail is progressive enhancement — counts still render */
      }
    }
    return {
      courseCount,
      lessonTotal,
      coursesLeft,
      lessonsLeft: Math.max(0, lessonTotal - lessonsDone),
      next,
    };
  } catch {
    return null;
  }
}

/**
 * Enrich OWNED classes with course/lesson counts + the next lesson to resume.
 * Parallel, capped, best-effort: a failed class simply has no extras and the
 * caller falls back to the tile's own progress numbers. Not cached — the
 * member screens refetch on focus and progress changes often.
 */
export async function fetchClassExtras(
  classes: ClassTileDTO[],
  cap = 8,
): Promise<Map<string, ClassExtras>> {
  const owned = classes.filter((c) => c.owned).slice(0, cap);
  const results = await Promise.all(owned.map((c) => loadExtras(c)));
  const map = new Map<string, ClassExtras>();
  owned.forEach((c, i) => {
    const r = results[i];
    if (r) map.set(c.id, r);
  });
  return map;
}

/** Stable class-color cycle: accent slot → class-c{0..5}. */
export function classColorClass(index: number): string {
  return `class-c${((index % 6) + 6) % 6}`;
}

/**
 * Accent slots (globals.css: 0 amber · 1 violet · 2 green · 3 red · 4 blue ·
 * 5 sea) are picked by subject keyword rather than list position, because the
 * API lists classes alphabetically and a pure position cycle would re-color
 * every class whenever one is added or renamed. Unmatched classes fall back to
 * the position cycle, so an arbitrary client catalog still looks deliberate.
 *
 * Order matters — first match wins. The seeded demo catalog is listed first
 * (music/food/sports/technology → amber/violet/green/blue, which is what
 * assets/generate-demo-art.ts paints its artwork to match); the rest are
 * common subjects a client catalog might use. Comedy precedes film so
 * "Film & TV · Comedy" lands on sea, not red.
 *
 * Keep this list in sync with apps/admin/lib/class-accent.ts and
 * apps/mobile/src/class-colors.ts — three copies, no shared package.
 */
const ACCENT_KEYWORDS: Array<[RegExp, number]> = [
  [/music|song/i, 0],
  [/cook|food|culinary|kitchen|flavor|baking/i, 1],
  [/sport|fitness|athlet|strength|conditioning/i, 2],
  [/technolog|software|coding|web develop|developer|programming/i, 4],
  [/comedy|stand.?up/i, 5],
  [/photo/i, 2],
  [/film|cinema|screen|tv/i, 3],
  [/dance|choreo/i, 4],
];

export function classAccentIndex(
  name: string,
  categories: string[],
  fallback: number,
): number {
  const hay = `${name} ${categories.join(" ")}`;
  for (const [re, idx] of ACCENT_KEYWORDS) if (re.test(hay)) return idx;
  return ((fallback % 6) + 6) % 6;
}

/** id → accent slot for color mapping (category-keyed, position fallback). */
export function classIndexMap(classes: ClassTileDTO[]): Map<string, number> {
  const m = new Map<string, number>();
  classes.forEach((c, i) =>
    m.set(
      c.id,
      classAccentIndex(c.name, (c.categories ?? []).map((x) => x.name), i),
    ),
  );
  return m;
}
