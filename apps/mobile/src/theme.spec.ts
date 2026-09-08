import test from "node:test";
import assert from "node:assert/strict";

import {
  isCompletePalette,
  isCompleteAppConfig,
  paletteFrom,
  pickBrandTitle,
  DEFAULT_APP_CONFIG,
} from "./theme";

// Regression guard for the Android launch hard-crash: a malformed cached
// app-config (e.g. `light: {}`) reached the theme and `hexToHsl(undefined)`
// threw an unrecoverable render error. The theme must now tolerate it.

test("isCompletePalette accepts a full palette", () => {
  assert.equal(isCompletePalette(DEFAULT_APP_CONFIG.light), true);
  assert.equal(isCompletePalette(DEFAULT_APP_CONFIG.dark), true);
});

test("isCompletePalette rejects empty / partial / non-object", () => {
  assert.equal(isCompletePalette({}), false); // the exact crashing shape
  assert.equal(isCompletePalette({ primary: "#fff" }), false); // missing keys
  assert.equal(
    isCompletePalette({ ...DEFAULT_APP_CONFIG.light, primary: "" }),
    false, // empty-string color
  );
  assert.equal(
    isCompletePalette({ ...DEFAULT_APP_CONFIG.light, text: null }),
    false, // null color
  );
  assert.equal(isCompletePalette(null), false);
  assert.equal(isCompletePalette("#fff"), false);
});

test("isCompleteAppConfig requires BOTH palettes complete", () => {
  assert.equal(isCompleteAppConfig(DEFAULT_APP_CONFIG), true);
  assert.equal(
    isCompleteAppConfig({ ...DEFAULT_APP_CONFIG, light: {} }),
    false,
  );
  assert.equal(
    isCompleteAppConfig({ ...DEFAULT_APP_CONFIG, dark: { primary: "#fff" } }),
    false,
  );
  assert.equal(isCompleteAppConfig(null), false);
});

test("paletteFrom does NOT throw on an empty palette and falls back to stock", () => {
  // `{}` is the runtime value that hard-crashed the app before this fix.
  const light = paletteFrom({} as never, "light");
  assert.equal(light.primary, DEFAULT_APP_CONFIG.light.primary);
  assert.equal(light.text, DEFAULT_APP_CONFIG.light.text);

  const dark = paletteFrom({} as never, "dark");
  assert.equal(dark.primary, DEFAULT_APP_CONFIG.dark.primary);
  assert.equal(dark.text, DEFAULT_APP_CONFIG.dark.text);
});

test("paletteFrom honors valid overrides but fills missing keys from stock", () => {
  const colors = paletteFrom({ primary: "#ff0000" } as never, "light");
  assert.equal(colors.primary, "#ff0000"); // valid override kept
  assert.equal(colors.bg, DEFAULT_APP_CONFIG.light.bg); // missing key filled
});

test("paletteFrom ignores non-string color values (never yields undefined)", () => {
  const colors = paletteFrom(
    { ...DEFAULT_APP_CONFIG.light, primary: undefined, text: 123 } as never,
    "light",
  );
  assert.equal(colors.primary, DEFAULT_APP_CONFIG.light.primary);
  assert.equal(colors.text, DEFAULT_APP_CONFIG.light.text);
});

test("paletteFrom: a valid chrome override wins in both modes", () => {
  assert.equal(
    paletteFrom(
      { ...DEFAULT_APP_CONFIG.light, chrome: "#123456" } as never,
      "light",
    ).chrome,
    "#123456",
  );
  assert.equal(
    paletteFrom(
      { ...DEFAULT_APP_CONFIG.dark, chrome: "#abcdef" } as never,
      "dark",
    ).chrome,
    "#abcdef",
  );
});

