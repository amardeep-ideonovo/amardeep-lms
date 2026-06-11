"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  MemberBillingDTO,
  SubscriptionCancelMode,
  SubscriptionDetailDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";

const money = (a: number, c: string) =>
  (a / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (c || "usd").toUpperCase(),
  });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

// Per-member billing page: live subscriptions with one-click Pause / Resume /
// Cancel (at period end) plus the member's Stripe payment history. Opened from
// the clickable email in the members table.
export default function MemberBillingPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<MemberBillingDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The subscription pending cancellation (drives the immediate/period-end modal).
  const [cancelFor, setCancelFor] = useState<SubscriptionDetailDTO | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.memberBilling(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (authLoading || !can("members", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading]);

  async function act(fn: () => Promise<MemberBillingDTO>) {
    setBusy(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  // Cancel the chosen subscription with the selected access timing, then close.
  function doCancel(mode: SubscriptionCancelMode) {
    const sub = cancelFor;
    if (!sub) return;
    setCancelFor(null);
    act(() => api.cancelMemberSub(id, sub.stripeSubId, mode));
  }

  // Prefer the member's name in the heading; fall back to email.
  const fullName = [data?.member.firstName, data?.member.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const heading = fullName || data?.member.email || "Member";

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("members", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Member billing</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <Link href="/members" className="linklike">
        ← Back to members
      </Link>
      <div className="page-header" style={{ marginTop: 8 }}>
        <h1>{heading} — billing</h1>
        <p className="subtitle">
          {fullName && data?.member.email ? `${data.member.email} · ` : ""}
          Subscriptions and payment history.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !data ? null : (
          <>
            <h3 style={{ marginTop: 0 }}>Subscriptions</h3>
            {data.subscriptions.length === 0 ? (
              <p className="muted">No paid subscription.</p>
            ) : (
              <div className="sub-list">
                {data.subscriptions.map((s) => {
                  return (
                    <div key={s.stripeSubId} className="sub-tile">
                      <div className="sub-tile__info">
                        <strong>{s.levelName}</strong>
                        <span className="muted">
                          {money(s.amount, s.currency)} / {s.interval} ·{" "}
                          {s.paused ? "paused" : s.status}
                          {s.cancelAtPeriodEnd ? " · cancels at period end" : ""}
                          {s.currentPeriodEnd
                            ? ` · renews ${fmtDate(s.currentPeriodEnd)}`
                            : ""}
                          {s.installmentsTotal != null
                            ? ` · installment ${s.installmentsPaid ?? 0}/${s.installmentsTotal} → lifetime`
                            : ""}
                        </span>
                      </div>
                      <div className="row-actions">
                        {s.paused ? (
                          <button
                            className="btn btn--sm"
                            disabled={busy}
                            onClick={() =>
                              act(() => api.resumeMemberSub(id, s.stripeSubId))
                            }
                          >
                            Resume
                          </button>
                        ) : s.cancelAtPeriodEnd ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            Cancels at period end
                          </span>
                        ) : (
                          <>
                            <button
                              className="btn btn--ghost btn--sm"
                              disabled={busy}
                              onClick={() =>
                                act(() => api.pauseMemberSub(id, s.stripeSubId))
                              }
                            >
                              Pause
                            </button>
                            {s.installmentsTotal == null && (
                              <button
                                className="btn btn--danger btn--sm"
                                disabled={busy}
                                onClick={() => setCancelFor(s)}
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {data.lifetimeLevels.length > 0 && (
              <>
                <h3 style={{ marginTop: 22 }}>Lifetime access</h3>
                <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                  Completed installment plans — kept permanently, no further
                  billing.
                </p>
                <div className="chips">
                  {data.lifetimeLevels.map((l) => (
                    <span key={l.levelId} className="chip">
                      {l.levelName}
                      <span className="muted" style={{ fontSize: 11 }}>
                        LIFETIME
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}

            <h3 style={{ marginTop: 22 }}>Payment history</h3>
            {data.invoices.length === 0 ? (
              <p className="muted">No payments yet.</p>
            ) : (
              <div className="table-wrap"><table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>{fmtDate(inv.created)}</td>
                      <td className="muted">{inv.description ?? "—"}</td>
                      <td>
                        {money(inv.amountPaid || inv.amountDue, inv.currency)}
                      </td>
                      <td>{inv.status}</td>
                      <td>
                        {inv.hostedInvoiceUrl ? (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Receipt ↗
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </>
        )}
      </div>

      {cancelFor && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!busy) setCancelFor(null);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Cancel {cancelFor.levelName}?</h2>
              <button
                type="button"
                className="modal-close"
                aria-label="Close"
                disabled={busy}
                onClick={() => setCancelFor(null)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="muted" style={{ marginTop: 0 }}>
                Billing stops renewing now. Choose when access ends — this
                can&apos;t be undone (no resume).
              </p>
              <div className="row-actions">
                <button
                  className="btn btn--danger"
                  disabled={busy}
                  onClick={() => doCancel("immediate")}
                >
                  End access now
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => doCancel("period_end")}
                >
                  End at period end
                </button>
                <button
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={() => setCancelFor(null)}
                >
                  Keep subscription
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
