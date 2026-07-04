"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { LevelDTO } from "@lms/types";
import { ApiError, api, type ReportFilter } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";

// Reports tab (Commerce group). On-demand Excel (.xlsx) exports of existing data.
// Read-only: gated by the `reports` permission. The filter bar (date range + class)
// is passed as query params to every export, including "Export all".
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

export default function ReportsPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [levels, setLevels] = useState<LevelDTO[]>([]);
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

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 0",
    borderBottom: "1px solid var(--border)",
  };

  return (
    <div>
      <div className="page-header">
        <h1>Reports</h1>
        <p className="subtitle">
          Download your data as Excel (.xlsx). Each report is a single sheet;
          “Export all” bundles all three into one workbook.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Filter bar — applies to every report below (incl. Export all). */}
      <div className="card" style={{ marginBottom: 16 }}>
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

      <div className="card">
        {REPORTS.map((r) => (
          <div key={r.key} style={rowStyle}>
            <div>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {r.desc}
              </div>
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

        <div style={{ ...rowStyle, borderBottom: "none", paddingBottom: 0 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Export all</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
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
