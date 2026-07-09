// Per-level checkout configuration, keyed by a human-editable URL slug.
//
// This is the "frontend-only editable id": the route is /checkout/<slug>, and
// you change/rename slugs here in code (e.g. use "pro" so the URL is
// /checkout/pro). Nothing in the database needs a slug column.
//
// `resolveCheckoutConfig()` also falls back to treating the route param as a
// raw Level id, so existing /checkout/<levelId> links (e.g. from the pricing
// page) keep working unchanged.
import type { PriceDTO } from "@lms/types";
import { api } from "./api";

// A single selectable option under "SELECT PRODUCT".
export type CheckoutProductOption = {
  key: string; // stable id for the radio input
  title: string; // bold product title
  subLabel: string; // small caption, e.g. "12 MONTHLY PAYMENTS"
  priceText: string; // right-aligned price/terms, e.g. "$167.00/Month"
  kind: "recurring" | "one_time";
  stripePriceId: string | null; // the Stripe price this option charges (price_…)
  localPriceId: string | null; // backend Price.id — the provider-neutral id (PayPal needs it)
  amount: number; // minor units — drives the summary total + coupon math
  currency: string; // ISO currency, e.g. "usd"
};

// The id the API accepts for this option (it resolves both forms). Null when
// the option carries neither (an unfilled hand-tuned placeholder).
export function optionWireId(opt: CheckoutProductOption): string | null {
  return opt.localPriceId ?? opt.stripePriceId;
}

export type LevelCheckoutConfig = {
  slug: string; // URL key: /checkout/<slug>
  levelId: string; // backend Level id this checkout enrolls into
  heading: string; // product family heading
  options: CheckoutProductOption[];
};

// ─── Editable slug → level map ───────────────────────────────────────────────
// Add an entry per level you want a pretty URL for. Set levelId + stripePriceId
// to the real ids from your admin (Levels page). Until then,
// /checkout/<rawLevelId> still works via the fallback below.
// Intentionally empty in shipped code. Hand-tuned slug configs win over the
// backend lookup in resolveCheckoutConfig(), so any entry here renders on EVERY
// client instance regardless of that instance's own catalog — a demo/sample
// entry (the removed "stripe-test", like the earlier "master-class") would show
// a real-looking but un-chargeable checkout, wired to the developer's own level
// id + Stripe price. Add pretty slugs per-instance from the admin instead, or
// gate any dev sample behind an explicit dev-only flag. Every /checkout/<slug>
// still resolves via the backend-by-slug-or-levelId fallback below.
export const CHECKOUT_LEVELS: Record<string, LevelCheckoutConfig> = {};

export function formatMoney(amount: number, currency: string): string {
  return (amount / 100).toLocaleString(undefined, {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  });
}

// Build an option from a level's recurring Stripe price (fallback path).
function priceToOption(levelName: string, p: PriceDTO): CheckoutProductOption {
  const money = formatMoney(p.amount, p.currency);
  // Installment plan: bill N times, then the member keeps the level for life.
  if (p.installments != null) {
    const cadence = p.interval === "year" ? "YEARLY" : "MONTHLY";
    return {
      key: p.id,
      title: `${levelName} | ${p.installments}-Payment Plan (then lifetime)`,
      subLabel: `${p.installments} ${cadence} PAYMENTS, THEN LIFETIME`,
      priceText: `${money}/${p.interval}`,
      kind: "recurring",
      stripePriceId: p.stripePriceId,
      localPriceId: p.id,
      amount: p.amount,
      currency: p.currency || "usd",
    };
  }
  return {
    key: p.id,
    title: `${levelName} | ${p.interval === "year" ? "Annual" : "Monthly"} Plan`,
    subLabel: p.interval === "year" ? "BILLED YEARLY" : "BILLED MONTHLY",
    priceText: `${money}/${p.interval}`,
    kind: "recurring",
    stripePriceId: p.stripePriceId,
    localPriceId: p.id,
    amount: p.amount,
    currency: p.currency || "usd",
  };
}

// Resolve a route param (slug OR raw level id) to a checkout config.
// Returns null when nothing matches (the page shows a "not found" state).
export async function resolveCheckoutConfig(
  idOrSlug: string,
): Promise<LevelCheckoutConfig | null> {
  // Hand-tuned configs above win (e.g. the stripe-test slug).
  const bySlug = CHECKOUT_LEVELS[idOrSlug];
  if (bySlug) return bySlug;

  // Otherwise resolve from the backend by slug OR raw id — a PUBLIC endpoint, so
  // this works for logged-out visitors (the old levels-list path needed auth).
  try {
    const level = await api.checkoutLevel(idOrSlug);
    if (!level || level.prices.length === 0) return null;
    return {
      slug: level.slug ?? level.id,
      levelId: level.id,
      heading: level.name,
      options: level.prices.map((p) => priceToOption(level.name, p)),
    };
  } catch {
    return null; // 404 / network → the page shows "Checkout not found"
  }
}
