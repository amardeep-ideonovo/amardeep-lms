"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

function ThankYouInner() {
  const params = useSearchParams();
  const className = params.get("class")?.trim() || "";
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(true);

  // The member just paid, so the most recent invoice with a hosted URL is this
  // purchase's receipt. Optional — if it isn't ready, fall back to the account
  // payment history.
  useEffect(() => {
    let active = true;
    api
      .myInvoices()
      .then((invoices) => {
        if (!active) return;
        const withReceipt = invoices.find((i) => i.hostedInvoiceUrl);
        setReceiptUrl(withReceipt?.hostedInvoiceUrl ?? null);
      })
      .catch(() => {
        /* receipt is optional; the button falls back to payment history */
      })
      .finally(() => {
        if (active) setLoadingReceipt(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <div className="thankyou">
      <div className="thankyou-check" aria-hidden="true">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </div>

      <h1 className="page-title">
        {className ? `Thank you for joining ${className}!` : "Thank you for your purchase!"}
      </h1>
      <p className="page-sub">
        Your enrollment is confirmed. You can start learning right away, or view
        your receipt for this payment.
      </p>

      <div className="thankyou-actions">
        <Link href="/dashboard" className="btn btn-primary">
          Go to dashboard
        </Link>
        {receiptUrl ? (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            View receipt ↗
          </a>
        ) : (
          <Link href="/account/payments" className="btn btn-secondary">
            {loadingReceipt ? "Loading receipt…" : "View receipt"}
          </Link>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense
      fallback={
        <div className="centered-state">
          <div className="spinner" aria-label="Loading" />
        </div>
      }
    >
      <ThankYouInner />
    </Suspense>
  );
}
