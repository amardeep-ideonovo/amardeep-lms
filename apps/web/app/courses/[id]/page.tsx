"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { LessonDTO } from "@lms/types";
import { ApiError } from "@/lib/api";
import { fmtDuration, fmtTotalMinutes } from "@/lib/memberData";
import { useCourseLessons, useCourses } from "@/lib/queries";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import BandPhoto from "@/components/BandPhoto";
import { BandRing, CertRing } from "@/components/ProgressRing";
import { CheckIcon, PlayGlyph } from "@/components/LessonGlyphs";

// One lesson row — the SAME markup ClassMemberArea renders inside a course
// accordion, so the course page shows lessons "the same way": numbered label,
// thumbnail, title + duration, and the current/started/done state pill.
function LessonRow({
  lesson,
  index,
  isCurrent,
}: {
  lesson: LessonDTO;
  index: number;
  isCurrent: boolean;
}) {
  const dur = fmtDuration(lesson.durationSeconds);
  return (
    <Link
      href={`/lessons/${lesson.id}`}
      className={isCurrent ? "ik-lesson ik-lesson--current" : "ik-lesson"}
    >
      <span className="ik-lesson-num" aria-hidden="true">
        Lesson {index + 1}
      </span>
      {lesson.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={lesson.thumbnailUrl} alt="" className="ik-lesson-thumb" />
      ) : (
        <span className="ik-lesson-thumb" aria-hidden="true" />
      )}
      <span className="ik-lesson-main">
        <span className="ik-lesson-title">{lesson.title}</span>
        {dur && <span className="ik-lesson-dur">{dur}</span>}
      </span>
      {lesson.completed ? (
        <span className="ik-lesson-state ik-lesson-state--done">
          <CheckIcon />
        </span>
      ) : lesson.started ? (
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
}

function CourseInner() {
  const params = useParams<{ id: string }>();
  const courseId = params.id;

  // Two snapshot-seeded reads (D4/TanStack): the course card (cover/title/meta)
  // and its ordered lessons. Both paint instantly from member-cache on a repeat
  // visit and revalidate in the background — the same instant-paint feel the
  // class page has. A 401 is handled globally (lib/query.tsx); a 403 (locked)
  // surfaces as the lessons query error and drives the locked state below.
  const coursesQ = useCourses();
  const lessonsQ = useCourseLessons(courseId);

  const course = useMemo(
    () =>
      coursesQ.data?.find((c) => c.slug === courseId || c.id === courseId) ??
      null,
    [coursesQ.data, courseId],
  );
  const lessons = lessonsQ.data ?? null;

  const locked =
    lessonsQ.error instanceof ApiError && lessonsQ.error.status === 403;
  const loadError =
    !locked && lessonsQ.isError
      ? lessonsQ.error instanceof Error
        ? lessonsQ.error.message
        : "Failed to load lessons."
      : null;

  // Progress + curriculum totals. Prefer the live lessons; fall back to the
  // course card's counters so the hero ring/meta can paint before the lessons
  // land on a cold first visit.
  const total = lessons?.length ?? course?.lessonCount ?? 0;
  const completed = lessons
    ? lessons.filter((l) => l.completed).length
    : (course?.completedCount ?? 0);
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const done = total > 0 && completed >= total;
  const anyStarted = lessons
    ? lessons.some((l) => l.started || l.completed)
    : (course?.startedCount ?? 0) > 0 || (course?.completedCount ?? 0) > 0;
  // "current" lesson = first incomplete (the START/RESUME target + rail CTA).
  const nextLesson = lessons?.find((l) => !l.completed) ?? null;

  const title = course?.title ?? "Course";
  const coverUrl = course?.coverImageUrl ?? null;
  const totalMinutes = lessons
    ? fmtTotalMinutes(lessons.reduce((n, l) => n + (l.durationSeconds ?? 0), 0))
    : null;
  const metaBits = [
    total > 0 ? `${total} lesson${total === 1 ? "" : "s"}` : null,
    totalMinutes ? `${totalMinutes} of video` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Curriculum panel header status pill — mirrors the class page's course card.
  const statusPill = done ? (
    <span className="ik-pill ik-pill--done">Completed</span>
  ) : anyStarted ? (
    <span className="ik-pill ik-pill--pct">
      {pct > 0 ? `${pct}%` : "In progress"}
    </span>
  ) : (
    <span className="ik-pill ik-pill--todo">Not started</span>
  );

  let body: React.ReactNode;
  if (locked) {
    body = (
      <section
        className="ik-panel"
        style={{ textAlign: "center", padding: "48px 24px" }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">
          🔒
        </div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "var(--text)",
            margin: "14px 0 6px",
          }}
        >
          This course is locked
        </h2>
        <p
          style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 18px" }}
        >
          You need an active membership level to view these lessons.
        </p>
        <Link href="/account" className="ik-cta" style={{ padding: "12px 26px" }}>
          View plans
        </Link>
      </section>
    );
  } else if (loadError) {
    body = <div className="alert alert-error">{loadError}</div>;
  } else if (!lessons) {
    // Cold-load skeleton, shaped like the real two-column layout so the content
    // replaces it in place (no shift). Repeat visits skip this via the snapshot.
    body = (
      <div className="ik-cols" style={{ marginTop: 0 }} aria-hidden>
        <div className="ik-stack">
          <div className="ik-panel ik-panel--snug">
            <div
              className="ik-skel"
              style={{
                height: 74,
                borderRadius: "16px 16px 0 0",
                margin: "-18px -22px 14px",
              }}
            />
            {Array.from({ length: Math.max(1, Math.min(total || 3, 5)) }, (_, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 0",
                }}
              >
                <div className="ik-skel" style={{ width: 56, height: 38 }} />
                <div className="ik-skel" style={{ width: "55%", height: 13 }} />
              </div>
            ))}
          </div>
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
              style={{ width: 130, height: 38, borderRadius: 9 }}
            />
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="ik-cols" style={{ marginTop: 0 }} id="lessons">
        <div className="ik-stack">
          <section className="ik-panel ik-panel--snug">
            {/* teal header band — the class page's course-card header, minus the
                accordion chevron (we're already on the course). */}
            <div className="ik-course-head">
              {course?.thumbnailUrl || course?.coverImageUrl ? (
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
                <div className="ik-course-name">Lessons</div>
                <div className="ik-course-meta">
                  {metaBits || "No lessons yet"}
                </div>
              </span>
              {statusPill}
            </div>
            {lessons.length === 0 ? (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13.5,
                  padding: "6px 0",
                }}
              >
                No lessons have been published yet.
              </p>
            ) : (
              <div className="ik-lesson-group">
                {lessons.map((l, i) => (
                  <LessonRow
                    key={l.id}
                    lesson={l}
                    index={i}
                    isCurrent={l.id === nextLesson?.id}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
        <div className="ik-stack">
          {/* progress rail — the same ink card the class page shows, but a plain
              progress card (a course has no certificate of its own). */}
          <section className="ik-ink-card" aria-label="Your progress">
            <CertRing pct={pct} />
            <div className="ik-ink-card-title">Your progress</div>
            <div className="ik-ink-card-text">
              {total === 0
                ? "No lessons in this course yet."
                : done
                  ? `All ${total} lessons complete — nicely done.`
                  : `${completed} of ${total} lessons complete.`}
            </div>
            {nextLesson ? (
              <Link href={`/lessons/${nextLesson.id}`} className="ik-ink-ghost">
                {anyStarted ? "Resume course" : "Start course"}
              </Link>
            ) : total > 0 ? (
              <a href="#lessons" className="ik-ink-ghost">
                Review lessons
              </a>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  return (
    <article className="ink-page">
      <PopupHost context={{ type: "courses" }} />

      {/* band hero: course cover under an ink scrim + breadcrumb/title/ring —
          the same immersive band the class page uses (content overlaps it). */}
      <header className={coverUrl ? "ik-band ik-band--photo" : "ik-band"}>
        {coverUrl && <BandPhoto url={coverUrl} />}
        <div className="ik-band-inner ik-band-inner--crumbs">
          <nav className="ik-crumbs" aria-label="Breadcrumb">
            <Link href="/dashboard">Dashboard</Link>
            <span aria-hidden="true">›</span>
            <span className="on">{title}</span>
          </nav>
          <div className="ik-band-row" style={{ marginTop: 14 }}>
            <div className="ik-grow">
              <h1 className="ik-band-title">{title}</h1>
              {metaBits && (
                <p className="ik-band-sub" style={{ fontSize: 13.5 }}>
                  {metaBits}
                </p>
              )}
            </div>
            {lessons && total > 0 && <BandRing pct={pct} />}
          </div>
        </div>
      </header>

      <div className="ik-main">{body}</div>
    </article>
  );
}

export default function CoursePage() {
  return (
    <AuthGate>
      <CourseInner />
    </AuthGate>
  );
}
