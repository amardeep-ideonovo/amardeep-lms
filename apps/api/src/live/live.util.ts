import type { LiveProvider } from '@lms/types';

// Allowed host suffixes per provider. A join URL must be https AND land on the
// provider's real domain — this blocks an admin (or a tampered DB row) from
// pointing a "Zoom" session at an attacker-controlled look-alike. Enforced on
// write and re-checked on decrypt before any URL is handed out.
const HOST_SUFFIX: Record<LiveProvider, string[]> = {
  ZOOM: ['zoom.us'],
  GOOGLE_MEET: ['meet.google.com'],
};

// True when `url` is a valid https URL whose host equals, or is a subdomain of,
// an allowed host for `provider` (e.g. us02web.zoom.us for ZOOM). Suffix matching
// is anchored on a dot so "zoom.us.evil.com" and "notzoom.us" are rejected.
export function providerHostAllowed(provider: LiveProvider, url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return HOST_SUFFIX[provider].some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

// Human label for member-facing copy / admin errors.
export function providerLabel(provider: LiveProvider): string {
  return provider === 'ZOOM' ? 'Zoom' : 'Google Meet';
}
