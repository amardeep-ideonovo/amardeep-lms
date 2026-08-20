"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  ClassCertificateStatusDTO,
  CourseCard,
  LessonDTO,
  LiveSessionBarDTO,
} from "@lms/types";
import { ApiError, api, getToken } from "@/lib/api";
import { readMemberCache, writeMemberCache } from "@/lib/member-cache";
import { fmtDuration, fmtTotalMinutes } from "@/lib/memberData";
import CertificateClaimButton from "@/components/CertificateClaimButton";
import { BandRing, CertRing } from "@/components/ProgressRing";
import { CheckIcon, PlayGlyph } from "@/components/LessonGlyphs";

// This component is SSR'd (the skeleton + skills are the crawlable output), so
// the cache seed must run in a layout effect — client-only, but BEFORE the
// browser paints — never in a useState initializer (hydration mismatch).
// useLayoutEffect on the server is a no-op that React warns about; alias it.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Last-known ownership snapshot per class (lib/member-cache.ts): lets a repeat
// visit paint the member's courses — or the guest marketing — instantly and
// revalidate in the background, instead of holding the whole section blank for
// the my-courses round-trip on every load.
type OwnershipSnapshot = {
  owned: boolean;
  courses: CourseCard[];
  certificate: ClassCertificateStatusDTO | null;
  lessons: Record<string, LessonDTO[]>;
};
const classCacheKey = (slugOrId: string) => `class:${slugOrId}`;

// Vimeo URL -> player embed URL; null for non-Vimeo (then we use <video>).
// title/byline/portrait are suppressed for the same reason the lesson player
// suppresses them: the overlay credits the VIMEO ACCOUNT that uploaded the
// clip, which on a client's own trailer is someone else's name over their
// class.
function vimeoEmbed(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m
    ? `https://player.vimeo.com/video/${m[1]}?title=0&byline=0&portrait=0`
    : null;
}

type Slot = "hero-ring" | "body";
type Props = {
  slugOrId: string;
  name: string;
  checkoutHref: string;
  priceLabel: string | null;
  trailerUrl: string | null;
  lessonCount: number;
  totalLabel: string;
  slot: Slot;
  description?: string | null;
  imageUrl?: string | null;
  // Server-rendered "Skills You'll Learn" markup (slot="body" only) — stays in
  // the SSR output so crawlers index it; owners get it below their courses.
  skills?: React.ReactNode;
};

type Ownership = {
  owned: boolean;
  courses: CourseCard[];
  certificate: ClassCertificateStatusDTO | null;
};

const GUEST: Ownership = { owned: false, courses: [], certificate: null };

// A THROWN error from myClassCourses is never a legit "not owned" — the API
// returns 200 `{ owned: false }` for that. A throw means we couldn't reach/read
// the API: a transient network blip, or (the bug this guards) apiBase() falling
// back to localhost because window.__ENV__ / the runtime origin hadn't resolved
// yet on a cold load. So retry a few times (letting the env settle); if the
// network never settles, REJECT — the caller then keeps its cache-seeded
// snapshot (a flaky connection must not downgrade a member to the guest
// marketing) and only falls back to guest when it has nothing at all. A
// 401/404 is authoritative (bad token / class gone) and resolves guest.
async function fetchOwnership(slugOrId: string): Promise<Ownership> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await api.myClassCourses(slugOrId);
      return {
        owned: res.owned,
        courses: res.courses,
        certificate: res.certificate ?? null,
      };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404))
        return GUEST;
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}

// In-flight de-dup so the two instances (hero ring + body) share ONE request,
// while a later remount (e.g. returning after completing a lesson) refetches
// fresh progress instead of reading a stale forever-cache.
const inflight = new Map<string, Promise<Ownership>>();
function resolveOwnership(slugOrId: string): Promise<Ownership> {
  if (!getToken()) return Promise.resolve(GUEST);
  let p = inflight.get(slugOrId);
  if (!p) {
    p = fetchOwnership(slugOrId);
    inflight.set(slugOrId, p);
    void p.finally(() => {
      setTimeout(() => inflight.delete(slugOrId), 0);
    });
  }
  return p;
}

