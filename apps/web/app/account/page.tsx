"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LevelDTO, PriceDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

function formatPrice(p: PriceDTO): string {
  const amount = (p.amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (p.currency || "usd").toUpperCase(),
  });
  return `${amount} / ${p.interval}`;
}

function AccountInner() {
  const router = useRouter();
  const [levels, setLevels] = useState<LevelDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // priceId or "portal"

  useEffect(() => {
    let active = true;
    api
      .levels()
      .then((l) => active && setLevels(l))
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        // Levels listing is optional context; don't hard-fail the page.
        setLevels([]);
      });
    return () => {
      active = false;
    };
  }, [router]);

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
    setBusy("portal");
    try {
      const { url } = await api.portal();
      window.location.href = url;
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  }

  async function subscribe(priceId: string) {
    setError(null);
    setBusy(priceId);
    try {
      const { url } = await api.checkout(priceId);
      window.location.href = url;
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  }

  const paidLevels = (levels || []).filter((l) => l.prices.length > 0);

  return (
    <>
      <h1 className="page-title">Account</h1>
      <p className="page-sub">Manage your membership and billing.</p>

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
          disabled={busy === "portal"}
        >
          {busy === "portal" ? "Redirecting…" : "Manage subscription"}
        </button>
      </section>

      <section className="account-section">
        <h2>Subscribe to a plan</h2>
        <p>Pick a membership level to unlock more courses.</p>

        {levels === null ? (
          <div className="spinner" aria-label="Loading" />
        ) : paidLevels.length === 0 ? (
          <p className="empty">No plans are available right now.</p>
        ) : (
          <div className="plan-list">
            {paidLevels.map((level) =>
              level.prices.map((price) => (
                <div className="plan-row" key={price.id}>
                  <div className="plan-info">
                    <h3>{level.name}</h3>
                    <span>{formatPrice(price)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => subscribe(price.stripePriceId)}
                    disabled={busy === price.stripePriceId}
                  >
                    {busy === price.stripePriceId ? "Redirecting…" : "Subscribe"}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
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
