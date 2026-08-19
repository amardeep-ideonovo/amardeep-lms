"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ClassTileDTO } from "@lms/types";
import { ApiError } from "@/lib/api";
import {
  type ClassExtras,
  classColorClass,
  classIndexMap,
  classPct,
} from "@/lib/memberData";
import { useMemberDashboard } from "@/lib/queries";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";

type Filter = "all" | "progress" | "new" | "done";

function bucketOf(c: ClassTileDTO): Exclude<Filter, "all"> {
  const p = c.progress;
  if (!p || p.total === 0 || p.completed === 0) return "new";
  if (p.completed >= p.total) return "done";
  return "progress";
}

/* Photo-tint card — frame 2b (3-col, taller not-started variant). */
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
  const bucket = bucketOf(cls);
  const notStarted = bucket === "new";
  const counts =
    extras && extras.courseCount > 0
      ? `${extras.courseCount} course${extras.courseCount === 1 ? "" : "s"} · ${extras.lessonTotal} lesson${extras.lessonTotal === 1 ? "" : "s"}`
      : cls.progress && cls.progress.total > 0
        ? `${cls.progress.total} lesson${cls.progress.total === 1 ? "" : "s"}`
        : cls.categories?.map((c) => c.name).join(" · ") || "";
  const meta =
    cls.owned && notStarted && counts ? `${counts} · Not started` : counts;
  // Square thumbnail is authored for tiles; fall back to the wide cover.
  const tileImg = cls.thumbnailUrl ?? cls.imageUrl;
  const style: React.CSSProperties = tileImg
    ? ({ "--card-img": `url(${tileImg})` } as React.CSSProperties)
    : {};
  return (
    <Link
      href={href}
      className={`ik-class-card ${notStarted ? "ik-class-card--tall " : ""}${classColorClass(colorIdx)}`}
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
            {bucket === "done"
              ? "Review Class"
              : notStarted
                ? "Start Class"
                : "Continue Class"}
          </span>
        </div>
      ) : (
        <span className="ik-class-btn">View Class</span>
      )}
    </Link>
  );
}

function ClassesInner() {
  // Same shared dashboard payload /dashboard and /certificates read — cached,
  // deduped, and revalidated on tab focus (updating in place, never re-showing
  // the skeleton over rendered content).
  const dashboard = useMemberDashboard();
  const [filter, setFilter] = useState<Filter>("all");

  const dash = dashboard.data ?? null;
  const colorIdx = useMemo(() => classIndexMap(dash?.classes ?? []), [dash]);

  // A 401 means the global handler (lib/query.tsx) is already redirecting to
  // /login — keep the skeleton up for that frame instead of flashing an alert.
  const err = dashboard.error;
  if (!dash && err && !(err instanceof ApiError && err.status === 401)) {
    return (
      <div className="ink-page">
        <div className="ik-band" />
        <div className="ik-main">
          <div className="alert alert-error">
            {err instanceof Error ? err.message : "Failed to load classes."}
          </div>
        </div>
      </div>
    );
  }
  if (!dash) {
    return (
      <div className="ink-page">
        <div className="ik-band">
          <div className="ik-band-inner">
            <div
              className="ik-skel ik-skel--ink"
              style={{ width: 220, height: 34 }}
            />
            <div
              className="ik-skel ik-skel--ink"
              style={{ width: 340, height: 16, marginTop: 12 }}
            />
            <div className="ik-chips">
              {[76, 110, 104, 100].map((w, i) => (
                <div
                  key={i}
                  className="ik-skel ik-skel--ink"
                  style={{ width: w, height: 33, borderRadius: 999 }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="ik-main">
          <div className="ik-class-grid ik-class-grid--3">
            {/* Same height as the real .ik-class-card (min-height 300) so the
                grid doesn't grow when the tiles arrive. */}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="ik-skel"
                style={{ height: 300, borderRadius: 18 }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const { classes, extras } = dash;

  const owned = classes.filter((c) => c.owned);
  const explore = classes.filter((c) => !c.owned);
  const counts = {
    all: owned.length,
    progress: owned.filter((c) => bucketOf(c) === "progress").length,
    new: owned.filter((c) => bucketOf(c) === "new").length,
    done: owned.filter((c) => bucketOf(c) === "done").length,
  };
  const shown =
    filter === "all" ? owned : owned.filter((c) => bucketOf(c) === filter);

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "progress", label: "In progress", n: counts.progress },
    { key: "new", label: "Not started", n: counts.new },
    { key: "done", label: "Completed", n: counts.done },
  ];

  return (
    <div className="ink-page">
      <PopupHost context={{ type: "classes" }} />
      {/* ---- band: title + membership line + filter chips (frame 2b) ---- */}
      <div className="ik-band">
        <div className="ik-band-inner">
          <h1 className="ik-band-title">My Classes</h1>
          <p className="ik-band-sub">
            {owned.length > 0
              ? `${owned.length} ${owned.length === 1 ? "class" : "classes"} included in your membership`
              : "No classes in your membership yet — explore what's available below."}
          </p>
          {owned.length > 0 && (
            <div
              className="ik-chips"
              role="tablist"
              aria-label="Filter classes"
            >
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === c.key}
                  className={filter === c.key ? "ik-chip on" : "ik-chip"}
                  onClick={() => setFilter(c.key)}
                >
                  {c.label} · {c.n}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ik-main">
        {shown.length > 0 ? (
          <div className="ik-class-grid ik-class-grid--3">
            {shown.map((c) => (
              <ClassCard
                key={c.id}
                cls={c}
                colorIdx={colorIdx.get(c.id) ?? 0}
                extras={extras.get(c.id) ?? null}
              />
            ))}
          </div>
        ) : owned.length > 0 ? (
          <div
            className="ik-panel"
            style={{ textAlign: "center", color: "var(--text-muted)" }}
          >
            No classes match this filter yet.
          </div>
        ) : null}

        {/* ---- Explore (unowned) — same language, View Class ---- */}
        {explore.length > 0 && (
          <section>
            <div
              className="ik-section-head"
              style={{
                marginTop: shown.length > 0 || owned.length > 0 ? 30 : 0,
              }}
            >
              <h2 className="ik-section-title">Explore More Classes</h2>
            </div>
            <div className="ik-class-grid ik-class-grid--3">
              {explore.map((c) => (
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

export default function ClassesPage() {
  return (
    <AuthGate>
      <ClassesInner />
    </AuthGate>
  );
}
