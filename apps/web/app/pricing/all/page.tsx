"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ClassTileDTO,
  LevelDTO,
  PriceDTO,
  SubscriptionDetailDTO,
} from "@lms/types";
import { STR, formatMoney } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

function lowestPrice(prices: PriceDTO[]): PriceDTO | null {
  if (prices.length === 0) return null;
  return prices.reduce(
    (min, p) => (p.amount < min.amount ? p : min),
    prices[0],
  );
}
function AllPlansInner() {
  const router = useRouter();
  const [levels, setLevels] = useState<LevelDTO[] | null>(null);
  const [subs, setSubs] = useState<SubscriptionDetailDTO[]>([]);
  const [myClasses, setMyClasses] = useState<ClassTileDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [l, s, mc] = await Promise.all([
          api.levels(),
          api
            .mySubscriptionDetails()
            .catch(() => [] as SubscriptionDetailDTO[]),
          api.myClasses().catch(() => [] as ClassTileDTO[]),
        ]);
        if (!mounted) return;
        setLevels(l);
        setSubs(s);
        setMyClasses(mc);
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
    void load();
    // Refresh on tab focus so admin-added/changed plans show without a reload.
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
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
  // A member "owns" a class through ANY active entitlement — a paid subscription
  // OR an admin grant / free / lifetime enrollment. my-classes' `owned` flag is
  // the API's access.activeLevelIds (UserLevel ACTIVE), the single source of
  // truth; subscriptions alone miss admin grants, which would then wrongly show
  // as purchasable here (name + price + a /checkout link).
  const ownedIds = new Set(myClasses.filter((c) => c.owned).map((c) => c.id));
  // Every PAID level is a purchasable plan; FREE levels aren't listed.
  const planLevels = (levels || []).filter((l) => l.type === "PAID");
  // Current = an active paid subscription (price + manage). Available = classes
  // the member holds NO access to by any means, so an already-held class (bought
  // or admin-granted) is never offered for purchase.
  const currentPlans = planLevels.filter((l) => subByLevel.has(l.id));
  const otherPlans = planLevels.filter((l) => !ownedIds.has(l.id));

  function renderPlan(level: LevelDTO) {
    const sub = subByLevel.get(level.id);
    const low = lowestPrice(level.prices);
    if (sub) {
      return (
        <div key={level.id} className="card current">
          <span className="plan-badge">Current plan</span>
          <h3 className="card-title">{level.name}</h3>
          <p className="card-desc">
            {formatMoney(sub.amount, sub.currency)} / {sub.interval}
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
            From {formatMoney(low.amount, low.currency)} / {low.interval}
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
  }

  return (
    <div className="dark-page">
      <div className="dp-wrap">
        <Link href="/account" className="back-link">
          ← Account
        </Link>
        <h1 className="page-title">All membership plans</h1>
        <p className="page-sub">Choose a plan to unlock more courses.</p>

        {error && <div className="alert alert-error">{error}</div>}

        {levels === null ? (
          <div className="centered-state">
            <div className="spinner" aria-label={STR.common.loadingLabel} />
          </div>
        ) : planLevels.length === 0 ? (
          <p className="empty">No plans are available right now.</p>
        ) : (
          <>
            {currentPlans.length > 0 && (
              <section>
                <h2 className="section-title" style={{ marginTop: 8 }}>
                  Your plans
                </h2>
                <div className="card-grid">{currentPlans.map(renderPlan)}</div>
              </section>
            )}
            {otherPlans.length > 0 && (
              <section>
                <h2 className="section-title">Available plans</h2>
                <div className="card-grid">{otherPlans.map(renderPlan)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AllPlansPage() {
  return (
    <AuthGate>
      <AllPlansInner />
    </AuthGate>
  );
}
