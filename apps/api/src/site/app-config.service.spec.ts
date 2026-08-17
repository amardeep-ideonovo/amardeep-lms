import { test } from "node:test";
import assert from "node:assert/strict";
import { AppConfigService } from "./app-config.service";

// Unit tests for the navy-reversion translation: a stored palette that still
// equals the Spark-era stock VERBATIM was materialized into the row when the
// instance was provisioned during the Spark window and was never customized,
// so read() serves the Ink Hero navy defaults for it — while a palette with
// even one admin-touched key is returned exactly as stored. This is what
// carries the theme reversion to already-provisioned fleet instances without
// clobbering client branding (the mirror of the original Spark rollout).

const INK_HERO_LIGHT = {
  bg: "#f4f3f8",
  surface: "#ffffff",
  surfaceMuted: "#f1eff7",
  border: "#e4e1ee",
  text: "#272144",
  textMuted: "#8b87a3",
  primary: "#3cc4b2",
  danger: "#e04848",
};
const INK_HERO_DARK = {
  bg: "#221c3d",
  surface: "#272144",
  surfaceMuted: "#322b52",
  border: "#3a3460",
  text: "#ffffff",
  textMuted: "#a7a3bd",
  primary: "#3cc4b2",
  danger: "#ea4f4f",
};
const SPARK_LIGHT = {
  bg: "#f5f2ec",
  surface: "#ffffff",
  surfaceMuted: "#f0ede4",
  border: "#e6e2d7",
  text: "#17171d",
  textMuted: "#8b8a87",
  primary: "#34c9a2",
  danger: "#e04848",
};
const SPARK_DARK = {
  bg: "#101014",
  surface: "#17171d",
  surfaceMuted: "#1e1e26",
  border: "#2a2a33",
  text: "#ffffff",
  textMuted: "#a4a3a9",
  primary: "#34c9a2",
  danger: "#ea4f4f",
};

function makeService(storedConfig: unknown) {
  const prisma = {
    appConfig: {
      findUnique: () =>
        Promise.resolve({ id: "singleton", config: storedConfig }),
      upsert: (a: any) =>
        Promise.resolve({ id: "singleton", config: a.update.config }),
    },
  };
  return new AppConfigService(prisma as any);
}

test("an untouched Spark-era stock row reads back as the Ink Hero navy defaults", async () => {
  const svc = makeService({
    title: "Spotlight Academy",
    colorScheme: "light",
    light: { ...SPARK_LIGHT },
    dark: { ...SPARK_DARK },
  });
  const cfg = await svc.read();
  assert.deepEqual(cfg.light, INK_HERO_LIGHT);
  assert.deepEqual(cfg.dark, INK_HERO_DARK);
});

test("a customized palette is served exactly as stored (no translation)", async () => {
  const customLight = { ...SPARK_LIGHT, primary: "#ff6600" }; // one touched key
  const svc = makeService({
    title: "Client Academy",
    colorScheme: "light",
    light: customLight,
    dark: { ...SPARK_DARK },
  });
  const cfg = await svc.read();
  // The touched palette survives verbatim…
  assert.deepEqual(cfg.light, customLight);
  // …while the untouched sibling palette still reverts independently.
  assert.deepEqual(cfg.dark, INK_HERO_DARK);
});

test("an already-navy stock row is served unchanged (no double-translation)", async () => {
  // Instances provisioned BEFORE the Spark window (or since the reversion)
  // store the Ink Hero stock; it is not Spark-stock, so it passes through as
  // the navy palette it already is.
  const svc = makeService({
    title: "Spotlight Academy",
    colorScheme: "light",
    light: { ...INK_HERO_LIGHT },
    dark: { ...INK_HERO_DARK },
  });
  const cfg = await svc.read();
  assert.deepEqual(cfg.light, INK_HERO_LIGHT);
  assert.deepEqual(cfg.dark, INK_HERO_DARK);
});

test("legacy detection is case-insensitive on stored hex values", async () => {
  const upper = Object.fromEntries(
    Object.entries(SPARK_LIGHT).map(([k, v]) => [k, v.toUpperCase()]),
  );
  const svc = makeService({ light: upper, dark: { ...SPARK_DARK } });
  const cfg = await svc.read();
  assert.deepEqual(cfg.light, INK_HERO_LIGHT);
});

test("a missing row serves the Ink Hero navy defaults", async () => {
  const prisma = {
    appConfig: { findUnique: () => Promise.resolve(null) },
  };
  const svc = new AppConfigService(prisma as any);
  const cfg = await svc.read();
  assert.equal(cfg.title, "Spotlight Academy");
  assert.deepEqual(cfg.light, INK_HERO_LIGHT);
  assert.deepEqual(cfg.dark, INK_HERO_DARK);
});
