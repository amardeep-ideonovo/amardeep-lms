"use client";

// Reports (Ink Hero). WHAT'S REAL vs the 2i design frame:
//   ✓ KPI cards        — counts derived from GET /members + GET /admin/subscriptions
//   ✓ Plan mix donut   — active subscriptions grouped by plan (same source)
//   ✓ Top classes bars — GET /levels memberCount
//   ✓ Excel export cards + date/class filter bar (GET /admin/reports/*.xlsx)
//   ✗ "Weekly revenue" bars and "Enrollments" line — OMITTED: the API has no
//     time-series endpoints. Adding e.g. GET /admin/reports/revenue-weekly and
//     GET /admin/reports/enrollments-daily (JSON buckets) would unlock them.

import { useEffect, useState, type CSSProperties } from "react";
import type { LevelDTO, MemberRow, SubscriptionRowDTO } from "@lms/types";
import { ApiError, api, type ReportFilter } from "@/lib/api";
import { classAccentIndex } from "@/lib/class-accent";
import { useAdminAuth } from "@/components/AdminAuthProvider";

const REPORTS: {
  key: string;
  title: string;
  desc: string;
  run: (f: ReportFilter) => Promise<void>;
}[] = [
  {
    key: "members",
    title: "Members",
    desc: "Every member with profile, classes held, paid status, email opt-out, and signup date.",
    run: (f) => api.downloadMembersReport(f),
  },
  {
    key: "subscriptions",
    title: "Subscriptions & revenue",
    desc: "All Stripe subscriptions — plan, status, amount, order count, and key billing dates.",
    run: (f) => api.downloadSubscriptionsReport(f),
  },
  {
    key: "engagement",
    title: "Course engagement",
    desc: "Per-member progress: lessons completed, completion %, and last activity.",
    run: (f) => api.downloadEngagementReport(f),
  },
];

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
};

// Class accent cycle — slots picked by name keywords (lib/class-accent) so the
// seeded catalog matches the mocks (music amber → comedy sea).
const CLASS_ACCENTS = [
  "#f7a01e",
  "#9046c8",
  "#43a565",
  "#e04848",
  "#4a76d0",
  "#27a596",
];
const MIX_COLORS = ["#35b3a2", "#272144", "#f6a623", "#8b87a3"];

// A subscription row that is currently billing (both providers use raw
// Stripe-style statuses in this DTO).
function isActiveSub(s: SubscriptionRowDTO): boolean {
  return !s.paused && (s.status === "active" || s.status === "trialing");
}

