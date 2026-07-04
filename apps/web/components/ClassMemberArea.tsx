"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClassCertificateStatusDTO, CourseCard } from "@lms/types";
import { api, getToken } from "@/lib/api";
import CertificateClaimButton from "@/components/CertificateClaimButton";

// Vimeo URL -> player embed URL; null for non-Vimeo (then we use <video>).
function vimeoEmbed(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
}

type Slot = "hero-card" | "body";
type Props = {
  slugOrId: string;
  name: string;
  checkoutHref: string;
  priceLabel: string | null;
  trailerUrl: string | null;
  lessonCount: number;
  totalLabel: string;
  slot: Slot;
  // Server-rendered "Skills You'll Learn" markup (slot="body" only). Guests get
  // it ABOVE the trailer/CTA (marketing order); owners get it BELOW Your
  // Courses (library order).
  skills?: React.ReactNode;
};

type Ownership = {
  owned: boolean;
  courses: CourseCard[];
  certificate: ClassCertificateStatusDTO | null;
};

// Module-level cache so the two instances (hero card + body) share ONE request.
const cache = new Map<string, Promise<Ownership>>();
function resolveOwnership(slugOrId: string): Promise<Ownership> {
  if (!getToken())
    return Promise.resolve({ owned: false, courses: [], certificate: null });
  let p = cache.get(slugOrId);
  if (!p) {
    p = api
      .myClassCourses(slugOrId)
      .then((res) => ({
        owned: res.owned,
        courses: res.courses,
        certificate: res.certificate ?? null,
      }))
      .catch(() => ({ owned: false, courses: [], certificate: null }));
    cache.set(slugOrId, p);
  }
  return p;
}

// Ownership-gated parts of the cinematic class page. Rendered twice:
//   slot="hero-card" → the purchase card (guest) or resume card (member)
//   slot="body"      → trailer + closing CTA (guest) or Your Courses (member)
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
  skills,
}: Props) {
  const [resolved, setResolved] = useState(false);
  const [owned, setOwned] = useState(false);
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [certificate, setCertificate] =
    useState<ClassCertificateStatusDTO | null>(null);

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

  /* ===================== HERO CARD ===================== */
  if (slot === "hero-card") {
    if (!resolved) return <aside className="cc-buy" aria-hidden style={{ minHeight: 150 }} />;

    if (owned) {
      const totalLessons = courses.reduce((n, c) => n + c.lessonCount, 0);
      const done = courses.reduce((n, c) => n + c.completedCount, 0);
      const pct = totalLessons ? Math.round((done / totalLessons) * 100) : 0;
      return (
        <aside className="cc-buy">
          <span className="cc-owned-tag">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            You own this class
          </span>
          <div className="cc-prog-label">
            <span>{pct}% complete</span>
            <span>{done} / {totalLessons} lessons</span>
          </div>
          <div className="cc-track" style={{ marginBottom: 18 }}>
            <div className="cc-fill" style={{ width: `${pct}%` }} />
          </div>
          <a href="#your-courses" className="cc-btn press">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            Continue learning
          </a>
          {certificate && (certificate.eligible || certificate.claimed) ? (
            <div style={{ marginTop: 14 }}>
              <CertificateClaimButton status={certificate} />
            </div>
          ) : (
            <p className="cc-buy-sub">Pick up where you left off.</p>
          )}
        </aside>
      );
    }

    return (
      <aside className="cc-buy">
        <Link href={checkoutHref} className="cc-btn press">Get Class</Link>
        <p className="cc-buy-sub">
          {priceLabel ? <>Starting at <b>{priceLabel}</b>.<br /></> : null}
          {trailerUrl ? <a href="#trailer" style={{ color: "var(--cc-soft)" }}>Watch the trailer ↓</a> : "Full lifetime access."}
        </p>
      </aside>
    );
  }

  /* ===================== BODY ===================== */
  // Unresolved placeholder keeps skills in the guest position — that's also
  // the SSR output, so crawlers index the skills markup.
  if (!resolved)
    return (
      <>
        {skills}
        <div style={{ minHeight: 120 }} aria-hidden />
      </>
    );

  // ----- Member: Your Courses first, skills below (library order) -----
  if (owned) {
    return (
      <>
      <section className="cc-section" id="your-courses">
        <div className="cc-wrap">
          <p className="cc-eyebrow">Your library</p>
          <h2 className="cc-h2">Your Courses</h2>
          <p className="cc-sub">Continue where you left off.</p>
          {courses.length === 0 ? (
            <p style={{ color: "var(--cc-muted)" }}>No courses in this class yet.</p>
          ) : (
            <div className="cc-courses">
              {courses.map((c) => {
                const pct = c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0;
                return (
                  <Link key={c.id} href={`/courses/${c.id}`} className="cc-course">
                    {c.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="cc-course-thumb" src={c.thumbnailUrl} alt="" />
                    ) : (
                      <div className="cc-course-thumb cc-course-thumb--empty">
                        {c.title.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="cc-course-body">
                      <h3 className="cc-course-title">{c.title}</h3>
                      {c.description && <p className="cc-course-desc">{c.description}</p>}
                      <div className="cc-prog-label">
                        <span>{pct === 100 ? "Completed" : pct > 0 ? "In progress" : "Not started"}</span>
                        <span>{c.completedCount} / {c.lessonCount}</span>
                      </div>
                      <div className="cc-track"><div className="cc-fill" style={{ width: `${pct}%` }} /></div>
                      <span className="cc-course-cta">View course →</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
      {skills}
      </>
    );
  }

  // ----- Guest / not a member: skills + trailer + closing CTA -----
  const vimeo = trailerUrl ? vimeoEmbed(trailerUrl) : null;
  return (
    <>
      {skills}
      {trailerUrl && (
        <section className="cc-section" id="trailer">
          <div className="cc-wrap">
            <p className="cc-eyebrow">Preview</p>
            <h2 className="cc-h2">Class Trailer</h2>
            <p className="cc-sub">A two-minute look inside.</p>
            <div className="cc-trailer">
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
          </div>
        </section>
      )}

      <section className="cc-closing">
        <div className="cc-wrap">
          <p className="cc-eyebrow">Start today</p>
          <h2 className="cc-h2">Begin <span className="t-gradient">{name}</span></h2>
          <Link href={checkoutHref} className="cc-btn press">Get Class</Link>
          {priceLabel && <p className="cc-closing-price">Starting at {priceLabel}</p>}
        </div>
      </section>
    </>
  );
}
