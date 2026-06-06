"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CourseCard } from "@lms/types";
import { api, getToken } from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";

// Vimeo URL -> player embed URL; null for non-Vimeo (then we use <video>).
function vimeoEmbed(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
}

type Props = {
  slugOrId: string;
  name: string;
  checkoutHref: string;
  priceLabel: string | null;
  trailerUrl: string | null;
  lessonCount: number;
  totalLabel: string; // "2hr 52min" / "27min" / ""
};

// Ownership-gated body of the class page. The member JWT lives in localStorage,
// so the server can't know who's viewing — we resolve it here on the client:
//   • Member of this class      -> "Your Courses" only (navigate lessons via a
//     course). Trailer, the lesson list, and "Get Class" are all hidden.
//   • Not a member (or logged out) -> marketing: lesson summary, "Get Class" +
//     price, and the trailer. No courses, no lesson list.
// A stable placeholder renders until ownership resolves, so an owner never
// flashes the "Get Class" button.
export default function ClassMemberArea({
  slugOrId,
  name,
  checkoutHref,
  priceLabel,
  trailerUrl,
  lessonCount,
  totalLabel,
}: Props) {
  const [resolved, setResolved] = useState(false);
  const [owned, setOwned] = useState(false);
  const [courses, setCourses] = useState<CourseCard[]>([]);

  useEffect(() => {
    let active = true;
    // Logged out -> definitely not a member; skip the request.
    if (!getToken()) {
      setOwned(false);
      setResolved(true);
      return;
    }
    api
      .myClassCourses(slugOrId)
      .then((res) => {
        if (!active) return;
        setOwned(res.owned);
        setCourses(res.courses);
        setResolved(true);
      })
      .catch(() => {
        // 401/403/network -> treat as not a member (show marketing view).
        if (active) {
          setOwned(false);
          setResolved(true);
        }
      });
    return () => {
      active = false;
    };
  }, [slugOrId]);

  // SSR + first client render: stable placeholder (no hydration mismatch, no flash).
  if (!resolved) return <div style={{ minHeight: 120 }} aria-hidden />;

  // ----- Member of this class: courses only -----
  if (owned) {
    return (
      <section style={{ margin: "8px 0 36px" }}>
        <h2 className="section-title">Your Courses</h2>
        {courses.length === 0 ? (
          <p className="muted">No courses in this class yet.</p>
        ) : (
          <div className="card-grid">
            {courses.map((c) => (
              <Link key={c.id} href={`/courses/${c.id}`} className="card">
                {c.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.thumbnailUrl}
                    alt=""
                    style={{
                      width: "100%",
                      height: 160,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginBottom: 8,
                      display: "block",
                    }}
                  />
                ) : null}
                <h3 className="card-title">{c.title}</h3>
                {c.description && <p className="card-desc">{c.description}</p>}
                <ProgressBar completed={c.completedCount} total={c.lessonCount} />
                <span className="card-cta">View course →</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    );
  }

  // ----- Not a member (or logged out): marketing CTA + trailer -----
  const vimeo = trailerUrl ? vimeoEmbed(trailerUrl) : null;
  return (
    <section style={{ margin: "8px 0 36px" }}>
      {lessonCount > 0 && (
        <p className="muted" style={{ marginBottom: 16 }}>
          {lessonCount} lesson{lessonCount === 1 ? "" : "s"}
          {totalLabel ? ` · ${totalLabel}` : ""}
          {trailerUrl ? (
            <>
              {" · "}
              <a href="#trailer">Watch Trailer</a>
            </>
          ) : null}
        </p>
      )}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: trailerUrl ? 28 : 0,
        }}
      >
        <Link href={checkoutHref} className="btn">
          Get Class
        </Link>
        {priceLabel && <span className="muted">Starting at {priceLabel}</span>}
      </div>

      {trailerUrl && (
        <div id="trailer">
          <h2 className="section-title">Trailer</h2>
          {vimeo ? (
            <iframe
              src={vimeo}
              title={`${name} trailer`}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              style={{
                width: "100%",
                aspectRatio: "16/9",
                border: 0,
                borderRadius: 12,
              }}
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={trailerUrl}
              controls
              style={{
                width: "100%",
                aspectRatio: "16/9",
                borderRadius: 12,
                background: "#000",
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
