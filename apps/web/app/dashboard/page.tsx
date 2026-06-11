"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassTileDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";

// A class tile (cinematic dark). Clicking opens the public class page
// (/classes/<slug ?? id>), where an owner then sees its courses. "Enrolled"
// marks classes the member's active membership already unlocks.
// Deterministic gradient from a class id, so imageless classes each get a
// distinct—but stable—tile color instead of all sharing one purple.
function letterGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(150deg, hsl(${h} 68% 56%), hsl(${(h + 38) % 360} 60% 46%))`;
}

function ClassTile({ cls }: { cls: ClassTileDTO }) {
  const href = `/classes/${cls.slug ?? cls.id}`;
  return (
    <Link href={href} className="md-card">
      <div className="md-card-media">
        {cls.owned && (
          <span className="md-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Enrolled
          </span>
        )}
        {cls.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cls.imageUrl} alt="" />
        ) : (
          <div className="md-card-media--letter" style={{ background: letterGradient(cls.id) }}>
            {cls.name.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="md-card-play">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </span>
      </div>
      <div className="md-card-body">
        <div className="md-card-title">{cls.name}</div>
        {cls.categories && cls.categories.length > 0 && (
          <div className="md-cats">
            {cls.categories.slice(0, 2).map((c) => (
              <span key={c.id} className="md-cat">{c.name}</span>
            ))}
          </div>
        )}
        <div className="md-card-foot">
          <span className={cls.owned ? "md-card-cta" : "md-card-cta muted"}>
            {cls.owned ? "Continue →" : "View class →"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function DashboardInner() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const cs = await api.myClasses();
        if (!mounted) return;
        setClasses(cs); // update in place — no spinner flash on a focus refresh
        setError(null);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load dashboard.");
      }
    }
    load();
    // Refresh when the member returns to this tab so a class purchased elsewhere
    // (or an admin grant) flips to "Enrolled" without a manual reload.
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  // Featured (most recent enrolled) class headlines the hero — fetch its
  // progress so the hero can show "X% complete" without a new DTO field.
  const featuredClass = classes?.find((c) => c.owned) ?? null;
  const featuredKey = featuredClass
    ? featuredClass.slug ?? featuredClass.id
    : null;
  const [progress, setProgress] = useState<{
    pct: number;
    done: number;
    total: number;
  } | null>(null);
  useEffect(() => {
    if (!featuredKey) {
      setProgress(null);
      return;
    }
    let active = true;
    api
      .myClassCourses(featuredKey)
      .then((res) => {
        if (!active) return;
        const total = res.courses.reduce((n, c) => n + c.lessonCount, 0);
        const done = res.courses.reduce((n, c) => n + c.completedCount, 0);
        setProgress({
          pct: total ? Math.round((done / total) * 100) : 0,
          done,
          total,
        });
      })
      .catch(() => {
        if (active) setProgress(null);
      });
    return () => {
      active = false;
    };
  }, [featuredKey]);

  if (error) {
    return (
      <div className="member-dash">
        <div className="md-wrap"><div className="md-alert">{error}</div></div>
      </div>
    );
  }
  if (!classes) {
    return (
      <div className="member-dash">
        <div className="md-wrap centered-state">
          <div className="spinner" aria-label="Loading" />
        </div>
      </div>
    );
  }

  // Enrolled first, then the rest to explore (backend name ordering preserved).
  const enrolled = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);
  const featured = enrolled[0] ?? null;
  // The hero is a shortcut to the featured class; "My Classes" stays the
  // COMPLETE library (count must match what the member owns).

  return (
    <div className="member-dash">
      <div className="md-wrap">
        <div className="md-head">
          <h1>{enrolled.length > 0 ? "Welcome back." : "Welcome."}</h1>
          <p>
            {classes.length === 0
              ? "No classes are available yet."
              : enrolled.length > 0
                ? `You're enrolled in ${enrolled.length} ${enrolled.length === 1 ? "class" : "classes"}.`
                : "Explore the classes below to get started."}
          </p>
        </div>

        {/* Continue learning — most recent enrolled class */}
        {featured && (
          <div className="md-continue">
            <div
              className={featured.imageUrl ? "md-continue-bg" : "md-continue-bg md-continue-bg--empty"}
              style={featured.imageUrl ? { backgroundImage: `url(${featured.imageUrl})` } : { background: letterGradient(featured.id) }}
            />
            <div className="md-continue-inner">
              <p className="md-eyebrow">Continue learning</p>
              <h2>{featured.name}</h2>
              {featured.categories && featured.categories.length > 0 && (
                <div className="md-continue-meta">
                  {featured.categories.slice(0, 2).map((c) => (
                    <span key={c.id} className="md-chip">{c.name}</span>
                  ))}
                </div>
              )}
              {progress && progress.total > 0 && (
                <div className="md-prog">
                  <div className="md-prog-label">
                    <span>{progress.pct}% complete</span>
                    <span>
                      {progress.done} / {progress.total} lessons
                    </span>
                  </div>
                  <div className="md-track">
                    <div
                      className="md-fill"
                      style={{ width: `${progress.pct}%` }}
                    />
                  </div>
                </div>
              )}
              <Link href={`/classes/${featured.slug ?? featured.id}`} className="md-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Resume class
              </Link>
            </div>
          </div>
        )}

        {enrolled.length > 0 && (
          <section className="md-section">
            <div className="md-section-head">
              <h2>My Classes<span className="md-count">{enrolled.length}</span></h2>
            </div>
            <div className="md-grid">
              {enrolled.map((c) => <ClassTile key={c.id} cls={c} />)}
            </div>
          </section>
        )}

        {available.length > 0 && (
          <section className="md-section">
            <div className="md-section-head">
              <h2>Explore More Classes</h2>
            </div>
            <div className="md-grid">
              {available.map((c) => <ClassTile key={c.id} cls={c} />)}
            </div>
          </section>
        )}

        {classes.length === 0 && <p className="md-empty">No classes are available yet.</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardInner />
      {/* Active popups targeted at the dashboard (shown on every visit). */}
      <PopupHost context={{ type: "dashboard" }} />
    </AuthGate>
  );
}
