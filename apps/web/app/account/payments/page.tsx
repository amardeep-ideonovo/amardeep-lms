"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

function money(amount: number, currency: string): string {
  return (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PaymentsInner() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .myInvoices()
      .then((i) => active && setInvoices(i))
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load payments.");
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <>
      <Link href="/account" className="back-link">
        ← Account
      </Link>
      <h1 className="page-title">Payment history</h1>
      <p className="page-sub">All of your payments.</p>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="account-section">
        {invoices === null ? (
          <div className="centered-state">
            <div className="spinner" aria-label="Loading" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="empty">No payments yet.</p>
        ) : (
          <table className="pay-table">
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
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{fmtDate(inv.created)}</td>
                  <td>{inv.description ?? "—"}</td>
                  <td>{money(inv.amountPaid || inv.amountDue, inv.currency)}</td>
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
    </>
  );
}

export default function PaymentsPage() {
  return (
    <AuthGate>
      <PaymentsInner />
    </AuthGate>
  );
}
