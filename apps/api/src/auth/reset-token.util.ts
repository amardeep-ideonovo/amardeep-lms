import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { isProduction } from '../common/env.util';

// Signed, self-contained password-reset tokens. Mirrors the crypto in
// email/unsubscribe.util.ts and contacts/confirm-token.util.ts: a token is
// `base64url(payload).HMAC` keyed by the same secret the rest of the API
// trusts. It carries no DB row — the payload is `userId expiresAtMs fp`
// where `fp` is a short fingerprint of the user's CURRENT password hash.
// That fingerprint is what makes the token effectively single-use: the
// moment the password changes (via this flow or any other), every
// outstanding reset token for the account stops matching and dies, with no
// token table or cleanup job needed.

// Tokens expire after 45 minutes — long enough to survive a slow inbox,
// short enough that a leaked email doesn't stay dangerous. Exposed in
// minutes too so the email copy can state the real window.
export const RESET_TOKEN_TTL_MINUTES = 45;
export const RESET_TOKEN_TTL_MS = RESET_TOKEN_TTL_MINUTES * 60 * 1000;

// The signing secret, resolved per call from the same sources the other
// token utils trust (JWT_SECRET, then the settings encryption key). FAILS
// CLOSED in production: with neither set we refuse the public dev constant —
// otherwise anyone could mint a reset token for any account, which is a
// full account takeover. Outside production the dev constant keeps local
// links working.
function resetSecret(): string {
  const configured = process.env.JWT_SECRET || process.env.SETTINGS_ENC_KEY;
  if (configured) return configured;
  if (isProduction()) {
    throw new Error(
      'No JWT_SECRET/SETTINGS_ENC_KEY set. Refusing to sign password-reset ' +
        'tokens with the insecure dev fallback (set one, or ENV_NAME=development).',
    );
  }
  return 'dev-insecure-secret';
}

// Domain-separation prefix mixed into every MAC. The unsubscribe and confirm
// utils HMAC their raw payloads with the SAME secret, so without this a token
// minted by one flow could verify under another (cross-protocol replay). The
// prefix never appears in the token itself — only in the MAC input.
const MAC_DOMAIN = 'lms.password-reset.v1\n';

// Field separator inside the decoded payload: a NUL byte, same convention as
// confirm-token.util.ts. It can never appear in a cuid user id, an integer
// timestamp or a hex fingerprint, so the payload round-trips unambiguously.
// (Beware: editors render the NUL as an invisible blank — it is NOT a space.)
const SEP = '\0';

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

// HMAC-SHA256 of the domain-prefixed payload, hex-encoded.
function sign(payload: string): string {
  return createHmac('sha256', resetSecret())
    .update(MAC_DOMAIN + payload)
    .digest('hex');
}

// Short fingerprint of a bcrypt password hash. NOT the hash itself — the
// payload half of the token is plain base64url (recoverable by anyone who
// sees the email), so the stored hash must never ride in it. SHA-256 is
// one-way and 16 hex chars (64 bits) is far more than enough to detect
// "password changed since this token was minted"; it reveals nothing useful
// about the hash, let alone the password.
export function passwordHashFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

// What a structurally-valid, authentic, unexpired token decodes to. The
// caller still owns the LIVENESS check: load the user and require
// fingerprintMatches(fingerprint, passwordHashFingerprint(user.passwordHash))
// so a token dies the moment the password it was minted against changes.
export interface ResetTokenData {
  userId: string;
  fingerprint: string;
}

// Build the opaque reset token for a user and their CURRENT password hash.
export function makePasswordResetToken(
  userId: string,
  passwordHash: string,
): string {
  const expiresAtMs = Date.now() + RESET_TOKEN_TTL_MS;
  const raw = [userId, expiresAtMs, passwordHashFingerprint(passwordHash)].join(
    SEP,
  );
  return `${b64url(Buffer.from(raw, 'utf8'))}.${sign(raw)}`;
}

// Verify a token's structure, signature and expiry, recovering
// { userId, fingerprint } — or null if it's missing/malformed/expired/has a
// bad MAC. Constant-time HMAC comparison so a token can't be brute-forced
// byte-by-byte via timing. Never throws: like verifyUnsubscribeToken, a
// misconfigured production (no signing secret) degrades to "invalid token"
// on this public, unauthenticated path rather than a 500.
export function verifyPasswordResetToken(
  token: string | undefined | null,
): ResetTokenData | null {
  if (!token || typeof token !== 'string' || token.length > 512) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let raw: string;
  try {
    raw = fromB64url(payload).toString('utf8');
  } catch {
    return null;
  }

  // sign() fails closed (throws) in a misconfigured production. Degrade to
  // "invalid token" instead of surfacing a 500 from a public route.
  let expected: string;
  try {
    expected = sign(raw);
  } catch {
    return null;
  }
  // Lengths must match before timingSafeEqual (it throws on length mismatch).
  if (mac.length !== expected.length) return null;
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return null;
  }
  if (!ok) return null;

  const parts = raw.split(SEP);
  if (parts.length !== 3) return null;
  const [userId, expStr, fingerprint] = parts;
  if (!userId || !fingerprint) return null;
  const expiresAtMs = Number(expStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;

  return { userId, fingerprint };
}

// Constant-time equality for two fingerprints (token vs. freshly computed).
// The values aren't secrets, but the comparison sits on an unauthenticated
// route — cheap to keep it timing-neutral like the rest of the file.
export function fingerprintMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
