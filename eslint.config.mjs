// Root ESLint flat config for the whole monorepo (ESLint 9 + typescript-eslint 8).
//
// Philosophy: WARNING-FIRST baseline. Rules are hand-picked for signal, not
// taken wholesale from presets, so the first CI run lands green and the diff
// stays reviewable. Only rules that are clean today (or catch outright bugs)
// are errors; everything else warns until a later ratchet.
//
// Type-aware rules (no-floating-promises &c.) run only where the root-hoisted
// TypeScript 5.5 can serve the project: api, the three Next apps, and puck.
// apps/mobile deliberately stays syntax-only — it compiles with its OWN nested
// TS 6 + React 19 types (see .github/workflows/build.yml), and type-aware
// linting through the root compiler would produce garbage there.
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Next's plugin reads settings.next.rootDir to locate each app.
const NEXT_APPS = ["apps/web", "apps/admin", "apps/control-plane"];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/.expo/**",
      "**/coverage/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/certs/**",
      "**/next-env.d.ts",
      "graphify-out/**",
      ".claude/**",
    ],
  },

  // ---------- all TypeScript: syntax-only correctness baseline ----------
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // TS itself doesn't flag unused locals anywhere in this repo (no
      // noUnusedLocals in any tsconfig), so this is the one place that does.
      // Error, not warn: the repo was brought to zero in the baseline PR.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-var": "error",
      "no-debugger": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-self-assign": "error",
      "no-unsafe-negation": "error",
      "prefer-const": "warn",
      eqeqeq: ["warn", "smart"],
    },
  },

  // ---------- plain JS (build scripts, configs): node environment ----------
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
    },
  },

  // ---------- React hooks: every plane that renders React ----------
  {
    files: [
      "apps/web/**/*.tsx",
      "apps/admin/**/*.tsx",
      "apps/control-plane/**/*.tsx",
      "apps/mobile/**/*.{ts,tsx}",
      "packages/puck/**/*.tsx",
    ],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // A conditional hook is a crash, not a style choice.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ---------- shared-strings ratchet (docs/coding-standards.md D1) ----------
  // Warn on raw copies of the top catalog literals — render STR.* from
  // @lms/types instead. Warning-first like the rest of this config: these
  // never fail CI; they mark leftovers until an app is fully migrated and its
  // entry can ratchet to error. API is exempt until D6 (error codes) lands.
  {
    files: [
      "apps/web/**/*.tsx",
      "apps/admin/**/*.tsx",
      "apps/control-plane/**/*.tsx",
      "apps/mobile/**/*.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // :last-child keeps sentence FRAGMENTS out: in `<h2>Cancel {x}?</h2>`
          // the "Cancel " text node is followed by siblings, so it's not a
          // standalone label — only a lone/trailing text node is.
          selector:
            "JSXText[value=/^\\s*(Close|Cancel|Save|Saving…|Delete|Edit|Remove|Loading…|Try again)\\s*$/]:last-child",
          message:
            "Use STR.common.* from @lms/types instead of retyping this label (docs/coding-standards.md D1).",
        },
        {
          selector: 'JSXAttribute[name.name="aria-label"][value.value="Close"]',
          message: "Use STR.common.close from @lms/types.",
        },
        {
          selector: "JSXText[value=/You don’t have permission to view this/]",
          message: "Use STR.errors.permissionDenied from @lms/types.",
        },
        {
          selector:
            "Literal[value=/^You don’t have permission to view this\\.$/]",
          message: "Use STR.errors.permissionDenied from @lms/types.",
        },
        {
          // Trailing period required: a period-less "Something went wrong" is
          // a heading slot, not the catalog error sentence.
          selector: "Literal[value=/^Something went wrong\\./]",
          message: "Use STR.errors.generic from @lms/types.",
        },
      ],
    },
  },

  // ---------- Next.js apps: framework footguns ----------
  ...NEXT_APPS.map((app) => ({
    files: [`${app}/**/*.{ts,tsx}`],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: app } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      // Uses the removed-in-ESLint-9 context.getAncestors API (plugin v14
      // predates flat config), and only inspects pages-router _document.js —
      // this repo is app-router-only, so nothing is lost.
      "@next/next/no-duplicate-head": "off",
    },
  })),

  // ---------- type-aware promise safety (root-TS-served workspaces only) ----------
  {
    files: [
      "apps/api/**/*.ts",
      "apps/web/**/*.{ts,tsx}",
      "apps/admin/**/*.{ts,tsx}",
      "apps/control-plane/**/*.{ts,tsx}",
      "packages/puck/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Error, not warn: the 271-site backlog was burned down to zero in the
      // baseline PR (await / void / .catch chosen per site, not blanket).
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          // node:test's test() returns a promise the RUNNER coordinates —
          // top-level test(...) calls are safe unawaited by design (this is
          // the canonical allowForKnownSafeCalls use case). Without this,
          // every API spec file lights up.
          allowForKnownSafeCalls: [
            {
              from: "package",
              name: ["test", "it", "describe"],
              package: "node:test",
            },
          ],
        },
      ],
      "@typescript-eslint/await-thenable": "error",
      // checksVoidReturn.attributes would flag every `onClick={async ...}`,
      // which this codebase uses idiomatically. Error, not warn: the 22-site
      // backlog (timers/listeners/menu items handed async fns) was fixed with
      // the `() => void fn()` idiom in the baseline PR.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
);
