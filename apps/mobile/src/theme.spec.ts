import test from "node:test";
import assert from "node:assert/strict";

import {
  isCompletePalette,
  isCompleteAppConfig,
  paletteFrom,
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
  assert.equal(isCompleteAppConfig({ ...DEFAULT_APP_CONFIG, light: {} }), false);
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
