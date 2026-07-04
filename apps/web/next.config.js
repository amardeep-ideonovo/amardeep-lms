/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lms/types and @lms/puck ship raw .ts(x) from the workspace; transpile them.
  transpilePackages: ["@lms/types", "@lms/puck"],
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
