# Mobile web-parity redesign — implementation plan

Bring the mobile Class / Course / Lesson / Dashboard / Account screens in line with
the web member site's "Ink Hero" design: one consistent **taller full-bleed header**
with the **first content block overlapping up into it**, web-style lesson rows, a
**contained** Lesson video that overlaps its header, and a **brand-dynamic bottom nav**.

Mocks reviewed and approved 2026-09-13; decisions: **keep photo heroes** on
Class/Course, **reuse `primary`** for the nav, **Option B** for Class inline lessons
(extend the API so the class page shows per-course lesson rows).

## Non-goals

Classes-list tab, Live, Helpdesk, Blog, auth screens; any billing/checkout change;
the Vimeo player's own controls (like / watch-later / share are native — untouched).

## Design-system reuse (no new color tokens)

Everything derives from existing `apps/mobile/src/theme.ts` tokens: `chrome` /
`onChrome` / `onChromeSoft` (chrome bands), `heroText` / `heroTextSoft` / `overlay*`
(photo scrims), `primaryOnDark` (ring/eyebrow on dark), `primarySoft` + `primary`
(nav + progress), `ctaStart` / `ctaEnd` / `onCta` (CTAs), `inkCard` (navy
"Your progress" / "Up next" cards). Content stays capped at `CONTENT_MAX_WIDTH`
(700) on tablets while the image bleeds full width (band vs `bandInner` pattern from
`DashboardScreen`).

## New shared components

| Component        | Purpose                                                                                        | Reused by                         |
| ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------- |
| `HeroScaffold`   | Full-bleed header: photo+scrim or chrome fill; safe-area top padding; reserved overlap padding | Class, Course, Lesson, Dash, Acct |
| `HeroBackButton` | Floating circular back chevron (safe-area aware) for pushed screens with no nav bar            | Class, Course, Lesson             |
| `LessonRow`      | Thumb + "Lesson N" + title + duration + trailing state (RESUME / play / ✓) + current highlight | Course, Lesson, Class             |
| `OverlapBody`    | Small `marginTop:-N` + z-index + gutter wrapper                                                | all five                          |

## Per-screen changes

- **`App.tsx`** — `MainTabs`: `tabBarActiveTintColor` → `colors.primarySoft`;
  `TabIcon` pill → `colors.primary`. `AppNavigator`: Class/Course/Lesson →
  `headerShown: false`; each renders its own `HeroBackButton` + `<StatusBar
style="light">` (dark heroes).
- **`ClassScreen.tsx`** — inset `classHero` → full-bleed `HeroScaffold` (photo +
  navy scrim + breadcrumb + category chip + title + meta + `ProgressRing`); overlap
  body; `CourseRow` list → course accordion (mint header + "Course N" chip + status
  pill + inline `LessonRow`s from the extended API).
- **`CourseScreen.tsx`** — inset hero → full-bleed `HeroScaffold`; overlap the mint
  "Lessons" panel; rows → `LessonRow` (duration + RESUME/play + current highlight).
  Data already available via `useCourseLessons`.
- **`LessonScreen.tsx`** — native nav bar → navy `HeroScaffold` band (breadcrumb +
  title + "Lesson N of M"); video stays **contained** but overlaps the band; add the
  full "lessons in course" card (`useCourseLessons(courseId)`) + navy "Up next" card;
  drop the duplicated title.
- **`AccountScreen.tsx`** — `brandHeader` → chrome-band profile hero (brand row +
  avatar + name + email + plan chip); overlap the "Your details" card.
- **`DashboardScreen.tsx`** — already has the chrome band + overlap + safe-area; align
  header height/overlap to the shared metric; picks up the nav change for free.

## Option B — Class inline lessons (API extension)

`myClassCourses` returns `CourseCard[]` (counts only). To show inline lesson rows on
the class page (as mocked) without an N+1 fan-out:

- **`packages/types/index.ts`** — add:

  ```ts
  export interface ClassCourseLessonDTO {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    order: number;
    completed: boolean;
    started: boolean;
  }
  export interface ClassCourseDTO extends CourseCard {
    lessons: ClassCourseLessonDTO[];
  }
  // MyClassCoursesDTO.courses: CourseCard[]  ->  ClassCourseDTO[]
  ```

  `ClassCourseDTO extends CourseCard`, so every existing reader (mobile and web) still
  type-checks; only the value gains a `lessons` array.

- **`apps/api/src/levels/levels.service.ts` (`myClassCourses`)** — one added grouped
  query: the courses' lessons (`id, title, thumbnailUrl, durationSeconds, order`) +
  this member's `completed` / `started` flags, attached per course, ordered by
  `order`. Stays a single request (consistent with the anti-fan-out design behind
  `MemberDashboardDTO`).

- **Mobile** — `api.myClassCourses` types flow through; `ClassScreen` renders
  `course.lessons` with `LessonRow` (tap -> `Lesson`), current row from
  `started && !completed`.

## Sequencing (PR-sized chunks)

1. **Bottom nav** (`App.tsx`) — done.
2. **Shared primitives** (`HeroScaffold`, `HeroBackButton`, `LessonRow`).
3. **Lesson** → 4. **Course** → 5. **Account** → 6. **Dashboard** → 7. **Class** (7a: types + `levels.service`; 7b: `ClassScreen`).

## Testing / verification

Type-check + existing mobile tests (302 api / 59 mobile green baseline); run each
screen in the iOS simulator (same account) and compare against the approved mocks;
check tablet width (image bleeds, content capped at 700); verify StatusBar contrast
on light chrome and dark heroes; confirm the nav re-tints if `primary` changes in App
Customization. Keep `prettier --check .` clean (hard CI gate) and eslint warning-free.

## Risks / open questions

- `headerShown:false` means we own the back button + safe-area — verify on notch +
  Dynamic Island devices; the OS back-swipe still works.
- Lesson overlap is navy-on-navy (intentionally subtle) — a hairline is a one-line add.
- Class-page payload grows by lightweight lesson rows (no bodies) — acceptable, one
  request.
