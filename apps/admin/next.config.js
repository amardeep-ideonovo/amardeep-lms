// In production the admin is served under a path prefix (e.g. "/admin") behind a
// reverse proxy. basePath makes Next prefix BOTH routes and /_next asset URLs, so
// the HTML references chunks at /admin/_next/... instead of /_next/... (which 404
// when the app isn't mounted at the domain root). Leave NEXT_PUBLIC_ADMIN_BASE_PATH
// unset for local dev (admin runs at the root of its dev port). Must match the
// same env var consumed by lib/base-path.ts for raw window.location/window.open.
const basePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lms/types and @lms/puck ship raw .ts(x) from the workspace; transpile them.
  transpilePackages: ["@lms/types", "@lms/puck"],
  // Conditional spread: only set basePath when actually deployed under a prefix.
  ...(basePath ? { basePath } : {}),
};

module.exports = nextConfig;
