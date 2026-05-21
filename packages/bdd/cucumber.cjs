// Cucumber.js config. Step defs are TypeScript, loaded via ts-node.
module.exports = {
  default: {
    requireModule: ["ts-node/register"],
    require: ["features/support/**/*.ts", "features/step_definitions/**/*.ts"],
    paths: ["features/**/*.feature"],
    format: ["progress", "summary"],
  },
};
