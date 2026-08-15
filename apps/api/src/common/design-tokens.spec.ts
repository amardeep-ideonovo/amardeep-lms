import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cross-file contract test in the deploy-pins.spec.ts mold: it lives in the
// api suite because that's the CI-run node:test host that reads repo files,
// not because tokens are an api concern.
//
// The P3 token unification (docs/coding-standards.md D3) made
// packages/ui/tokens.css the single color source, with each Next app's
// globals.css layering app-specific values and legacy aliases on top. Two
// real bugs during that work motivate these assertions:
//   1. mutual aliases (--surface ↔ --lav-surface) formed a var() CYCLE, which
//      CSS resolves to "invalid at computed-value time" — silently unstyled;
//   2. a leftover [data-theme] block re-asserted PRE-AA values and overrode
//      the :root corrections at runtime for as long as the theme script set
//      the attribute.
// This spec re-runs the resolution on every CI build so neither can return.

const ROOT = join(__dirname, "..", "..", "..", "..");
const FILES = [
  "packages/ui/tokens.css",
  "apps/web/app/globals.css",
  "apps/admin/app/globals.css",
];

// next/font injects --font-jakarta on <html> at runtime; it can never resolve
// from the stylesheets alone.
const RUNTIME_INJECTED = new Set(["--font-jakarta"]);

function collectDecls(css: string): Map<string, string> {
  const decls = new Map<string, string>();
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/g;
  for (const m of css.matchAll(rootBlock)) {
    for (const d of m[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      decls.set(`--${d[1]}`, d[2].trim());
    }
  }
  return decls;
}

function loadApp(appCss: string): Map<string, string> {
  const decls = new Map<string, string>();
  for (const f of ["packages/ui/tokens.css", appCss]) {
    for (const [k, v] of collectDecls(readFileSync(join(ROOT, f), "utf8"))) {
      decls.set(k, v); // later file wins, like the CSS cascade
    }
  }
  return decls;
}

function resolve(
  decls: Map<string, string>,
  value: string,
  seen: Set<string>,
): { ok: boolean; why?: string } {
  const refs = [...value.matchAll(/var\((--[a-z0-9-]+)(?:\s*,\s*[^)]+)?\)/gi)];
  for (const [, name] of refs) {
    if (seen.has(name)) return { ok: false, why: `cycle through ${name}` };
    const v = decls.get(name);
    if (v === undefined) {
      if (RUNTIME_INJECTED.has(name)) continue;
      return { ok: false, why: `undefined ${name}` };
    }
    const next = new Set(seen);
    next.add(name);
    const r = resolve(decls, v, next);
    if (!r.ok) return r;
  }
  return { ok: true };
}

for (const app of ["apps/web/app/globals.css", "apps/admin/app/globals.css"]) {
  test(`every token in ${app} (+ tokens.css) resolves — no cycles, no dangling var() refs`, () => {
    const decls = loadApp(app);
    const problems: string[] = [];
    for (const [name, value] of decls) {
      const r = resolve(decls, value, new Set([name]));
      if (!r.ok) problems.push(`${name}: ${r.why}`);
    }
    assert.deepEqual(problems, []);
  });
}

test("no [data-theme] token blocks exist — the single-appearance apps have exactly one token source", () => {
  for (const f of FILES) {
    const css = readFileSync(join(ROOT, f), "utf8").replace(
      /\/\*[\s\S]*?\*\//g, // comments may MENTION the old plumbing
      "",
    );
    assert.ok(
      !/:root\[data-theme/.test(css),
      `${f} declares a :root[data-theme] block; the P3 removal found one of these silently overriding the :root AA values`,
    );
  }
});

test("tokens.css stays in step with the TS accent palette (packages/types/class-accents.ts)", () => {
  const css = readFileSync(join(ROOT, "packages/ui/tokens.css"), "utf8");
  const decls = collectDecls(css);
  // Loaded lazily via require so ts-node resolves the raw-TS package the same
  // way the api's other specs do (relative path — see constants.ts header).
  const { CLASS_ACCENTS } =
    require("../../../../packages/types/class-accents") as {
      CLASS_ACCENTS: Array<{
        color: string;
        base: string;
        dark: string;
        text: string;
      }>;
    };
  // P3b completed the slot table: all six slots carry -base/-dark gradient
  // triplets (web's formerly self-derived blue/sea values were reconciled to
  // the TS canon). CSS writes "r, g, b", TS "r,g,b" — compare space-free.
  const rgb = (v: string | undefined) => v?.replace(/\s+/g, "");
  const slots = ["amber", "violet", "green", "red", "blue", "sea"];
  slots.forEach((slot, i) => {
    assert.equal(
      decls.get(`--accent-${slot}`),
      CLASS_ACCENTS[i].color,
      `--accent-${slot} drifted from CLASS_ACCENTS[${i}].color`,
    );
    assert.equal(
      rgb(decls.get(`--accent-${slot}-base`)),
      CLASS_ACCENTS[i].base,
      `--accent-${slot}-base drifted from CLASS_ACCENTS[${i}].base`,
    );
    assert.equal(
      rgb(decls.get(`--accent-${slot}-dark`)),
      CLASS_ACCENTS[i].dark,
      `--accent-${slot}-dark drifted from CLASS_ACCENTS[${i}].dark`,
    );
    assert.equal(
      decls.get(`--accent-${slot}-text`),
      CLASS_ACCENTS[i].text,
      `--accent-${slot}-text drifted from CLASS_ACCENTS[${i}].text`,
    );
  });
});
