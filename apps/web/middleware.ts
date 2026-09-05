import { NextResponse, type NextRequest } from "next/server";

// Middleware does two things per request:
//  1. Copies the pathname into `x-pathname` so the root layout can resolve the
//     site header for THIS route at SSR (Server Components can't read the path).
//  2. Sets the security Content-Security-Policy with a per-request nonce.
//
// CSP delivery: we set the policy on the REQUEST headers under the enforcing
// name so Next.js reads the nonce and stamps it onto its own <script> tags
// (and next/script) — this makes the app nonce-correct in BOTH report-only and
// enforcing modes. The RESPONSE header name is report-only by default and flips
// to enforcing when CSP_ENFORCE=1, so the strict script policy can bake (watch
// for violations) before it starts blocking. See docs / SHIPPING notes.
//
// The static headers (HSTS, nosniff, Referrer-Policy, Permissions-Policy) live
// in next.config.js headers(); frame protection is per-path here because the
// /forms route is intentionally embeddable cross-origin.

const CSP_ENFORCE = process.env.CSP_ENFORCE === "1";

function buildCsp(nonce: string, pathname: string): string {
  // /forms/[id] is an embeddable form (rendered inside arbitrary third-party
  // pages), so it must NOT restrict frame-ancestors. Every other route is
  // same-origin-only.
  const embeddable = pathname.startsWith("/forms");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // strict-dynamic: only nonce'd scripts (ours) and what THEY load run, so an
    // injected inline <script> without the nonce is blocked — that's the XSS
    // win. wasm-unsafe-eval is required by the Zoom Meeting SDK on /live.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    // unsafe-inline stays for styles: React style props, Puck, and CMS/rich-text
    // inline styles are pervasive and can't carry a nonce. Styles aren't a
    // script-execution vector.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    // Broad connect/frame so the per-instance API origin, websockets (Zoom/
    // socket), and admin-pasted CMS embeds keep working; neither executes code.
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "frame-src 'self' https:",
    "form-action 'self'",
    embeddable ? "" : "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, req.nextUrl.pathname);

  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  headers.set("x-nonce", nonce);
  // Enforcing name on the REQUEST so Next stamps the nonce onto its scripts,
  // regardless of the response mode below.
  headers.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set(
    CSP_ENFORCE
      ? "content-security-policy"
      : "content-security-policy-report-only",
    csp,
  );
  // Legacy clickjacking header for browsers without CSP frame-ancestors. Omitted
  // on the embeddable /forms route.
  if (!req.nextUrl.pathname.startsWith("/forms")) {
    res.headers.set("x-frame-options", "SAMEORIGIN");
  }
  return res;
}

export const config = {
  // Run on real page routes only — skip Next internals and any path with a file
  // extension (env.js, favicon.ico, images, etc.).
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
