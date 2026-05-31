"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

// Stripe redirects back to /account?checkout=success|cancel after a Checkout
// Session. Entitlements update asynchronously via webhook, so success only
// promises the access "shortly". Reads search params → must sit in <Suspense>.
function CheckoutBanner() {
  const status = useSearchParams().get("checkout");
  if (status === "success") {
    return (
      <div className="alert alert-info">
        Subscription successful — your new access will appear shortly.
      </div>
    );
  }
  if (status === "cancel") {
    return (
      <div className="alert alert-info">
        Checkout canceled — you haven’t been charged.
      </div>
    );
  }
  return null;
}

function AccountInner() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      clearToken();
      router.replace("/login");
      return;
    }
    setError(err instanceof Error ? err.message : "Something went wrong.");
  }

  async function openPortal() {
    setError(null);
    setBusy(true);
    try {
      const { url } = await api.portal();
      window.location.href = url;
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Account</h1>
      <p className="page-sub">Manage your membership and billing.</p>

      <Suspense fallback={null}>
        <CheckoutBanner />
      </Suspense>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="account-section">
        <h2>Manage subscription</h2>
        <p>
          Update your card, change plan, or cancel through the secure Stripe
          customer portal.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openPortal}
          disabled={busy}
        >
          {busy ? "Redirecting…" : "Manage subscription"}
        </button>
      </section>

      <section className="account-section">
        <h2>Membership plans</h2>
        <p>Browse membership levels and subscribe to unlock more courses.</p>
        <Link href="/pricing" className="btn btn-secondary">
          View plans
        </Link>
      </section>
    </>
  );
}

export default function AccountPage() {
  return (
    <AuthGate>
      <AccountInner />
    </AuthGate>
  );
}
