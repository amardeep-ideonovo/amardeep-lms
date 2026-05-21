/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lms/types ships raw .ts from the workspace; let Next transpile it.
  transpilePackages: ["@lms/types"],
};

module.exports = nextConfig;
