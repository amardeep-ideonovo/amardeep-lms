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
  // Grab the numeric id from any vimeo.com path shape — vimeo.com/<id>,
  // /video/<id>, player.vimeo.com/video/<id>, or /channels|groups|showcase/<id>
  // (kept in step with the web vimeoEmbed and admin parseVimeoId).
  const id = url.match(/vimeo\.com\/(?:[^/?#]+\/)*(\d+)/)?.[1];
  if (!id) return null;
  const h =
    url.match(/[?&]h=([0-9A-Za-z]+)/)?.[1] ??
    url.match(/vimeo\.com\/\d+\/([0-9A-Za-z]+)/)?.[1];
  const params = [h ? `h=${h}` : "", "title=0", "byline=0", "portrait=0"]
    .filter(Boolean)
    .join("&");
  return `https://player.vimeo.com/video/${id}?${params}`;
}

// YouTube 11-char video id from watch / youtu.be / shorts / embed / v / live
// links (kept in sync with the web youtubeId and admin parseYouTubeId). null
// when the URL isn't YouTube.
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  return (
    url.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    )?.[1] ?? null
  );
}

// Privacy-domain YouTube embed for the in-app WebView, resuming via
// start=<seconds>. No JS-API bridge on mobile (no position heartbeat here yet),
// so this is display-only.
export function youtubeEmbed(
  url: string | null | undefined,
  startSeconds = 0,
): string | null {
  const id = youtubeId(url);
  if (!id) return null;
  const start = startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : "";
  return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1${start}`;
}

// A Vimeo/YouTube link — even one whose id we FAILED to parse. Such a URL must
// never reach the native expo-video player (it would show a dead/black box); it
// falls back to the thumbnail instead. Direct file URLs are not provider links.
export function isProviderVideoUrl(url: string | null | undefined): boolean {
  return (
    !!url &&
    /(?:youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com)/i.test(url)
  );
}
