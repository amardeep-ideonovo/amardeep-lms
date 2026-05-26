/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lms/types and @lms/puck ship raw .ts(x) from the workspace; transpile them.
  transpilePackages: ["@lms/types", "@lms/puck"],
};

module.exports = nextConfig;
