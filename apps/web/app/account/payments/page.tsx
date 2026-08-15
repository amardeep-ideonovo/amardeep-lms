"use client";

import Link from "next/link";
import { STR, formatMoney } from "@lms/types";
import { ApiError } from "@/lib/api";
import { useMyInvoices } from "@/lib/queries";
import AuthGate from "@/components/AuthGate";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PaymentsInner() {
  const invoicesQuery = useMyInvoices();
  const invoices = invoicesQuery.data ?? null;
  // A 401 is handled globally (lib/query.tsx: clear token + redirect to
  // /login?session=expired) — don't also flash an inline alert for it.
  const err = invoicesQuery.error;
  const error =
    err && !(err instanceof ApiError && err.status === 401)
      ? err instanceof Error
        ? err.message
        : "Failed to load payments."
      : null;

  return (
    <div className="account-cinema">
      <div className="ac-wrap">
        <Link href="/account" className="back-link">
          ← Account
        </Link>
        <h1 className="page-title">Payment history</h1>
        <p className="page-sub">All of your payments.</p>

        {error && <div className="alert alert-error">{error}</div>}

        <section className="account-section">
          {invoices === null ? (
            <div className="centered-state">
              <div className="spinner" aria-label={STR.common.loadingLabel} />
            </div>
          ) : invoices.length === 0 ? (
            <p className="empty">No payments yet.</p>
          ) : (
            <table className="pay-table">
              <thead>
                <tr>
                  <th>{STR.labels.date}</th>
                  <th>{STR.labels.description}</th>
                  <th>Amount</th>
                  <th>{STR.labels.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{fmtDate(inv.created)}</td>
                    <td>{inv.description ?? "—"}</td>
                    <td>
                      {formatMoney(
                        inv.amountPaid || inv.amountDue,
                        inv.currency,
                      )}
                    </td>
                    <td>
                      <span className={`pay-badge ${inv.status}`}>
                        {inv.status}
                      </span>
                    </td>
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
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <AuthGate>
      <PaymentsInner />
    </AuthGate>
  );
}
