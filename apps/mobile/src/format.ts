// Small display formatters shared across screens (ports of the web's helpers
// so both clients render the same strings).

// "2hr 52min" / "45min" — total class duration (web classes/[slug] fmtTotal).
export function fmtTotalDuration(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || totalSeconds <= 0) return "";
  const mins = Math.round(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}hr ${m}min` : `${m}min`;
}

// Stripe amounts are minor units (cents). Hermes ships Intl, but keep a plain
// fallback so a missing locale can never crash a billing screen.
export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `$${(amount / 100).toFixed(2)}`;
  }
}

export function fmtDate(iso: string | number | null | undefined): string {
  if (!iso) return "";
  try {
    const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// Parse a Vimeo URL into its player embed URL (or null if not a Vimeo link).
// Supports the optional privacy hash (?h=xxxx or vimeo.com/<id>/<hash>).
export function vimeoEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
  if (!id) return null;
  const h =
    url.match(/[?&]h=([0-9A-Za-z]+)/)?.[1] ??
    url.match(/vimeo\.com\/\d+\/([0-9A-Za-z]+)/)?.[1];
  const params = [h ? `h=${h}` : "", "title=0", "byline=0", "portrait=0"]
    .filter(Boolean)
    .join("&");
  return `https://player.vimeo.com/video/${id}?${params}`;
}
