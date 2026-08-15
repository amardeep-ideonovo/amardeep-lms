// Shared display formatters (docs/coding-standards.md D2/D5). The census found
// the currency formatter re-written in 13 files, the bytes ladder in 5, and
// the long-date shape in 6 — these are the canonical versions. Locale is
// always `undefined` (the viewer's own locale); never hardcode "en-US".
//
// Only sites with EXACTLY these semantics migrate here — a formatter with
// different rounding (e.g. the reports MRR card's 0-fraction-digits display)
// keeps its bespoke Intl call.

/**
 * Money from minor units (Stripe-style cents). The try/catch keeps a missing
 * Intl locale from ever crashing a billing surface (mobile's Hermes lesson).
 */
export function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `$${(amountCents / 100).toFixed(2)}`;
  }
}

/** 512 → "512 B", 2048 → "2 KB", 5 500 000 → "5.2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "August 15, 2026" in the viewer's locale; "" for missing input. */
export function formatDateLong(
  input: string | Date | null | undefined,
): string {
  if (!input) return "";
  try {
    const d = input instanceof Date ? input : new Date(input);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
