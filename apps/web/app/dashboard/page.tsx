"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppConfig, AuthUser, ClassTileDTO, MyCertificateDTO } from "@lms/types";
import {
  ApiError,
  api,
  clearToken,
  fetchAppConfig,
  getCachedMe,
  setCachedMe,
} from "@/lib/api";
import {
  type ClassExtras,
  classColorClass,
  classIndexMap,
  classPct,
  fetchClassExtras,
  fmtDuration,
  greetingFor,
  overallPct,
} from "@/lib/memberData";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import LiveSessionBar from "@/components/LiveSessionBar";

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

/* ---------- shared inline icons (paths from the design frames) ---------- */
const PlayIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m8 5 12 7-12 7z" fill="currentColor" />
  </svg>
);
const BookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const AwardIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M9 14.5 8 22l4-2.5L16 22l-1-7.5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ---------- 92px overview progress ring (frame 2a: r=39.5, stroke 9) ------- */
function ProgressRing({ pct }: { pct: number }) {
  const C = 2 * Math.PI * 39.5; // ≈248.2
  const arc = Math.max(0, Math.min(100, pct)) * (C / 100);
  return (
    <svg className="ik-ring" width="92" height="92" viewBox="0 0 92 92" aria-label={`${pct}% complete`}>
      <circle cx="46" cy="46" r="39.5" fill="none" stroke="#eeecf5" strokeWidth="9" />
      <circle
        cx="46"
        cy="46"
        r="39.5"
        fill="none"
        stroke="#35b3a2"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${C}`}
        transform="rotate(-90 46 46)"
      />
      <text x="46" y="53" textAnchor="middle" fontSize="20" fontWeight="700" fill="#272144">
        {pct}%
      </text>
    </svg>
  );
}

/* ---------- photo-tint class card (signature pattern) ---------- */
function ClassCard({
  cls,
  colorIdx,
  extras,
}: {
  cls: ClassTileDTO;
  colorIdx: number;
  extras: ClassExtras | null;
}) {
  const href = `/classes/${cls.slug ?? cls.id}`;
  const pct = classPct(cls);
  const started = !!cls.progress && cls.progress.completed > 0;
  const meta =
    extras && extras.courseCount > 0
      ? `${extras.courseCount} course${extras.courseCount === 1 ? "" : "s"} · ${extras.lessonTotal} lesson${extras.lessonTotal === 1 ? "" : "s"}`
      : cls.progress && cls.progress.total > 0
        ? `${cls.progress.total} lesson${cls.progress.total === 1 ? "" : "s"}`
        : cls.categories?.map((c) => c.name).join(" · ") || "";
  const style: React.CSSProperties = cls.imageUrl
    ? ({ "--card-img": `url(${cls.imageUrl})` } as React.CSSProperties)
    : {};
  return (
    <Link href={href} className={`ik-class-card ${classColorClass(colorIdx)}`} style={style}>
      <div className="ik-class-title">{cls.name}</div>
      {meta && <div className="ik-class-meta">{meta}</div>}
      <div className="ik-class-spacer" />
      {cls.owned ? (
        <>
          <div className="ik-class-prog">
            <span>Progress</span>
            <span>{pct}%</span>
          </div>
          <div className="ik-class-track">
            <div className="ik-class-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="ik-class-btn">{started ? "Continue Class" : "Start Class"}</span>
        </>
      ) : (
        <span className="ik-class-btn">View Class</span>
      )}
    </Link>
  );
}

function DashboardInner() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [extras, setExtras] = useState<Map<string, ClassExtras>>(new Map());
  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const [certs, setCerts] = useState<MyCertificateDTO[] | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
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
        setClasses(cs); // update in place — no skeleton flash on a focus refresh
        setError(null);
        // Enrichment (course counts + next lessons) is progressive: cards render
        // from the tiles immediately and refine when this resolves.
        fetchClassExtras(cs)
          .then((m) => {
            if (!mounted) return;
            setExtras(m);
            setExtrasLoaded(true);
          })
          .catch(() => mounted && setExtrasLoaded(true));
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
    api
      .myCertificates()
      .then((rows) => mounted && setCerts(rows))
      .catch(() => mounted && setCerts([]));
    fetchAppConfig()
      .then((cfg) => mounted && setAppConfig(cfg))
      .catch(() => {});
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

  const colorIdx = useMemo(() => classIndexMap(classes ?? []), [classes]);

  if (error) {
    return (
      <div className="ink-page">
        <div className="ik-band" />
        <div className="ik-main">
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    );
  }
  if (!classes) {
    // Skeleton: band + overview card + card grid shimmer.
    return (
      <div className="ink-page">
        <div className="ik-band">
          <div className="ik-band-inner">
            <div className="ik-skel ik-skel--ink" style={{ width: 320, height: 34 }} />
            <div className="ik-skel ik-skel--ink" style={{ width: 420, height: 16, marginTop: 12 }} />
          </div>
        </div>
        <div className="ik-main">
          <div className="ik-skel" style={{ height: 144, borderRadius: 18, background: "#fff" }} />
          <div className="ik-class-grid" style={{ marginTop: 30 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="ik-skel" style={{ height: 218, borderRadius: 18 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Enrolled first, then the rest to explore (backend name ordering preserved).
  const enrolled = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);
  const journeyPct = overallPct(enrolled);
  const name = greetingName(me);
  const certCount = certs?.length ?? 0;

  // Resume target: the first enrolled class with lessons left → its next
  // lesson (deep link) when known; otherwise the class page.
  const featured =
    enrolled.find(
      (c) => c.progress && c.progress.total > 0 && c.progress.completed < c.progress.total,
    ) ??
    enrolled[0] ??
    null;
  const featuredNext = featured ? extras.get(featured.id)?.next ?? null : null;
  const resumeHref = featuredNext
    ? `/lessons/${featuredNext.lesson.id}`
    : featured
      ? `/classes/${featured.slug ?? featured.id}`
      : null;
  const resumeLabel = featuredNext?.lesson.title ?? featured?.name ?? null;

  // Continue-learning queue: next incomplete lesson per enrolled class.
  const queue = enrolled
    .map((c) => ({ cls: c, next: extras.get(c.id)?.next ?? null }))
    .filter((q): q is { cls: ClassTileDTO; next: NonNullable<typeof q.next> } => !!q.next);

  const brand = appConfig?.title?.trim() || "Spotlight Academy";
  const year = new Date().getFullYear();

  return (
    <div className="ink-page">
      {/* ---- ink band: greeting + Resume CTA (frame 2a) ---- */}
      <div className="ik-band">
        <div className="ik-band-inner">
          <div className="ik-band-row">
            <div className="ik-grow">
              <h1 className="ik-band-title">
                {greetingFor()}
                {name ? `, ${name}` : ""}
              </h1>
              <p className="ik-band-sub">
                {enrolled.length > 0
                  ? `You are ${journeyPct}% through your learning journey — keep the streak going.`
                  : classes.length > 0
                    ? "Explore the classes below to get started."
                    : "No classes are available yet."}
              </p>
            </div>
            {resumeHref && resumeLabel && (
              <Link href={resumeHref} className="ik-cta">
                <PlayIcon />
                <span>Resume: {resumeLabel}</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="ik-main">
        {/* ---- overlap overview card ---- */}
        {enrolled.length > 0 && (
          <section className="ik-overview" aria-label="My learning overview">
            <ProgressRing pct={journeyPct} />
            <div className="ik-overview-main">
              <div className="ik-overview-title">My Learning Overview</div>
              <div className="ik-overview-stats">
                {enrolled.length} active {enrolled.length === 1 ? "class" : "classes"}
                {certCount > 0 &&
                  ` · ${certCount} certificate${certCount === 1 ? "" : "s"} earned`}
              </div>
              <div className="ik-dots">
                {enrolled.slice(0, 4).map((c) => (
                  <span key={c.id} className={`ik-dot-item ${classColorClass(colorIdx.get(c.id) ?? 0)}`}>
                    <span className="ik-dot" />
                    {c.name.length > 26 ? `${c.name.slice(0, 24)}…` : c.name} {classPct(c)}%
                  </span>
                ))}
              </div>
            </div>
            <div className="ik-overview-actions">
              <Link href="/classes" className="ik-ghost">
                <BookIcon />
                My Classes
              </Link>
              <Link href="/certificates" className="ik-ghost">
                <AwardIcon />
                Certificates
              </Link>
            </div>
          </section>
        )}

        {/* ---- My Current Classes ---- */}
        {enrolled.length > 0 && (
          <section>
            <div className="ik-section-head">
              <h2 className="ik-section-title">My Current Classes</h2>
              <Link href="/classes" className="ik-view-all">
                View All →
              </Link>
            </div>
            <div className="ik-class-grid">
              {enrolled.map((c) => (
                <ClassCard
                  key={c.id}
                  cls={c}
                  colorIdx={colorIdx.get(c.id) ?? 0}
                  extras={extras.get(c.id) ?? null}
                />
              ))}
            </div>
          </section>
        )}

        {/* ---- Continue learning + live session ---- */}
        {enrolled.length > 0 && (
          <div className="ik-cols">
            {!extrasLoaded ? (
              <section className="ik-panel" aria-label="Continue learning">
                <div className="ik-panel-head">
                  <span className="ik-panel-title">Continue learning</span>
                </div>
                <div className="ik-rows">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="ik-row">
                      <span className="ik-skel" style={{ width: 64, height: 44 }} />
                      <span className="ik-row-main">
                        <span className="ik-skel" style={{ width: "55%", height: 13 }} />
                        <span className="ik-skel" style={{ width: "35%", height: 11, marginTop: 4 }} />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : queue.length > 0 ? (
              <section className="ik-panel" aria-label="Continue learning">
                <div className="ik-panel-head">
                  <span className="ik-panel-title">Continue learning</span>
                  <div className="ik-grow" />
                  <Link href="/classes" className="ik-panel-link">
                    View all
                  </Link>
                </div>
                <div className="ik-rows">
                  {queue.slice(0, 4).map(({ cls, next }) => {
                    const thumb =
                      next.lesson.thumbnailUrl ?? next.courseThumb ?? cls.imageUrl ?? null;
                    const dur = fmtDuration(next.lesson.durationSeconds);
                    return (
                      <Link key={next.lesson.id} href={`/lessons/${next.lesson.id}`} className="ik-row">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="ik-row-thumb" />
                        ) : (
                          <span className="ik-row-thumb" aria-hidden="true" />
                        )}
                        <span className="ik-row-main">
                          <span className="ik-row-title">{next.lesson.title}</span>
                          <span className="ik-row-meta">
                            {next.courseTitle}
                            {dur ? ` · ${dur}` : ""}
                          </span>
                        </span>
                        <span className="ik-row-pct">{classPct(cls)}%</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div />
            )}
            <LiveSessionBar />
          </div>
        )}

        {/* ---- Explore more (unowned) — same card language, View Class ---- */}
        {available.length > 0 && (
          <section>
            <div className="ik-section-head">
              <h2 className="ik-section-title">Explore More Classes</h2>
            </div>
            <div className="ik-class-grid">
              {available.map((c) => (
                <ClassCard
                  key={c.id}
                  cls={c}
                  colorIdx={colorIdx.get(c.id) ?? 0}
                  extras={null}
                />
              ))}
            </div>
          </section>
        )}

        {classes.length === 0 && <p className="empty">No classes are available yet.</p>}

        {/* ---- footer line ---- */}
        <div className="ik-foot">
          <span>
            © {year} {brand}
          </span>
          <span>Help · Terms</span>
        </div>
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
