/** @type {import('next').NextConfig} */

// STATIC_EXPORT=1 builds a fully static site (out/) for docroot hosting —
// the app is client-rendered over the in-memory mock store, so no Node
// server is required. The default (server) build remains for `next start`.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lms/types"],
  ...(staticExport ? { output: "export", trailingSlash: true } : {}),
};

module.exports = nextConfig;
