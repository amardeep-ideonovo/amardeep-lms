// Metro config for running inside the npm-workspace monorepo (standard Expo
// monorepo setup): watch the workspace root, and resolve modules from the app's
// own node_modules FIRST, then the hoisted root. Listing the app first means a
// single React (the app's 18.2.0) is picked even though the root also has
// 18.3.1 (from the Next.js apps) — which fixes the web "Objects are not valid as
// a React child" dual-React error WITHOUT disabling hierarchical lookup (that
// broke resolution of nested Expo native modules on Android).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Force a single React/React-DOM (the app's 18.2.0) so the monorepo's other
// copy (18.3.1, pulled by the Next.js apps) can't sneak into the bundle and
// cause a duplicate-React renderer crash ("UIManager"/"Objects are not valid
// as a React child"). Hierarchical lookup stays ON so nested Expo native
// modules still resolve correctly.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
};

module.exports = config;
