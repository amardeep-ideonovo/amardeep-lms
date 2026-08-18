"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AuthUser, ClassTileDTO } from "@lms/types";
import { ApiError, getCachedMe } from "@/lib/api";
import {
  type ClassExtras,
  classColorClass,
  classIndexMap,
  classPct,
  fmtDuration,
  greetingFor,
  overallPct,
} from "@/lib/memberData";
import { useMe, useMemberDashboard, useMyCertificates } from "@/lib/queries";
import AuthGate from "@/components/AuthGate";
import DashboardSkeleton from "@/components/DashboardSkeleton";
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
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path d="m8 5 12 7-12 7z" fill="currentColor" />
  </svg>
);
const BookIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
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
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
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
    <svg
      className="ik-ring"
      width="92"
      height="92"
      viewBox="0 0 92 92"
      aria-label={`${pct}% complete`}
    >
      {/* Track: surface-2's value (P3b; was pre-Spark lavender #eeecf5).
          SVG attributes can't take var() — keep in step with tokens.css. */}
      <circle
        cx="46"
        cy="46"
        r="39.5"
        fill="none"
        stroke="#f1eff7"
        strokeWidth="9"
      />
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
      <text
        x="46"
        y="53"
        textAnchor="middle"
        fontSize="20"
        fontWeight="700"
        fill="#272144"
      >
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
  // Square thumbnail is authored for tiles; fall back to the wide cover.
  const tileImg = cls.thumbnailUrl ?? cls.imageUrl;
  const style: React.CSSProperties = tileImg
    ? ({ "--card-img": `url(${tileImg})` } as React.CSSProperties)
    : {};
  return (
    <Link
      href={href}
      className={`ik-class-card ${classColorClass(colorIdx)}`}
      style={style}
    >
      <div className="ik-class-title">{cls.name}</div>
      {meta && <div className="ik-class-meta">{meta}</div>}
      <div className="ik-class-spacer" />
      {cls.owned ? (
        <div className="ik-class-cta">
          <div className="ik-class-prog">
            <span>Progress</span>
            <span>{pct}%</span>
          </div>
          <div className="ik-class-track">
            <div className="ik-class-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="ik-class-btn">
            {started ? "Continue Class" : "Start Class"}
          </span>
        </div>
      ) : (
        <span className="ik-class-btn">View Class</span>
      )}
    </Link>
  );
}

function DashboardInner() {
  // Tiles and enrichment arrive together — one request instead of the
  // per-class fan-out. The shared cache (also read by /classes and
  // /certificates) revalidates on tab focus, so a class purchased elsewhere
  // (or an admin grant) flips to "Enrolled" without a manual reload — updating
  // in place, never re-showing the skeleton over rendered content.
  const dashboard = useMemberDashboard();
  // Best-effort count for the overview card: undefined (still loading / failed)
  // renders as 0, exactly as the old catch-to-[] did.
  const certsQuery = useMyCertificates();
  // Member identity for the personalized greeting. Seeded from the localStorage
  // cache so the name paints immediately (no flash), then refreshed by /auth/me
  // (the useMe queryFn also keeps that cache current for the next visit).
  const meQuery = useMe();
  const [cachedMe] = useState<AuthUser | null>(() => getCachedMe());
  const me = meQuery.data ?? cachedMe;

  const dash = dashboard.data ?? null;
  const colorIdx = useMemo(() => classIndexMap(dash?.classes ?? []), [dash]);

  if (!dash) {
    // A 401 means the global handler (lib/query.tsx) is already redirecting to
    // /login — keep the skeleton up for that frame instead of flashing an
    // "Unauthorized" alert.
    const err = dashboard.error;
    if (err && !(err instanceof ApiError && err.status === 401)) {
      return (
        <div className="ink-page">
          <div className="ik-band" />
          <div className="ik-main">
            <div className="alert alert-error">
              {err instanceof Error ? err.message : "Failed to load dashboard."}
            </div>
          </div>
        </div>
      );
    }
    // Same shimmer the AuthGate fallback + route loading state show, so the
    // hand-off from first paint to data is seamless (no layout jump).
    return <DashboardSkeleton />;
  }
  const { classes, extras } = dash;

  // Enrolled first, then the rest to explore (backend name ordering preserved).
  const enrolled = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);
  const journeyPct = overallPct(enrolled);
  const name = greetingName(me);
  const certCount = certsQuery.data?.length ?? 0;

  // Resume target: the first enrolled class with lessons left → its next
  // lesson (deep link) when known; otherwise the class page.
  const featured =
    enrolled.find(
      (c) =>
        c.progress &&
        c.progress.total > 0 &&
        c.progress.completed < c.progress.total,
    ) ??
    enrolled[0] ??
    null;
  const featuredNext = featured
    ? (extras.get(featured.id)?.next ?? null)
    : null;
  const resumeHref = featuredNext
    ? `/lessons/${featuredNext.lesson.id}`
    : featured
      ? `/classes/${featured.slug ?? featured.id}`
      : null;
  const resumeLabel = featuredNext?.lesson.title ?? featured?.name ?? null;

  // Continue-learning queue: next incomplete lesson per enrolled class.
  const queue = enrolled
    .map((c) => ({ cls: c, next: extras.get(c.id)?.next ?? null }))
    .filter(
      (q): q is { cls: ClassTileDTO; next: NonNullable<typeof q.next> } =>
        !!q.next,
    );

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
                {enrolled.length} active{" "}
                {enrolled.length === 1 ? "class" : "classes"}
                {certCount > 0 &&
                  ` · ${certCount} certificate${certCount === 1 ? "" : "s"} earned`}
              </div>
              <div className="ik-dots">
                {enrolled.slice(0, 4).map((c) => (
                  <span
                    key={c.id}
                    className={`ik-dot-item ${classColorClass(colorIdx.get(c.id) ?? 0)}`}
                  >
                    <span className="ik-dot" />
                    {c.name.length > 26
                      ? `${c.name.slice(0, 24)}…`
                      : c.name}{" "}
                    {classPct(c)}%
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
            {queue.length > 0 ? (
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
                      next.lesson.thumbnailUrl ??
                      next.courseThumb ??
                      cls.imageUrl ??
                      null;
                    const dur = fmtDuration(next.lesson.durationSeconds);
                    return (
                      <Link
                        key={next.lesson.id}
                        href={`/lessons/${next.lesson.id}`}
                        className="ik-row"
                      >
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="ik-row-thumb" />
                        ) : (
                          <span className="ik-row-thumb" aria-hidden="true" />
                        )}
                        <span className="ik-row-main">
                          <span className="ik-row-title">
                            {next.lesson.title}
                          </span>
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

        {classes.length === 0 && (
          <p className="empty">No classes are available yet.</p>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    // Skeleton (not a spinner) as the gate fallback: it is what SSR emits, so a
    // hard reload paints the dashboard's shape immediately while the JS bundle
    // downloads/hydrates — the slow-feeling part of a cold load.
    <AuthGate fallback={<DashboardSkeleton />}>
      <DashboardInner />
      {/* Active popups targeted at the dashboard (shown on every visit). */}
      <PopupHost context={{ type: "dashboard" }} />
    </AuthGate>
  );
}
