/** @type {import('next').NextConfig} */

// STATIC_EXPORT=1 builds a fully static site (out/) for docroot hosting —
// the app is client-rendered over the in-memory mock store, so no Node
// server is required. The default (server) build remains for `next start`.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  // Image Optimization API disabled. Nothing in this repo renders next/image,
  // so this is behaviour-neutral — and it closes the /_next/image endpoint that
  // GHSA-2xp9-vwfh-vxw4 (RCE via libheif when AVIF is optimized) reaches; Next
  // 14.2.x has no patched release (first fix 15.5.24). Revisit on the Next major.
  images: { unoptimized: true },
  transpilePackages: ["@lms/types"],
  ...(staticExport ? { output: "export", trailingSlash: true } : {}),
};

module.exports = nextConfig;
