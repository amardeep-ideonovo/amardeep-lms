import { NextResponse, type NextRequest } from "next/server";

// Sets the admin Content-Security-Policy with a per-request nonce. Same pattern
// as the member web (apps/web/middleware.ts): the policy is set on the REQUEST
// headers under the enforcing name so Next.js stamps the nonce onto its own
// scripts, and on the RESPONSE as report-only by default (flip CSP_ENFORCE=1 to
// enforce after a bake). The static headers (HSTS, nosniff, X-Frame-Options,
// Referrer-Policy, Permissions-Policy) live in next.config.js.
//
// Admin is never embedded and renders no arbitrary member content, so the policy
// is stricter than web's: no wasm. connect/frame stay broad for the per-instance
// API origin, the projects socket.io websocket, and the Puck editor's previews.

const CSP_ENFORCE = process.env.CSP_ENFORCE === "1";

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "frame-src 'self' https:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set(
    CSP_ENFORCE
      ? "content-security-policy"
      : "content-security-policy-report-only",
    csp,
  );
  return res;
}

export const config = {
  // Page routes only — skip Next internals and static files (incl. /env.js).
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
