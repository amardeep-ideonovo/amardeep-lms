"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SubscriptionRowDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";

const money = (a: number | null, c: string) =>
  a == null
    ? "—"
    : (a / 100).toLocaleString(undefined, {
        style: "currency",
        currency: (c || "usd").toUpperCase(),
      });

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "–";

// Status -> human label + pill colors (mirrors the WooCommerce status colors:
// green active, grey cancelled, purple expired, yellow on-hold, red past-due).
const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  active: { label: "Active", bg: "#dcfce7", fg: "#166534" },
  trialing: { label: "Trialing", bg: "#e0f2fe", fg: "#075985" },
  past_due: { label: "Past due", bg: "#fee2e2", fg: "#991b1b" },
  unpaid: { label: "Unpaid", bg: "#fee2e2", fg: "#991b1b" },
  paused: { label: "On hold", bg: "#fef9c3", fg: "#854d0e" },
  canceled: { label: "Cancelled", bg: "#f1f5f9", fg: "#475569" },
  incomplete: { label: "Incomplete", bg: "#f1f5f9", fg: "#475569" },
  incomplete_expired: { label: "Expired", bg: "#ede9fe", fg: "#5b21b6" },
};

// While billing is paused Stripe keeps `status: active`, so surface "On hold".
const statusKey = (s: SubscriptionRowDTO): string =>
  s.paused ? "paused" : s.status;

function StatusBadge({ s }: { s: SubscriptionRowDTO }) {
  const key = statusKey(s);
  const meta = STATUS_META[key] ?? { label: key, bg: "#f1f5f9", fg: "#475569" };
  return (
    <span className="badge" style={{ background: meta.bg, color: meta.fg }}>
      {meta.label}
    </span>
  );
}

export default function SubscriptionsPage() {
  const [rows, setRows] = useState<SubscriptionRowDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.listSubscriptions());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subscriptions",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Only offer status values that actually appear in the data.
  const statuses = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(statusKey(r)));
    return Array.from(set);
  }, [rows]);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter !== "all" && statusKey(r) !== statusFilter) return false;
    if (!q) return true;
    return (
      r.memberName.toLowerCase().includes(q) ||
      (r.memberEmail ?? "").toLowerCase().includes(q) ||
      r.levelName.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Subscriptions</h1>
          <p className="subtitle">
            Every Stripe subscription — active and historical. Read live from
            Stripe; manage an individual member’s plan from their billing page.
          </p>
        </div>
        <button className="btn btn--ghost" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No subscriptions yet.</p>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <label htmlFor="sub-search" style={{ fontWeight: 600 }}>
                Search
              </label>
              <input
                id="sub-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email or class…"
                style={{ minWidth: 220 }}
              />
              <label htmlFor="sub-status" style={{ fontWeight: 600 }}>
                Status
              </label>
              <select
                id="sub-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s]?.label ?? s}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: 13 }}>
                Showing {visible.length} of {rows.length}
              </span>
            </div>

            {visible.length === 0 ? (
              <p className="muted">No subscriptions match this filter.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Class Name</th>
                    <th>Total</th>
                    <th>Start Date</th>
                    <th>Next Payment</th>
                    <th>Last Order Date</th>
                    <th>End Date</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <StatusBadge s={r} />
                        {r.cancelAtPeriodEnd && !r.paused ? (
                          <div
                            className="muted"
                            style={{ fontSize: 11, marginTop: 4 }}
                          >
                            cancels at period end
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {r.memberId ? (
                          <Link
                            href={`/members/${r.memberId}`}
                            className="linklike"
                            title="View subscription & payments"
                          >
                            {r.memberName}
                          </Link>
                        ) : (
                          r.memberName
                        )}
                        {r.memberEmail ? (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {r.memberEmail}
                          </div>
                        ) : null}
                      </td>
                      <td>{r.levelName}</td>
                      <td>
                        {money(r.amount, r.currency)}
                        {r.interval ? (
                          <span className="muted"> / {r.interval}</span>
                        ) : null}
                      </td>
                      <td>{fmtDate(r.startDate)}</td>
                      <td>{fmtDate(r.nextPayment)}</td>
                      <td>{fmtDate(r.lastOrderDate)}</td>
                      <td>{fmtDate(r.endDate)}</td>
                      <td>
                        {r.installmentsTotal != null ? (
                          <span title="Installment payments made">
                            {r.orders} / {r.installmentsTotal}
                            <div className="muted" style={{ fontSize: 11 }}>
                              → lifetime
                            </div>
                          </span>
                        ) : (
                          r.orders
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
