"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LevelDTO, PriceDTO, SubscriptionDetailDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

function lowestPrice(prices: PriceDTO[]): PriceDTO | null {
  if (prices.length === 0) return null;
  return prices.reduce((min, p) => (p.amount < min.amount ? p : min), prices[0]);
}
function money(amount: number, currency: string): string {
  return (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  });
}

function AllPlansInner() {
  const router = useRouter();
  const [levels, setLevels] = useState<LevelDTO[] | null>(null);
  const [subs, setSubs] = useState<SubscriptionDetailDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [l, s] = await Promise.all([
          api.levels(),
          api.mySubscriptionDetails().catch(() => [] as SubscriptionDetailDTO[]),
        ]);
        if (!mounted) return;
        setLevels(l);
        setSubs(s);
        setError(null);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load plans.");
      }
    }
    load();
    // Refresh on tab focus so admin-added/changed plans show without a reload.
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  const subByLevel = new Map(subs.map((s) => [s.levelId, s]));
  // Every PAID level is a purchasable plan; FREE/MANUAL levels aren't listed.
  const planLevels = (levels || []).filter((l) => l.type === "PAID");

  return (
    <>
      <Link href="/account" className="back-link">
        ← Account
      </Link>
      <h1 className="page-title">All membership plans</h1>
      <p className="page-sub">Choose a plan to unlock more courses.</p>

      {error && <div className="alert alert-error">{error}</div>}

      {levels === null ? (
        <div className="centered-state">
          <div className="spinner" aria-label="Loading" />
        </div>
      ) : planLevels.length === 0 ? (
        <p className="empty">No plans are available right now.</p>
      ) : (
        <div className="card-grid">
          {planLevels.map((level) => {
            const sub = subByLevel.get(level.id);
            const low = lowestPrice(level.prices);

            if (sub) {
              return (
                <div key={level.id} className="card current">
                  <span className="plan-badge">Current plan</span>
                  <h3 className="card-title">{level.name}</h3>
                  <p className="card-desc">
                    {money(sub.amount, sub.currency)} / {sub.interval}
                  </p>
                  {sub.cancelAtPeriodEnd && (
                    <p className="card-note">Cancels at period end</p>
                  )}
                  {sub.paused && <p className="card-note">Billing paused</p>}
                  <Link href="/account" className="card-cta">
                    Manage subscription →
                  </Link>
                </div>
              );
            }
            if (low) {
              return (
                <Link
                  key={level.id}
                  href={`/checkout/${level.slug ?? level.id}`}
                  className="card"
                >
                  <h3 className="card-title">{level.name}</h3>
                  <p className="card-desc">
                    From {money(low.amount, low.currency)} / {low.interval}
                  </p>
                  <span className="card-cta">Choose plan →</span>
                </Link>
              );
            }
            return (
              <div key={level.id} className="card">
                <h3 className="card-title">{level.name}</h3>
                <p className="card-desc">Pricing coming soon</p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function AllPlansPage() {
  return (
    <AuthGate>
      <AllPlansInner />
    </AuthGate>
  );
}
