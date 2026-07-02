import { createHmac } from 'crypto';
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

// ---------------------------------------------------------------------------
// Zoom Meeting SDK (in-page embed) helpers
// ---------------------------------------------------------------------------

// Extract the numeric meeting id from a Zoom join URL (…/j/<digits>,
// …/wc/<digits>/join, …/w/<digits>, …/s/<digits>). Personal-link / vanity URLs
// (…/my/<name>) have no numeric id and return null — those can't be SDK-embedded.
export function parseZoomMeetingNumber(url: string): string | null {
  const m = url.match(/\/(?:j|w|wc|s)\/(\d{8,})/);
  return m ? m[1] : null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Build a Zoom Meeting SDK signature — a JWT (HS256) signed with the SDK Secret.
// role 0 = attendee. The secret never leaves the server; only this signature and
// the (public) SDK key are handed to the browser. expiresInSec is clamped to
// Zoom's allowed [1800, 172800] window.
export function zoomSdkSignature(
  sdkKey: string,
  sdkSecret: string,
  meetingNumber: string,
  role: number,
  expiresInSec: number,
): string {
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + Math.min(172800, Math.max(1800, Math.floor(expiresInSec)));
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      appKey: sdkKey,
      sdkKey,
      mn: meetingNumber,
      role,
      iat,
      exp,
      tokenExp: exp,
    }),
  );
  const signature = b64url(
    createHmac('sha256', sdkSecret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}
