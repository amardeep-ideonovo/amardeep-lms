// In production the admin is served under a path prefix (e.g. "/admin") behind a
// reverse proxy. basePath makes Next prefix BOTH routes and /_next asset URLs, so
// the HTML references chunks at /admin/_next/... instead of /_next/... (which 404
// when the app isn't mounted at the domain root). Leave NEXT_PUBLIC_ADMIN_BASE_PATH
// unset for local dev (admin runs at the root of its dev port). Must match the
// same env var consumed by lib/base-path.ts for raw window.location/window.open.
const basePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "";

// Static security headers for every admin response. The CSP (per-request nonce)
// is set in middleware.ts. Admin is never embedded, so it locks framing down
// hard and needs no camera/mic/geolocation/payment.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // @lms/types, @lms/puck and @lms/ui ship raw .ts(x) from the workspace;
  // transpile them.
  transpilePackages: ["@lms/types", "@lms/puck", "@lms/ui"],
  // Conditional spread: only set basePath when actually deployed under a prefix.
  ...(basePath ? { basePath } : {}),
};

module.exports = nextConfig;
