// Metro config for running inside the npm-workspace monorepo.
// Without this, Metro can resolve multiple React copies (root 18.3.1 vs the
// app's 18.2.0), which breaks React element identity ("Objects are not valid
// as a React child"). We watch the workspace root but force module resolution
// to the app's own node_modules first so there is a single React/React-DOM.
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
config.resolver.disableHierarchicalLookup = true;

// Pin the singletons to the app's copies regardless of hoisting.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
};

module.exports = config;
