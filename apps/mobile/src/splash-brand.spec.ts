import { test } from "node:test";
import assert from "node:assert/strict";

import { splashBrand } from "./splash-brand";

const DEFAULT = "Spotlight Academy";

test("product default gets the styled two-line lockup", () => {
  assert.deepEqual(splashBrand("Spotlight Academy", DEFAULT), {
    kind: "lockup",
    initial: "S",
    word: "spotlight",
    sub: "ACADEMY",
  });
});

test("a client title renders verbatim, never restyled", () => {
  assert.deepEqual(splashBrand("Harbor Yoga", DEFAULT), {
    kind: "title",
    initial: "H",
    title: "Harbor Yoga",
  });
});

test("no trustworthy title -> bare mark (never the product wordmark)", () => {
  assert.deepEqual(splashBrand(null, DEFAULT), { kind: "mark" });
  assert.deepEqual(splashBrand(undefined, DEFAULT), { kind: "mark" });
  assert.deepEqual(splashBrand("   ", DEFAULT), { kind: "mark" });
  assert.deepEqual(splashBrand("", DEFAULT), { kind: "mark" });
});

test("titles are trimmed before use", () => {
  assert.deepEqual(splashBrand("  Harbor Yoga  ", DEFAULT), {
    kind: "title",
    initial: "H",
    title: "Harbor Yoga",
  });
});

test("a one-word default title yields a lockup with an empty sub line", () => {
  assert.deepEqual(splashBrand("Spark", "Spark"), {
    kind: "lockup",
    initial: "S",
    word: "spark",
    sub: "",
  });
});

test("emoji-leading titles keep a sane monogram (surrogate-safe)", () => {
  const b = splashBrand("🎸 Guitar Lab", DEFAULT);
  assert.equal(b.kind, "title");
  assert.equal(b.kind === "title" ? b.initial : "", "🎸");
});

test("a client titled exactly like the default gets the lockup (indistinguishable, harmless)", () => {
  assert.equal(splashBrand(DEFAULT, DEFAULT).kind, "lockup");
});
