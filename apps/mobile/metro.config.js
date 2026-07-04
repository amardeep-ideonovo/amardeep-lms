// Metro config for running inside the npm-workspace monorepo (standard Expo
// monorepo setup): watch the workspace root, and resolve modules from the app's
// own node_modules FIRST, then the hoisted root. Listing the app first means a
// single React (the app's 19.x) is picked even though the root also hoists the
// Next.js apps' React 18 — which fixes the web "Objects are not valid as a
// React child" dual-React error WITHOUT disabling hierarchical lookup (that
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

// Force a single React/React-DOM — whichever copy the APP resolves to (its
// nested 19.x, falling back to root only if npm hoisted it there) — so the
// monorepo's other copy (18.x for the Next.js apps) can't sneak into the
// bundle and cause a duplicate-React renderer crash. require.resolve survives
// npm's hoister flipping which copy nests where; a hardcoded path does not.
config.resolver.extraNodeModules = {
  react: path.dirname(
    require.resolve("react/package.json", { paths: [projectRoot] }),
  ),
  "react-dom": path.dirname(
    require.resolve("react-dom/package.json", { paths: [projectRoot] }),
  ),
};

module.exports = config;
