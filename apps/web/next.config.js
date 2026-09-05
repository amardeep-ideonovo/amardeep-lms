// Static security headers applied to every response. The Content-Security-Policy
// (with its per-request nonce) and per-path frame protection are set in
// middleware.ts instead — they need runtime/path awareness these static headers
// can't express.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera/microphone kept self-enabled for Zoom live sessions; the rest denied.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), browsing-topics=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // @lms/types, @lms/puck and @lms/ui ship raw .ts(x) from the workspace;
  // transpile them.
  transpilePackages: ["@lms/types", "@lms/puck", "@lms/ui"],
  webpack: (config) => {
    // The Zoom Meeting SDK's embedded bundle references an optional, unpublished
    // "@zoom/download-manager" module. Resolve it to an empty module so the build
    // doesn't fail — the Component View loads its runtime assets from Zoom's CDN.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@zoom/download-manager": false,
    };
    return config;
  },
};

module.exports = nextConfig;
