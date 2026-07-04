"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthUser, ClassTileDTO } from "@lms/types";
import { ApiError, api, clearToken, getCachedMe, setCachedMe } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import LiveSessionBar from "@/components/LiveSessionBar";

// A class tile (cinematic dark). Clicking opens the public class page
// (/classes/<slug ?? id>), where an owner then sees its courses. "Enrolled"
// marks classes the member's active membership already unlocks.
// Deterministic gradient from a class id, so imageless classes each get a
// distinct—but stable—tile color instead of all sharing one purple.
function letterGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 75;
  // Constrain the base hue to the violet→magenta band so auto tiles stay on-brand.
  const h = 255 + hash;
  const h2 = 255 + ((hash + 38) % 75); // keep the 2nd stop inside the band too
  // Muted saturation/lightness so an image-less tile reads as a quiet brand
  // placeholder and never out-shouts the real cover photography beside it.
  return `linear-gradient(150deg, hsl(${h} 36% 34%), hsl(${h2} 32% 26%))`;
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
        <span className="md-card-play hover-pop">
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

// Member's display first name for the greeting: profile first name, else
// username, else the email local-part. Empty when we have no identity yet, so
// the greeting renders without a dangling comma.
function greetingName(u: AuthUser | null): string {
  if (!u) return "";
  return (
    u.firstName?.trim() ||
    u.username?.trim() ||
    (u.email ? u.email.split("@")[0] : "")
  );
}

function DashboardInner() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Member identity for the personalized greeting. Seeded from the localStorage
  // cache so the name paints immediately (no flash), then refreshed by /auth/me.
  const [me, setMe] = useState<AuthUser | null>(() => getCachedMe());

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

  // Refresh the member profile for the greeting (seeded from cache above), and
  // keep the cache current so the name paints instantly on the next visit.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((u) => {
        if (!alive) return;
        setMe(u);
        setCachedMe(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
  // Feature the next class to work on: the first enrolled class that still has
  // lessons left. If everything's finished, fall back to the first enrolled
  // class — the hero then reads "Completed" / "Review class" instead of asking
  // the member to "resume" something they've already finished.
  const featured =
    enrolled.find(
      (c) => c.progress && c.progress.total > 0 && c.progress.completed < c.progress.total,
    ) ??
    enrolled[0] ??
    null;
  const featProgress = featured?.progress ?? null;
  const featPct =
    featProgress && featProgress.total > 0
      ? Math.round((featProgress.completed / featProgress.total) * 100)
      : 0;
  const featComplete =
    !!featProgress && featProgress.total > 0 && featProgress.completed >= featProgress.total;
  const name = greetingName(me);
  // The hero is a shortcut to the featured class; "My Classes" stays the
  // COMPLETE library (count must match what the member owns).

  return (
    <div className="member-dash">
      <div className="md-wrap">
        <div className="md-head">
          <div className="md-head-text">
          <h1>
            {enrolled.length > 0 ? (
              name ? (
                <>Welcome back, <span className="t-gradient">{name}</span>.</>
              ) : (
                <>Welcome <span className="t-gradient">back</span>.</>
              )
            ) : name ? (
              <>Welcome, <span className="t-gradient">{name}</span>.</>
            ) : (
              <><span className="t-gradient">Welcome</span>.</>
            )}
          </h1>
          <p>
            {classes.length === 0
              ? "No classes are available yet."
              : enrolled.length > 0
                ? `You're enrolled in ${enrolled.length} ${enrolled.length === 1 ? "class" : "classes"}.`
                : "Explore the classes below to get started."}
          </p>
          </div>
          <LiveSessionBar />
        </div>

        {/* Continue learning — most recent enrolled class */}
        {featured && (
          <div className="md-continue">
            <div
              className={featured.imageUrl ? "md-continue-bg" : "md-continue-bg md-continue-bg--empty"}
              style={featured.imageUrl ? { backgroundImage: `url(${featured.imageUrl})` } : { background: letterGradient(featured.id) }}
            />
            <div className="md-continue-inner">
              <p className="md-eyebrow">{featComplete ? "Completed" : "Continue learning"}</p>
              <h2>{featured.name}</h2>
              {featured.categories && featured.categories.length > 0 && (
                <div className="md-continue-meta">
                  {featured.categories.slice(0, 2).map((c) => (
                    <span key={c.id} className="md-chip">{c.name}</span>
                  ))}
                </div>
              )}
              {featProgress && featProgress.total > 0 && (
                <div className="md-prog">
                  <div className="md-prog-label">
                    <span>{featPct}% complete</span>
                    <span>
                      {featProgress.completed} / {featProgress.total} lessons
                    </span>
                  </div>
                  <div className="md-track">
                    <div
                      className="md-fill"
                      style={{ width: `${featPct}%` }}
                    />
                  </div>
                </div>
              )}
              <Link href={`/classes/${featured.slug ?? featured.id}`} className="md-btn press">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                {featComplete ? "Review class" : "Resume class"}
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
