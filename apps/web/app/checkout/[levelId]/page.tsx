"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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

// Stable display order: monthly before annual, then by amount.
function sortPrices(prices: PriceDTO[]): PriceDTO[] {
  const rank = (i: string) => (i === "month" ? 0 : i === "year" ? 1 : 2);
  return [...prices].sort(
    (a, b) => rank(a.interval) - rank(b.interval) || a.amount - b.amount
  );
}

function CheckoutInner() {
  const router = useRouter();
  const params = useParams<{ levelId: string }>();
  const levelId = params.levelId;

  const [levels, setLevels] = useState<LevelDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);

  // No single-level endpoint exists; fetch all and pick this one client-side.
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
        setError(
          err instanceof Error ? err.message : "Failed to load this plan."
        );
      });
    // Best-effort: flag if the member already pays for this level so we show
    // "manage" instead of a duplicate-checkout CTA (the server also guards it).
    // A failure here must never block the checkout page.
    api
      .mySubscriptions()
      .then((subs) => {
        if (active) {
          setAlreadySubscribed(subs.some((s) => s.levelId === levelId));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router, levelId]);

  const level = useMemo(
    () => (levels || []).find((l) => l.id === levelId) || null,
    [levels, levelId]
  );
  const prices = useMemo(() => (level ? sortPrices(level.prices) : []), [level]);

  // Default the selection to the first (monthly) option once loaded.
  useEffect(() => {
    if (prices.length > 0 && selectedPriceId === null) {
      setSelectedPriceId(prices[0].id);
    }
  }, [prices, selectedPriceId]);

  async function subscribe() {
    const price = prices.find((p) => p.id === selectedPriceId);
    if (!price) return;
    setError(null);
    setBusy(true);
    try {
      // Server creates a Stripe Checkout Session and returns its hosted URL.
      const { url } = await api.checkout(price.stripePriceId);
      window.location.href = url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  if (levels === null) {
    return error ? (
      <>
        <Link href="/pricing" className="back-link">
          ← All plans
        </Link>
        <div className="alert alert-error">{error}</div>
      </>
    ) : (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!level || prices.length === 0) {
    return (
      <>
        <Link href="/pricing" className="back-link">
          ← All plans
        </Link>
        <h1 className="page-title">Plan unavailable</h1>
        <p className="empty">
          This plan isn’t available right now. Browse the plans we offer.
        </p>
      </>
    );
  }

  return (
    <>
      <Link href="/pricing" className="back-link">
        ← All plans
      </Link>
      <h1 className="page-title">{level.name}</h1>
      {alreadySubscribed ? (
        <div className="account-section">
          <div className="alert alert-info">
            You’re already subscribed to this plan.
          </div>
          <p>Change your billing or cancel anytime from your account.</p>
          <Link href="/account" className="btn btn-primary">
            Manage subscription
          </Link>
        </div>
      ) : (
        <>
          <p className="page-sub">
            Confirm your billing option and continue to secure checkout.
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="account-section">
            <h2>Choose billing</h2>
            <div className="plan-list">
              {prices.map((price) => {
                const active = price.id === selectedPriceId;
                return (
                  <label
                    key={price.id}
                    className={`plan-row selectable${active ? " selected" : ""}`}
                  >
                    <div className="plan-info">
                      <h3>{price.interval === "year" ? "Annual" : "Monthly"}</h3>
                      <span>{formatPrice(price)}</span>
                    </div>
                    <input
                      type="radio"
                      name="billing-interval"
                      value={price.id}
                      checked={active}
                      onChange={() => setSelectedPriceId(price.id)}
                      aria-label={`${price.interval} billing`}
                    />
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              className="btn btn-primary btn-block checkout-cta"
              onClick={subscribe}
              disabled={busy || !selectedPriceId}
            >
              {busy ? "Redirecting…" : "Continue to checkout"}
            </button>
            <p className="checkout-note">
              You’ll be redirected to Stripe to complete your purchase securely.
            </p>
          </div>
        </>
      )}
    </>
  );
}

export default function CheckoutPage() {
  return (
    <AuthGate>
      <CheckoutInner />
    </AuthGate>
  );
}
