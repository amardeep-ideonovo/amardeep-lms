import { createHmac, timingSafeEqual } from 'crypto';

// Signed, self-contained unsubscribe tokens for one-click List-Unsubscribe and
// the public /unsubscribe page. A token is `base64url(email).HMAC` where the
// HMAC is keyed by the same secret used for JWTs (falling back to the settings
// encryption key, then a dev constant). It carries no DB row — verification is
// purely cryptographic, so a token stays valid as long as the secret does and
// can't be forged without it. The email is recoverable (not encrypted) which is
// exactly what we want: the page needs to know who to unsubscribe.

// The signing secret, resolved once per process from the same sources the rest
// of the API trusts. Mirrors common/env.util's jwtSecret precedence but without
// the prod hard-fail (an unsubscribe link must keep working even if JWT_SECRET
// is somehow unset — the SETTINGS_ENC_KEY fallback is a real 32-byte secret in
// every configured environment).
function unsubscribeSecret(): string {
  return (
    process.env.JWT_SECRET ||
    process.env.SETTINGS_ENC_KEY ||
    'dev-insecure-secret'
  );
}

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  // Restore padding and the standard alphabet, then decode.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// HMAC-SHA256 of the (lowercased, trimmed) email, hex-encoded.
function sign(email: string): string {
  return createHmac('sha256', unsubscribeSecret()).update(email).digest('hex');
}

// Build the opaque token for an email address. Always normalizes the address
// first so the token round-trips to the canonical form we store on Contacts.
export function makeUnsubscribeToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  const payload = b64url(Buffer.from(normalized, 'utf8'));
  return `${payload}.${sign(normalized)}`;
}

// Verify a token and recover the email, or null if it's missing/malformed/has a
// bad signature. Constant-time HMAC comparison so a token can't be brute-forced
// byte-by-byte via timing.
export function verifyUnsubscribeToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let email: string;
  try {
    email = fromB64url(payload).toString('utf8');
  } catch {
    return null;
  }
  if (!email) return null;

  const expected = sign(email);
  // Lengths must match before timingSafeEqual (it throws on length mismatch).
  if (mac.length !== expected.length) return null;
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return null;
  }
  return ok ? email : null;
}
