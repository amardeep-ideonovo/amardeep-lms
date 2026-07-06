"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  ClassCertificateStatusDTO,
  CourseCard,
  LessonDTO,
  LiveSessionBarDTO,
} from "@lms/types";
import { api, getToken } from "@/lib/api";
import { fmtDuration, fmtTotalMinutes } from "@/lib/memberData";
import CertificateClaimButton from "@/components/CertificateClaimButton";

// Vimeo URL -> player embed URL; null for non-Vimeo (then we use <video>).
function vimeoEmbed(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
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

// In-flight de-dup so the two instances (hero ring + body) share ONE request,
// while a later remount (e.g. returning after completing a lesson) refetches
// fresh progress instead of reading a stale forever-cache.
const inflight = new Map<string, Promise<Ownership>>();
function resolveOwnership(slugOrId: string): Promise<Ownership> {
  if (!getToken())
    return Promise.resolve({ owned: false, courses: [], certificate: null });
  let p = inflight.get(slugOrId);
  if (!p) {
    p = api
      .myClassCourses(slugOrId)
      .then((res) => ({
        owned: res.owned,
        courses: res.courses,
        certificate: res.certificate ?? null,
      }))
      .catch(() => ({ owned: false, courses: [], certificate: null }));
    inflight.set(slugOrId, p);
    p.finally(() => {
      setTimeout(() => inflight.delete(slugOrId), 0);
    });
  }
  return p;
}

/* ---------- tiny icons (paths from the frames) ---------- */
const CheckIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 6 9 17l-5-5"
      stroke="#2a9d8d"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const PlayGlyph = ({ size = 11, fill = "#8b87a3" }: { size?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m8 5 12 7-12 7z" fill={fill} />
  </svg>
);

/* ---------- 72px band progress ring (frame 2c hero) ---------- */
function BandRing({ pct }: { pct: number }) {
  const C = 2 * Math.PI * 30.5; // ≈191.6
  const arc = Math.max(0, Math.min(100, pct)) * (C / 100);
  return (
    <svg className="ik-ring" width="72" height="72" viewBox="0 0 72 72" aria-label={`${pct}% complete`}>
      <circle cx="36" cy="36" r="30.5" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r="30.5"
        fill="none"
        stroke="#3cc4b2"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${C}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="41.6" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff">
        {pct}%
      </text>
    </svg>
  );
}

/* ---------- 84px ink certificate ring (frame 2c rail) ---------- */
function CertRing({ pct }: { pct: number }) {
  const C = 2 * Math.PI * 36; // ≈226.2
  const arc = Math.max(0, Math.min(100, pct)) * (C / 100);
  return (
    <svg className="ik-ring" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r="36" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="8" />
      <circle
        cx="42"
        cy="42"
        r="36"
        fill="none"
        stroke="#3cc4b2"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${C}`}
        transform="rotate(-90 42 42)"
      />
      <text x="42" y="48.3" textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff">
        {pct}%
      </text>
    </svg>
  );
}

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
  const done = course.lessonCount > 0 && course.completedCount >= course.lessonCount;
  const started = course.completedCount > 0;
  const mins =
    lessons && lessons.length > 0
      ? fmtTotalMinutes(lessons.reduce((n, l) => n + (l.durationSeconds ?? 0), 0))
      : null;
  const meta = [
    `Course ${index + 1}`,
    `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`,
    mins,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="ik-panel ik-panel--snug">
      <div className="ik-course-head">
        {course.thumbnailUrl || course.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.thumbnailUrl ?? course.coverImageUrl ?? ""} alt="" className="ik-course-thumb" />
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
          <span className="ik-pill ik-pill--pct">{pct}%</span>
        ) : (
          <span className="ik-pill ik-pill--todo">Not started</span>
        )}
      </div>
      {lessons === null ? (
        <div>
          {[0, 1].map((i) => (
            <div key={i} className="ik-lesson">
              <span className="ik-skel" style={{ width: 56, height: 38 }} />
              <span className="ik-lesson-main">
                <span className="ik-skel" style={{ width: "60%", height: 13 }} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        lessons.map((l) => {
          const isCurrent = l.id === currentLessonId;
          const dur = fmtDuration(l.durationSeconds);
          return (
            <Link
              key={l.id}
              href={`/lessons/${l.id}`}
              className={isCurrent ? "ik-lesson ik-lesson--current" : "ik-lesson"}
            >
              {l.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.thumbnailUrl} alt="" className="ik-lesson-thumb" />
              ) : (
                <span className="ik-lesson-thumb" aria-hidden="true" />
              )}
              <span className="ik-lesson-main">
                <span className="ik-lesson-title">{l.title}</span>
                {dur && <span className="ik-lesson-dur">{dur}</span>}
              </span>
              {isCurrent ? (
                <span className="ik-resume-pill">RESUME</span>
              ) : l.completed ? (
                <span className="ik-lesson-state ik-lesson-state--done">
                  <CheckIcon />
                </span>
              ) : (
                <span className="ik-lesson-state ik-lesson-state--todo">
                  <PlayGlyph />
                </span>
              )}
            </Link>
          );
        })
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
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
        <span
          style={{ width: 7, height: 7, borderRadius: "50%", background: "#ea4f4f", flex: "none" }}
          aria-hidden="true"
        />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: "#c03a3a" }}>
          LIVE SESSION
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            style={{ width: 88, height: 56, borderRadius: 10, objectFit: "cover", flex: "none" }}
          />
        )}
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="ik-live-white-title">{session.title}</span>
          <span className="ik-row-meta">{session.isLive ? "Happening now" : when}</span>
        </span>
      </div>
      <Link
        href={`/live/${session.id}`}
        className="ik-ghost ik-ghost--sm"
        style={{ marginTop: 14, width: "100%" }}
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
  const [lessonsByCourse, setLessonsByCourse] = useState<Map<string, LessonDTO[]>>(
    new Map(),
  );

  useEffect(() => {
    let active = true;
    resolveOwnership(slugOrId).then((res) => {
      if (!active) return;
      setOwned(res.owned);
      setCourses(res.courses);
      setCertificate(res.certificate);
      setResolved(true);
    });
    return () => {
      active = false;
    };
  }, [slugOrId]);

  // Owned body only: load each course's lessons for the accordion rows.
  useEffect(() => {
    if (slot !== "body" || !owned || courses.length === 0) return;
    let active = true;
    Promise.all(
      courses.map((c) =>
        api
          .courseLessons(c.id)
          .then((ls) => [c.id, [...ls].sort((a, b) => a.order - b.order)] as const)
          .catch(() => [c.id, [] as LessonDTO[]] as const),
      ),
    ).then((entries) => {
      if (!active) return;
      setLessonsByCourse(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [slot, owned, courses]);

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
    if (!resolved || !owned) return null;
    return <BandRing pct={totals.pct} />;
  }

  /* ===================== BODY ===================== */
  // Unresolved placeholder keeps skills in the guest position — that's also
  // the SSR output, so crawlers index the skills markup.
  if (!resolved)
    return (
      <>
        <div style={{ minHeight: 160 }} aria-hidden />
        {skills}
      </>
    );

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
            {/* certificate ink card */}
            <section className="ik-ink-card" aria-label="Class certificate">
              <CertRing pct={totals.pct} />
              <div className="ik-ink-card-title">Class certificate</div>
              <div className="ik-ink-card-text">
                {certificate?.claimed
                  ? `Your certificate for ${name} has been issued.`
                  : certificate?.eligible
                    ? `You've completed every lesson — claim your certificate for ${name}.`
                    : courses.length > 0
                      ? `Finish all ${courses.length} course${courses.length === 1 ? "" : "s"} to earn your certificate for ${name}.`
                      : `Complete this class to earn your certificate.`}
              </div>
              {certificate && (certificate.eligible || certificate.claimed) ? (
                <CertificateClaimButton status={certificate} />
              ) : (
                <a href="#your-courses" className="ik-ink-ghost">
                  {coursesLeft > 0
                    ? `${coursesLeft} course${coursesLeft === 1 ? "" : "s"} to go`
                    : "View courses"}
                </a>
              )}
            </section>
            <ClassLiveCard className={name} imageUrl={imageUrl ?? null} />
          </div>
        </div>
        {skills}
      </>
    );
  }

  /* ----- Guest / not a member: buy card + about + trailer + closing ----- */
  const vimeo = trailerUrl ? vimeoEmbed(trailerUrl) : null;
  return (
    <>
      <div className="ik-cols" style={{ marginTop: 0 }}>
        <div className="ik-stack">
          <section className="ik-panel">
            <div className="ik-panel-head">
              <span className="ik-panel-title">About this class</span>
            </div>
            {description ? (
              <p style={{ color: "var(--text-soft)", fontSize: 14, lineHeight: 1.65, margin: "10px 0 0" }}>
                {description}
              </p>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: 13.5, margin: "10px 0 0" }}>
                {lessonCount > 0
                  ? `${lessonCount} lesson${lessonCount === 1 ? "" : "s"}${totalLabel ? ` · ${totalLabel} of video` : ""}.`
                  : "Details coming soon."}
              </p>
            )}
          </section>
          {trailerUrl && (
            <section className="ik-panel" id="trailer" aria-label="Class trailer">
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
                  // eslint-disable-next-line jsx-a11y/media-has-caption
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
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "6px 0 0" }}>
              Starting at <b style={{ color: "var(--text)" }}>{priceLabel}</b>
            </p>
          )}
          <Link href={checkoutHref} className="ik-cta ik-cta--block" style={{ marginTop: 16 }}>
            Get Class
          </Link>
          <p style={{ color: "var(--text-muted)", fontSize: 12.5, textAlign: "center", margin: "12px 0 0" }}>
            {trailerUrl ? (
              <a href="#trailer" style={{ color: "var(--teal-text)", fontWeight: 600 }}>
                Watch the trailer ↓
              </a>
            ) : (
              "Full lifetime access."
            )}
          </p>
        </aside>
      </div>

      {skills}

      <section className="ik-panel" style={{ marginTop: 30, textAlign: "center", padding: "40px 24px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--teal-text)" }}>
          Start today
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: "10px 0 18px" }}>
          Begin {name}
        </h2>
        <Link href={checkoutHref} className="ik-cta" style={{ padding: "13px 34px" }}>
          Get Class
        </Link>
        {priceLabel && (
          <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 16 }}>
            Starting at {priceLabel}
          </p>
        )}
      </section>
    </>
  );
}
