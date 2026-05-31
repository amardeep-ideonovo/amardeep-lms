"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LevelDTO, MySubscriptionDTO, PriceDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

// The cheapest option for a level, shown as the "From …" headline on its card.
function lowestPrice(prices: PriceDTO[]): PriceDTO | null {
  if (prices.length === 0) return null;
  return prices.reduce((min, p) => (p.amount < min.amount ? p : min), prices[0]);
}

function formatAmount(p: PriceDTO): string {
  return (p.amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (p.currency || "usd").toUpperCase(),
  });
}

function PricingInner() {
  const router = useRouter();
  const [levels, setLevels] = useState<LevelDTO[] | null>(null);
  const [subscribedIds, setSubscribedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The member's own subscriptions are best-effort: a failure must not block
    // browsing plans (the server still guards a duplicate checkout).
    Promise.all([
      api.levels(),
      api.mySubscriptions().catch(() => [] as MySubscriptionDTO[]),
    ])
      .then(([l, subs]) => {
        if (!active) return;
        setLevels(l);
        setSubscribedIds(new Set(subs.map((s) => s.levelId)));
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load plans.");
      });
    return () => {
      active = false;
    };
  }, [router]);

  // Only PAID levels carry prices; FREE/MANUAL levels can't be checked out.
  const paidLevels = (levels || []).filter((l) => l.prices.length > 0);

  return (
    <>
      <h1 className="page-title">Membership plans</h1>
      <p className="page-sub">Choose a plan to unlock more courses.</p>

      {error && <div className="alert alert-error">{error}</div>}

      {levels === null ? (
        <div className="centered-state">
          <div className="spinner" aria-label="Loading" />
        </div>
      ) : paidLevels.length === 0 ? (
        <p className="empty">No plans are available right now.</p>
      ) : (
        <div className="card-grid">
          {paidLevels.map((level) => {
            const low = lowestPrice(level.prices);
            // Already paying for this level → not a checkout target; send them
            // to the account page to manage it via the Stripe customer portal.
            if (subscribedIds.has(level.id)) {
              return (
                <div key={level.id} className="card current">
                  <span className="plan-badge">Current plan</span>
                  <h3 className="card-title">{level.name}</h3>
                  {low && (
                    <p className="card-desc">
                      {formatAmount(low)} / {low.interval}
                    </p>
                  )}
                  <Link href="/account" className="card-cta">
                    Manage subscription →
                  </Link>
                </div>
              );
            }
            return (
              <Link
                key={level.id}
                href={`/checkout/${level.id}`}
                className="card"
              >
                <h3 className="card-title">{level.name}</h3>
                {low && (
                  <p className="card-desc">
                    From {formatAmount(low)} / {low.interval}
                  </p>
                )}
                <span className="card-cta">Choose plan →</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function PricingPage() {
  return (
    <AuthGate>
      <PricingInner />
    </AuthGate>
  );
}