test("paletteFrom: null/absent/invalid chrome falls back to Auto (derived)", () => {
  // Light: stock text (#272144) derives EXACTLY the ink-900 band #221c3d.
  assert.equal(
    paletteFrom({ ...DEFAULT_APP_CONFIG.light, chrome: null } as never, "light")
      .chrome,
    "#221c3d",
  );
  // Dark: Auto = the background color.
  assert.equal(
    paletteFrom(DEFAULT_APP_CONFIG.dark, "dark").chrome,
    DEFAULT_APP_CONFIG.dark.bg,
  );
  // A non-hex override is ignored → derived.
  assert.equal(
    paletteFrom(
      { ...DEFAULT_APP_CONFIG.dark, chrome: "not-a-color" } as never,
      "dark",
    ).chrome,
    DEFAULT_APP_CONFIG.dark.bg,
  );
});

// Regression guard for the "header text disappears on a light Header band"
// bug: the on-chrome foreground must be DERIVED from the (admin-overridable)
// chrome color, flipping to dark ink on a light band and white on a dark band,
// so text/links on the header band stay legible for ANY chrome choice.
function relLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test("onChrome flips to dark ink on a light Header band and stays AA-legible", () => {
  const light = paletteFrom(
    { ...DEFAULT_APP_CONFIG.light, chrome: "#f4f4f6" } as never,
    "light",
  );
  assert.equal(light.chrome, "#f4f4f6");
  assert.equal(light.onChrome, "#101828"); // dark ink, not white
  assert.ok(
    contrast(light.onChrome, light.chrome) >= 4.5,
    "onChrome must meet WCAG AA against a light chrome band",
  );
  // The on-band brand accent must also darken so it doesn't wash out.
  assert.ok(
    contrast(light.onChromeAccent, light.chrome) >= 4.5,
    "onChromeAccent must meet WCAG AA against a light chrome band",
  );
});

// The member login/header brand: a real custom title wins; otherwise the bound
// academy's own name (from the connect code); otherwise the caller's fallback
// (the operator product on the shared app, a neutral generic on white-label).
const SHARED_FB = DEFAULT_APP_CONFIG.title; // shared app: "our branding"
const WL_FB = "Academy"; // white-label / locked build: neutral, no operator leak

test("pickBrandTitle prefers a real custom title", () => {
  assert.equal(
    pickBrandTitle("Acme Music School", "Acme (CP)", SHARED_FB),
    "Acme Music School",
  );
  assert.equal(pickBrandTitle("  Acme  ", null, WL_FB), "Acme"); // trimmed
});

test("pickBrandTitle falls back to the bound academy name when title is the default sentinel", () => {
  assert.equal(
    pickBrandTitle(DEFAULT_APP_CONFIG.title, "Acme Music School", SHARED_FB),
    "Acme Music School",
  );
  // Blank/absent title also falls through to the bound name (not the fallback).
  assert.equal(pickBrandTitle("", "Acme", SHARED_FB), "Acme");
  assert.equal(pickBrandTitle(null, "Acme", WL_FB), "Acme");
});

test("pickBrandTitle deep fallback: operator brand on shared, neutral on white-label", () => {
  // Shared app (no custom title, no bound name) → our product brand.
  assert.equal(
    pickBrandTitle(DEFAULT_APP_CONFIG.title, null, SHARED_FB),
    SHARED_FB,
  );
  assert.equal(pickBrandTitle(null, null, SHARED_FB), SHARED_FB);
  // White-label / locked build → neutral, NEVER the operator brand.
  assert.equal(
    pickBrandTitle(DEFAULT_APP_CONFIG.title, null, WL_FB),
    "Academy",
  );
  assert.notEqual(
    pickBrandTitle(DEFAULT_APP_CONFIG.title, null, WL_FB),
    DEFAULT_APP_CONFIG.title,
  );
});

test("onChrome stays light on a dark Header band (default/derived)", () => {
  const light = paletteFrom(DEFAULT_APP_CONFIG.light, "light"); // chrome derives to #221c3d
  assert.equal(light.onChrome, "#ffffff");
  assert.ok(contrast(light.onChrome, light.chrome) >= 4.5);
  const dark = paletteFrom(DEFAULT_APP_CONFIG.dark, "dark");
  assert.equal(dark.onChrome, "#ffffff");
  assert.ok(contrast(dark.onChrome, dark.chrome) >= 4.5);
});
