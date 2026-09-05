import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { isProduction } from "../common/env.util";

// Cookie-based member session (web only). The mobile + admin apps keep using the
// Authorization: Bearer header and are unaffected. We deliberately avoid the
// cookie-parser dependency: setting cookies uses Express res.cookie(), and the
// few places that READ a cookie parse the Cookie header themselves (below).
//
// Three cookies are issued together at login/signup/change-password and cleared
// together at logout, so they can never desync:
//  - lms_session   httpOnly  — the JWT itself (the security boundary; JS can't read it)
//  - csrf_token    readable   — double-submit CSRF token the web echoes in a header
//  - lms_authed    readable   — a "a session exists" hint the web/SSR use to gate UI
export const SESSION_COOKIE = "lms_session";
export const CSRF_COOKIE = "csrf_token";
export const HINT_COOKIE = "lms_authed";

// Parse a Cookie header into a map. Tolerant of spacing and missing values.
export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers?.cookie;
  if (typeof header !== "string") return null;
  return parseCookies(header)[name] ?? null;
}

// Session lifetime: keep the cookie and the JWT expiring together, both driven
// by JWT_TTL (auth.module.ts). Supports Nd / Nh / Nm / Ns; default 7 days.
function sessionMaxAgeMs(): number {
  const raw = (process.env.JWT_TTL || "7d").trim();
  const m = /^(\d+)\s*([dhms])$/.exec(raw);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { d: 86400000, h: 3600000, m: 60000, s: 1000 }[m[2]] ?? 86400000;
  return n * unit;
}

function baseOptions() {
  return {
    // Web and API are always subdomains of one registrable domain (fleet:
    // <sub>.app.<domain> + <sub>-api.app.<domain>; custom: acme.com + api.acme.com),
    // so SameSite=Lax cookies are sent on every web→API request and withheld
    // cross-site. Host-only (no Domain) keeps the cookie on the API host.
    sameSite: "lax" as const,
    secure: isProduction(), // http://localhost dev still works; prod is always Secure
    path: "/",
    maxAge: sessionMaxAgeMs(),
  };
}

// Issue all three auth cookies. `token` is the freshly-signed member JWT.
export function setAuthCookies(res: Response, token: string): void {
  const opts = baseOptions();
  res.cookie(SESSION_COOKIE, token, { ...opts, httpOnly: true });
  res.cookie(CSRF_COOKIE, randomBytes(32).toString("hex"), {
    ...opts,
    httpOnly: false,
  });
  res.cookie(HINT_COOKIE, "1", { ...opts, httpOnly: false });
}

// Clear all three (logout / account deletion). Clearing must use matching
// path/sameSite/secure or the browser keeps the old cookie.
export function clearAuthCookies(res: Response): void {
  const opts = { sameSite: "lax" as const, secure: isProduction(), path: "/" };
  res.clearCookie(SESSION_COOKIE, { ...opts, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
  res.clearCookie(HINT_COOKIE, { ...opts, httpOnly: false });
}