/* ---------- tiny icons (paths from the frames) ---------- */
// CheckIcon + PlayGlyph now live in components/LessonGlyphs.tsx (shared with the
// course page). ChevronIcon stays here — only the course accordion header uses it.
const ChevronIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="m9 6 6 6-6 6"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ---------- one course accordion card with lesson rows (frame 2c) ---------- */
function CourseAccordion({
  course,
  index,
  lessons,
  currentLessonId,
}: {
  course: CourseCard;
  index: number;
  lessons: LessonDTO[] | null;
  currentLessonId: string | null;
}) {
  const pct = course.lessonCount
    ? Math.round((course.completedCount / course.lessonCount) * 100)
    : 0;
  const done =
    course.lessonCount > 0 && course.completedCount >= course.lessonCount;
  // "In progress" the moment ANY lesson is opened — startedCount counts started
  // lessons (completed included), so this no longer waits for a completion.
  const started = (course.startedCount ?? 0) > 0 || course.completedCount > 0;
  const mins =
    lessons && lessons.length > 0
      ? fmtTotalMinutes(
          lessons.reduce((n, l) => n + (l.durationSeconds ?? 0), 0),
        )
      : null;
  const meta = [
    `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`,
    mins,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="ik-panel ik-panel--snug">
      <Link
        href={`/courses/${course.slug || course.id}`}
        className="ik-course-head"
        aria-label={`Open course: ${course.title}`}
      >
        <span className="ik-course-num">Course {index + 1}</span>
        {course.thumbnailUrl || course.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={course.thumbnailUrl ?? course.coverImageUrl ?? ""}
            alt=""
            className="ik-course-thumb"
          />
        ) : (
          <span className="ik-course-thumb" aria-hidden="true" />
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <div className="ik-course-name">{course.title}</div>
          <div className="ik-course-meta">{meta}</div>
        </span>
        {done ? (
          <span className="ik-pill ik-pill--done">Completed</span>
        ) : started ? (
          <span className="ik-pill ik-pill--pct">
            {pct > 0 ? `${pct}%` : "In progress"}
          </span>
        ) : (
          <span className="ik-pill ik-pill--todo">Not started</span>
        )}
        <span className="ik-course-go">
          <ChevronIcon />
        </span>
      </Link>
      {lessons === null ? (
        <div className="ik-lesson-group">
          {/* One skeleton row per real lesson (the count is on the course
              card), so the accordion doesn't grow when the rows land. */}
          {Array.from(
            { length: Math.max(1, Math.min(course.lessonCount || 2, 6)) },
            (_, i) => i,
          ).map((i) => (
            <div key={i} className="ik-lesson">
              <span className="ik-lesson-num" aria-hidden="true" />
              <span className="ik-skel" style={{ width: 56, height: 38 }} />
              <span className="ik-lesson-main">
                <span
                  className="ik-skel"
                  style={{ width: "60%", height: 13 }}
                />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ik-lesson-group">
          {lessons.map((l, i) => {
            const isCurrent = l.id === currentLessonId;
            const dur = fmtDuration(l.durationSeconds);
            return (
              <Link
                key={l.id}
                href={`/lessons/${l.id}`}
                className={
                  isCurrent ? "ik-lesson ik-lesson--current" : "ik-lesson"
                }
              >
                <span className="ik-lesson-num" aria-hidden="true">
                  Lesson {i + 1}
                </span>
                {l.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.thumbnailUrl}
                    alt=""
                    className="ik-lesson-thumb"
                  />
                ) : (
                  <span className="ik-lesson-thumb" aria-hidden="true" />
                )}
                <span className="ik-lesson-main">
                  <span className="ik-lesson-title">{l.title}</span>
                  {dur && <span className="ik-lesson-dur">{dur}</span>}
                </span>
                {l.completed ? (
                  <span className="ik-lesson-state ik-lesson-state--done">
                    <CheckIcon />
                  </span>
                ) : l.started ? (
                  <span className="ik-resume-pill">RESUME</span>
                ) : isCurrent ? (
                  <span className="ik-start-pill">START</span>
                ) : (
                  <span className="ik-lesson-state ik-lesson-state--todo">
                    <PlayGlyph />
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- upcoming live session for THIS class (white rail card) ---------- */
function ClassLiveCard({
  className,
  imageUrl,
}: {
  className: string;
  imageUrl: string | null;
}) {
  const [session, setSession] = useState<LiveSessionBarDTO | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .liveCurrent()
      .then((list) => {
        if (!alive) return;
        const match = list.find(
          (s) =>
            s.audienceLabel === "All members" ||
            s.audienceLabel.toLowerCase().includes(className.toLowerCase()),
        );
        setSession(match ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [className]);
  if (!session) return null;
  const when = new Date(session.startsAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <section className="ik-panel" aria-label="Live session">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--danger-solid)",
            flex: "none",
          }}
          aria-hidden="true"
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.8,
            color: "var(--danger-text)",
          }}
        >
          LIVE SESSION
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            style={{
              width: 88,
              height: 56,
              borderRadius: 10,
              objectFit: "cover",
              flex: "none",
            }}
          />
        )}
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
          }}
        >
          <span className="ik-live-white-title">{session.title}</span>
          <span className="ik-row-meta">
            {session.isLive ? "Happening now" : when}
          </span>
        </span>
      </div>
      <Link
        href={`/live/${session.id}`}
        className="ik-cta ik-cta--block"
        style={{ marginTop: 14 }}
      >
        {session.isLive || session.canJoinNow ? "Join now" : "View session"}
      </Link>
    </section>
  );
}

// Ownership-gated parts of the Ink Hero class page. Rendered twice:
//   slot="hero-ring" → the member's 72px progress ring on the band
//   slot="body"      → course accordions + cert/live rail (member) or
//                      buy card + trailer + closing CTA (guest)
// Token lives in localStorage, so the server can't know the viewer — we resolve
// on the client. A stable placeholder renders until resolved (no owner ever
// flashes "Get Class").
export default function ClassMemberArea({
  slugOrId,
  name,
  checkoutHref,
  priceLabel,
  trailerUrl,
  lessonCount,
  totalLabel,
  slot,
  description,
  imageUrl,
  skills,
}: Props) {
  const [resolved, setResolved] = useState(false);
  const [owned, setOwned] = useState(false);
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [certificate, setCertificate] =
    useState<ClassCertificateStatusDTO | null>(null);
  const [lessonsByCourse, setLessonsByCourse] = useState<
    Map<string, LessonDTO[]>
  >(new Map());

  // Paint the last-known answer BEFORE the first frame (layout effect: after
  // hydration, before paint) — a repeat visitor never sees the skeleton or a
  // section popping in. The live revalidation below still runs and reconciles.
  const seededRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    const snap = readMemberCache<OwnershipSnapshot>(
      classCacheKey(slugOrId),
      getToken(),
    );
    if (!snap) return;
    seededRef.current = true;
    setOwned(snap.data.owned);
    setCourses(snap.data.courses);
    setCertificate(snap.data.certificate);
    setLessonsByCourse(new Map(Object.entries(snap.data.lessons ?? {})));
    setResolved(true);
  }, [slugOrId]);

  useEffect(() => {
    let active = true;
    resolveOwnership(slugOrId)
      .then((res) => {
        if (!active) return;
        setOwned(res.owned);
        setCourses(res.courses);
        setCertificate(res.certificate);
        setResolved(true);
      })
      .catch(() => {
        if (!active) return;
        // Network never settled. With a seeded snapshot, keep it (stale beats a
        // wrong downgrade to the buy view); with nothing, show the guest view —
        // the pre-snapshot behavior.
        if (!seededRef.current) {
          setOwned(false);
          setCourses([]);
          setCertificate(null);
          setResolved(true);
        }
      });
    return () => {
      active = false;
    };
  }, [slugOrId]);

  // Owned body only: load each course's lessons for the accordion rows. Keyed
  // on the course-ID SET (not array identity) so the cache-seed → fresh-data
  // handoff doesn't refetch the same lessons twice; the one fetch per course
  // set is itself the revalidation of any cached rows.
  const courseIdsKey = useMemo(
    () => courses.map((c) => c.id).join(","),
    [courses],
  );
  useEffect(() => {
    if (slot !== "body" || !owned || courseIdsKey === "") return;
    let active = true;
    void Promise.all(
      courseIdsKey.split(",").map((id) =>
        api
          .courseLessons(id)
          .then(
            (ls) => [id, [...ls].sort((a, b) => a.order - b.order)] as const,
          )
          .catch(() => [id, [] as LessonDTO[]] as const),
      ),
    ).then((entries) => {
      if (!active) return;
      setLessonsByCourse(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [slot, owned, courseIdsKey]);

  // Snapshot every settled state — member AND guest — so the next visit to
  // this class paints instantly (guests otherwise re-suffer the blank gap on
  // every load). Tokenless visitors write nothing (writeMemberCache no-ops).
  useEffect(() => {
    if (!resolved) return;
    writeMemberCache<OwnershipSnapshot>(classCacheKey(slugOrId), getToken(), {
      owned,
      courses,
      certificate,
      lessons: Object.fromEntries(lessonsByCourse),
    });
  }, [resolved, owned, courses, certificate, lessonsByCourse, slugOrId]);

  const totals = useMemo(() => {
    const totalLessons = courses.reduce((n, c) => n + c.lessonCount, 0);
    const done = courses.reduce((n, c) => n + c.completedCount, 0);
    const pct = totalLessons ? Math.round((done / totalLessons) * 100) : 0;
    return { totalLessons, done, pct };
  }, [courses]);

  // The "current" lesson = first incomplete lesson scanning courses in order.
  const currentLessonId = useMemo(() => {
    for (const c of courses) {
      const ls = lessonsByCourse.get(c.id);
      if (!ls) continue;
      const next = ls.find((l) => !l.completed);
      if (next) return next.id;
    }
    return null;
  }, [courses, lessonsByCourse]);

  /* ===================== HERO RING (band) ===================== */
  if (slot === "hero-ring") {
    // Hold the ring's 72px space with a shimmer while ownership resolves so
    // the band doesn't get a late pop-in; tokenless guests resolve in a tick,
    // so for them this is at most a single frame.
    if (!resolved)
      return (
        <span
          className="ik-skel ik-skel--ink"
          style={{ width: 72, height: 72, borderRadius: "50%", flex: "none" }}
          aria-hidden="true"
        />
      );
    if (!owned) return null;
    return <BandRing pct={totals.pct} />;
  }

  /* ===================== BODY ===================== */
  // First-visit placeholder (also the SSR output, so crawlers index the skills
  // markup): a two-column skeleton shaped like the REAL curriculum — the
  // server-known lessonCount sizes the accordion skeletons (≈3 lessons/course
  // heuristic; the public DTO doesn't carry a course count) and the rail is an
  // ink card like the certificate card — so the resolved content replaces it
  // in place instead of shoving the page around. Repeat visits skip straight
  // past this via the snapshot seed above.
  if (!resolved) {
    const panels = Math.max(
      1,
      Math.min(Math.round(Math.max(lessonCount, 1) / 3) || 1, 3),
    );
    const rowsPer = Math.max(
      1,
      Math.min(Math.ceil(Math.max(lessonCount, 1) / panels), 4),
    );
    return (
      <>
        <div className="ik-cols" style={{ marginTop: 0 }} aria-hidden>
          <div className="ik-stack">
            {Array.from({ length: panels }, (_, p) => (
              <div key={p} className="ik-panel ik-panel--snug">
                <div
                  className="ik-skel"
                  style={{
                    height: 74,
                    borderRadius: "16px 16px 0 0",
                    margin: "-18px -22px 14px",
                  }}
                />
                {Array.from({ length: rowsPer }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 0",
                    }}
                  >
                    <div
                      className="ik-skel"
                      style={{ width: 56, height: 38 }}
                    />
                    <div
                      className="ik-skel"
                      style={{ width: "55%", height: 13 }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="ik-stack">
            <div className="ik-ink-card">
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: 84, height: 84, borderRadius: "50%" }}
              />
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: "55%", height: 15 }}
              />
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: "85%", height: 12 }}
              />
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: "70%", height: 12 }}
              />
              <div
                className="ik-skel ik-skel--ink"
                style={{ width: 130, height: 38, borderRadius: 9 }}
              />
            </div>
          </div>
        </div>
        {skills}
      </>
    );
  }

  /* ----- Member: course accordions + certificate/live rail ----- */
  if (owned) {
    const coursesLeft = courses.filter(
      (c) => c.lessonCount === 0 || c.completedCount < c.lessonCount,
    ).length;
    return (
      <>
        <div className="ik-cols" style={{ marginTop: 0 }} id="your-courses">
          <div className="ik-stack">
            {courses.length === 0 ? (
              <div className="ik-panel" style={{ color: "var(--text-muted)" }}>
                No courses in this class yet.
              </div>
            ) : (
              courses.map((c, i) => (
                <CourseAccordion
                  key={c.id}
                  course={c}
                  index={i}
                  lessons={lessonsByCourse.get(c.id) ?? null}
                  currentLessonId={currentLessonId}
                />
              ))
            )}
          </div>
          <div className="ik-stack">
            {/* Certificate ink card — only when a certificate template is
                assigned to this class (certificates are opt-in per class; the
                API sends `certificate: null` otherwise). With no certificate we
                show the plain progress card below instead, so a class that
                doesn't offer one never dangles a dead cert promise. */}
            {certificate ? (
              <section className="ik-ink-card" aria-label="Class certificate">
                <CertRing pct={totals.pct} />
                <div className="ik-ink-card-title">Class certificate</div>
                <div className="ik-ink-card-text">
                  {certificate.claimed
                    ? `Your certificate for ${name} has been issued.`
                    : certificate.eligible
                      ? `You've completed every lesson — claim your certificate for ${name}.`
                      : courses.length > 0
                        ? `Finish all ${courses.length} course${courses.length === 1 ? "" : "s"} to earn your certificate for ${name}.`
                        : `Complete this class to earn your certificate.`}
                </div>
                {certificate.eligible || certificate.claimed ? (
                  <CertificateClaimButton status={certificate} />
                ) : (
                  <a href="#your-courses" className="ik-ink-ghost">
                    {coursesLeft > 0
                      ? `${coursesLeft} course${coursesLeft === 1 ? "" : "s"} to go`
                      : "View courses"}
                  </a>
                )}
              </section>
            ) : (
              <section className="ik-ink-card" aria-label="Your progress">
                <CertRing pct={totals.pct} />
                <div className="ik-ink-card-title">Your progress</div>
                <div className="ik-ink-card-text">
                  {totals.totalLessons === 0
                    ? "No lessons in this class yet."
                    : totals.pct >= 100
                      ? `All ${totals.totalLessons} lessons complete — nicely done.`
                      : `${totals.done} of ${totals.totalLessons} lessons complete.`}
                </div>
                <a href="#your-courses" className="ik-ink-ghost">
                  {totals.totalLessons === 0
                    ? "View courses"
                    : totals.pct >= 100
                      ? "Review courses"
                      : "Continue"}
                </a>
              </section>
            )}
            <ClassLiveCard className={name} imageUrl={imageUrl ?? null} />
          </div>
        </div>
        {skills}
      </>
    );
  }

  /* ----- Guest / not a member: buy card + about + trailer + closing ----- */
  const vimeo = trailerUrl ? vimeoEmbed(trailerUrl) : null;
  // No priceLabel ⇔ the class has no active price, so checkoutHref would 404.
  // Show the marketing without a dead "Get Class" link (admins hand-grant it).
  const purchasable = priceLabel != null;
  return (
    <>
      <div className="ik-cols" style={{ marginTop: 0 }}>
        <div className="ik-stack">
          <section className="ik-panel">
            <div className="ik-panel-head">
              <span className="ik-panel-title">About this class</span>
            </div>
            {description ? (
              <div
                className="rich-text"
                style={{
                  color: "var(--text-soft)",
                  fontSize: 14,
                  lineHeight: 1.65,
                  margin: "10px 0 0",
                }}
                dangerouslySetInnerHTML={{ __html: description }}
              />
            ) : (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13.5,
                  margin: "10px 0 0",
                }}
              >
                {lessonCount > 0
                  ? `${lessonCount} lesson${lessonCount === 1 ? "" : "s"}${totalLabel ? ` · ${totalLabel} of video` : ""}.`
                  : "Details coming soon."}
              </p>
            )}
          </section>
          {trailerUrl && (
            <section
              className="ik-panel"
              id="trailer"
              aria-label="Class trailer"
            >
              <div className="ik-panel-head" style={{ marginBottom: 12 }}>
                <span className="ik-panel-title">Class trailer</span>
                <div className="ik-grow" />
                <span className="ik-panel-note">A two-minute look inside</span>
              </div>
              <div className="ik-trailer">
                {vimeo ? (
                  <iframe
                    src={vimeo}
                    title={`${name} trailer`}
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video src={trailerUrl} controls />
                )}
              </div>
            </section>
          )}
        </div>
        <aside className="ik-panel" aria-label="Get this class">
          <div className="ik-panel-title" style={{ fontSize: 16 }}>
            Get {name}
          </div>
          {priceLabel && (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                margin: "6px 0 0",
              }}
            >
              Starting at <b style={{ color: "var(--text)" }}>{priceLabel}</b>
            </p>
          )}
          {purchasable && (
            <Link
              href={checkoutHref}
              className="ik-cta ik-cta--block"
              style={{ marginTop: 16 }}
            >
              Get Class
            </Link>
          )}
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 12.5,
              textAlign: "center",
              margin: "12px 0 0",
            }}
          >
            {trailerUrl ? (
              <a
                href="#trailer"
                style={{ color: "var(--teal-text)", fontWeight: 600 }}
              >
                Watch the trailer ↓
              </a>
            ) : purchasable ? (
              "Full lifetime access."
            ) : (
              "Enrollment is by invitation."
            )}
          </p>
        </aside>
      </div>

      {skills}

      {purchasable && (
        <section
          className="ik-panel"
          style={{ marginTop: 30, textAlign: "center", padding: "40px 24px" }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: "var(--teal-text)",
            }}
          >
            Start today
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text)",
              margin: "10px 0 18px",
            }}
          >
            Begin {name}
          </h2>
          <Link
            href={checkoutHref}
            className="ik-cta"
            style={{ padding: "13px 34px" }}
          >
            Get Class
          </Link>
          <p
            style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 16 }}
          >
            Starting at {priceLabel}
          </p>
        </section>
      )}
    </>
  );
}
