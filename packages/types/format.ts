// Shared display formatters (docs/coding-standards.md D2/D5). The census found
// the currency formatter re-written in 13 files, the bytes ladder in 5, and
// the long-date shape in 6 — these are the canonical versions. Locale is
// always `undefined` (the viewer's own locale); never hardcode "en-US".
//
// Only sites with EXACTLY these semantics migrate here — a formatter with
// different rounding (e.g. the reports MRR card's 0-fraction-digits display)
// keeps its bespoke Intl call.

/**
 * URL-slug from arbitrary text ("Modern Science" → "modern-science"). This is a
 * VERBATIM port of the API's server-side slugify (levels.service.ts) so a
 * client-side live preview (the class form autofills the slug as you type)
 * matches exactly what the server would generate on save. The server stays the
 * uniqueness backstop (it appends -2/-3 on collision).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

/**
 * The mobile "connect code" a member types into the shared Spotlight app to bind
 * it to this academy. On the fleet each instance is served at
 * `<code>.<platform-domain>` (e.g. `solitaire-web-solution.thewebpaanda.com`),
 * and that leading DNS label IS the connect code the control plane resolves.
 *
 * Derives it from the member website origin, which both the admin (`webUrl()`)
 * and the member web app know at runtime. Returns null for a bare/custom apex
 * domain (`a.b`), a localhost dev origin, or an infra subdomain (api/admin/www)
 * — i.e. anywhere a code can't be inferred; callers then fall back to showing
 * the site address itself, which the app's Connect screen also accepts.
 */
export function mobileConnectCode(
  webUrl: string | null | undefined,
): string | null {
  if (!webUrl) return null;
  let host: string;
  try {
    host = new URL(webUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = host.split(".").filter(Boolean);
  // Fewer than 3 labels = an apex/custom domain (a.b) or a bare host (localhost);
  // there is no instance subdomain to read a code from.
  if (labels.length < 3) return null;
  const first = labels[0];
  // The member site is `<code>.<domain>`; these are infra hosts, never a code.
  if (
    first === "www" ||
    first === "api" ||
    first === "admin" ||
    first === "app"
  )
    return null;
  return first;
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