export default function ReportsPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [subs, setSubs] = useState<SubscriptionRowDTO[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [levelId, setLevelId] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !can("reports", "read")) return;
    api
      .listLevels()
      .then(setLevels)
      .catch(() => setLevels([]));
    if (can("members", "read"))
      api
        .listMembers()
        .then(setMembers)
        .catch(() => setMembers(null));
    if (can("subscriptions", "read"))
      api
        .listSubscriptions()
        .then(setSubs)
        .catch(() => setSubs(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const filter: ReportFilter = {
    from: from || undefined,
    to: to || undefined,
    levelId: levelId || undefined,
  };
  const hasFilter = !!(filter.from || filter.to || filter.levelId);

  async function download(key: string, fn: () => Promise<void>) {
    setBusy((b) => ({ ...b, [key]: true }));
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Download failed. Please try again.",
      );
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  function clearFilters() {
    setFrom("");
    setTo("");
    setLevelId("");
  }

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("reports", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Reports</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  // ---- KPIs from real data --------------------------------------------
  const activeSubRows = (subs ?? []).filter(isActiveSub);
  // Monthly-normalized recurring revenue from live subscription amounts
  // (yearly plans /12; rows without a mapped amount are skipped).
  const mrrCents = activeSubRows.reduce((sum, s) => {
    if (s.amount == null) return sum;
    return sum + (s.interval === "year" ? s.amount / 12 : s.amount);
  }, 0);
  const currency = activeSubRows.find((s) => s.amount != null)?.currency ?? "USD";
  const mrr = (mrrCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  });

  const kpis: { label: string; value: string; sub?: string }[] = [];
  if (members)
    kpis.push({
      label: "Total members",
      value: members.length.toLocaleString(),
    });
  if (members)
    kpis.push({
      label: "Active subscriptions",
      value: members.filter((m) => m.subscription?.active).length.toLocaleString(),
    });
  if (subs)
    kpis.push({
      label: "Monthly recurring revenue",
      value: mrr,
      sub: `${activeSubRows.length.toLocaleString()} billing subs`,
    });
  kpis.push({
    label: "Published classes",
    value: levels.filter((l) => l.published).length.toLocaleString(),
  });

  // ---- Plan mix (active subscriptions grouped by plan) -----------------
  const mixMap = new Map<string, number>();
  for (const s of activeSubRows) {
    const label = `${s.levelName}${
      s.interval === "year" ? " · Annual" : s.interval === "month" ? " · Monthly" : ""
    }`;
    mixMap.set(label, (mixMap.get(label) ?? 0) + 1);
  }
  const mixSorted = [...mixMap.entries()].sort((a, b) => b[1] - a[1]);
  const mixTop = mixSorted.slice(0, 3);
  const mixRest = mixSorted.slice(3).reduce((n, [, c]) => n + c, 0);
  const mix = [
    ...mixTop.map(([label, count]) => ({ label, count })),
    ...(mixRest > 0 ? [{ label: "Other", count: mixRest }] : []),
  ];
  const mixTotal = mix.reduce((n, s) => n + s.count, 0);

  // donut geometry (r=52, stroke 16)
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const slices = mix.map((s, i) => {
    const frac = mixTotal ? s.count / mixTotal : 0;
    const seg = { ...s, color: MIX_COLORS[i % MIX_COLORS.length], dash: frac * C, offset: -acc };
    acc += frac * C;
    return seg;
  });

  // ---- Top classes by enrollment (real memberCount) --------------------
  const topClasses = [...levels]
    .map((l, idx) => ({
      l,
      accent: CLASS_ACCENTS[classAccentIndex(l.name, idx) % CLASS_ACCENTS.length],
    }))
    .sort((a, b) => b.l.memberCount - a.l.memberCount)
    .slice(0, 5);
  const maxEnrolled = Math.max(1, ...topClasses.map((t) => t.l.memberCount));
  const showTopClasses = topClasses.some((t) => t.l.memberCount > 0);

  return (
    <div>
      {error && <p className="error">{error}</p>}

      {/* KPI row */}
      {kpis.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(4, kpis.length)}, 1fr)`,
            gap: 18,
            marginBottom: 18,
          }}
        >
          {kpis.map((k) => (
            <div className="kpi-plain" key={k.label}>
              <div className="kpi-plain-label">{k.label}</div>
              <div className="kpi-plain-value">{k.value}</div>
              {k.sub && <span className="kpi-plain-sub">{k.sub}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Plan mix + top classes (both fed by live data) */}
      {(mixTotal > 0 || showTopClasses) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: mixTotal > 0 && showTopClasses ? "1fr 1.4fr" : "1fr",
            gap: 18,
            marginBottom: 18,
          }}
        >
          {mixTotal > 0 && (
            <div className="card" style={{ marginBottom: 0 }}>
              <h2 style={{ marginBottom: 10 }}>Plan mix</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Active subscriptions by plan">
                  <circle cx="75" cy="75" r={R} fill="none" stroke="#f1eff7" strokeWidth="16" />
                  {slices.map((s) => (
                    <circle
                      key={s.label}
                      cx="75"
                      cy="75"
                      r={R}
                      fill="none"
                      stroke={s.color}
                      strokeWidth="16"
                      strokeDasharray={`${s.dash} ${C}`}
                      strokeDashoffset={s.offset}
                      transform="rotate(-90 75 75)"
                    />
                  ))}
                  <text x="75" y="72" textAnchor="middle" fontSize="20" fontWeight="700" fill="#272144" fontFamily="inherit">
                    {mixTotal.toLocaleString()}
                  </text>
                  <text x="75" y="88" textAnchor="middle" fontSize="10" fill="#8b87a3" fontFamily="inherit">
                    active subs
                  </text>
                </svg>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  {slices.map((s) => (
                    <span className="legend-row" key={s.label}>
                      <span className="legend-swatch" style={{ background: s.color }} />
                      <span style={{ flex: 1 }}>{s.label}</span>
                      <b>{mixTotal ? Math.round((s.count / mixTotal) * 100) : 0}%</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showTopClasses && (
            <div className="card" style={{ marginBottom: 0 }}>
              <h2 style={{ marginBottom: 14 }}>Top classes by enrollment</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {topClasses.map(({ l, accent }) => (
                  <div className="hbar-row" key={l.id}>
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.imageUrl} alt="" className="row-thumb row-thumb--sm" />
                    ) : (
                      <span className="row-thumb row-thumb--sm row-thumb--empty" aria-hidden="true" />
                    )}
                    <span className="hbar-name">{l.name}</span>
                    <span className="hbar-track">
                      <span
                        className="hbar-fill"
                        style={{
                          width: `${Math.round((l.memberCount / maxEnrolled) * 100)}%`,
                          background: accent,
                        }}
                      />
                    </span>
                    <span className="hbar-val">{l.memberCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter bar — applies to every export below (incl. Export all). */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <label style={fieldStyle}>
            <span className="muted">From</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label style={fieldStyle}>
            <span className="muted">To</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label style={fieldStyle}>
            <span className="muted">Class</span>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              style={{ minWidth: 200 }}
            >
              <option value="">All classes</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {hasFilter && (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
        <p
          className="muted"
          style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}
        >
          Date range filters Members by signup, Subscriptions by start date, and
          Course engagement by lesson-completion date; Class scopes each report to
          that class. Leave blank to export everything.
        </p>
      </div>

      {/* Excel exports */}
      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Excel exports</h2>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>
          Download your data as .xlsx — each report is a single sheet; “Export
          all” bundles all three into one workbook.
        </p>
        {REPORTS.map((r) => (
          <div key={r.key} className="export-row">
            <div>
              <div className="export-row-title">{r.title}</div>
              <div className="export-row-desc">{r.desc}</div>
            </div>
            <button
              className="btn btn--ghost"
              disabled={!!busy[r.key]}
              onClick={() => download(r.key, () => r.run(filter))}
            >
              {busy[r.key] ? "Preparing…" : "Download Excel"}
            </button>
          </div>
        ))}

        <div className="export-row">
          <div>
            <div className="export-row-title">Export all</div>
            <div className="export-row-desc">
              One workbook with all three reports, each on its own sheet.
            </div>
          </div>
          <button
            className="btn"
            disabled={!!busy.all}
            onClick={() => download("all", () => api.downloadAllReports(filter))}
          >
            {busy.all ? "Preparing…" : "Export all (.xlsx)"}
          </button>
        </div>
      </div>
    </div>
  );
}
