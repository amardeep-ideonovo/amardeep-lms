import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { isProduction } from "../common/env.util";

// Signed, self-contained "start a site preview" handoff tokens. Same crypto
// shape as auth/reset-token.util.ts (`base64url(payload).HMAC`, keyed by the
// secret the rest of the API trusts) but deliberately weaker in reach: the
// payload is just `nonce expiresAtMs` — NO user id, NO PII — because the token
// rides in a `?token=` URL the admin opens in the member site. It authorizes
// nothing more than "mint the two fixed preview-member sessions"; the
// admin-guarded POST /admin/site-preview is what actually gates issuance.
//
// A 60-second lifetime (unguessable + audited at mint) makes replay
// impractical, which is why there is no nonce store — the token is stateless
// and dies on expiry, exactly like the reset-token util.

export const PREVIEW_HANDOFF_TTL_SECONDS = 60;
const PREVIEW_HANDOFF_TTL_MS = PREVIEW_HANDOFF_TTL_SECONDS * 1000;

// Resolved per call from the same sources the other token utils trust. FAILS
// CLOSED in production: with neither secret set we refuse the dev constant
// rather than mint forgeable handoffs.
function previewSecret(): string {
  const configured = process.env.JWT_SECRET || process.env.SETTINGS_ENC_KEY;
  if (configured) return configured;
  if (isProduction()) {
    throw new Error(
      "No JWT_SECRET/SETTINGS_ENC_KEY set. Refusing to sign site-preview " +
        "handoff tokens with the insecure dev fallback (set one, or ENV_NAME=development).",
    );
  }
  return "dev-insecure-secret";
}

// Domain separation: the reset/unsubscribe/confirm utils HMAC their payloads
// with the SAME secret, so this distinct prefix stops a handoff token from ever
// verifying under one of those flows (or vice-versa). Never appears in the
// token itself — only in the MAC input.
const MAC_DOMAIN = "lms.site-preview.v1\n";

// NUL separator, same convention as reset-token.util.ts. Can't appear in the
// hex nonce or the integer timestamp, so the payload round-trips unambiguously.
const SEP = "\0";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  return createHmac("sha256", previewSecret())
    .update(MAC_DOMAIN + payload)
    .digest("hex");
}

// Build an opaque, short-lived preview handoff token. Not bound to a user —
// the exchange issues sessions for BOTH fixed preview identities.
export function makePreviewHandoffToken(): string {
  const nonce = randomBytes(16).toString("hex");
  const expiresAtMs = Date.now() + PREVIEW_HANDOFF_TTL_MS;
  const raw = [nonce, expiresAtMs].join(SEP);
  return `${b64url(Buffer.from(raw, "utf8"))}.${sign(raw)}`;
}

// Verify structure, signature and expiry. Returns `{ ok: true }` or null.
// Never throws (public exchange route): a misconfigured production (no secret)
// degrades to "invalid token" rather than a 500. Constant-time MAC compare.
export function verifyPreviewHandoffToken(
  token: string | undefined | null,
): { ok: true } | null {
  if (!token || typeof token !== "string" || token.length > 512) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let raw: string;
  try {
    raw = fromB64url(payload).toString("utf8");
  } catch {
    return null;
  }

  let expected: string;
  try {
    expected = sign(raw);
  } catch {
    return null;
  }
  if (mac.length !== expected.length) return null;
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  } catch {
    return null;
  }
  if (!ok) return null;

  const parts = raw.split(SEP);
  if (parts.length !== 2) return null;
  const [nonce, expStr] = parts;
  if (!nonce) return null;
  const expiresAtMs = Number(expStr);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;

  return { ok: true };
}
