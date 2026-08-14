import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppConfigService } from './app-config.service';

// Unit tests for the Spark-rebrand legacy translation: a stored palette that
// still equals the Ink Hero-era stock VERBATIM was never customized (the seed
// materialized the then-current defaults into the row), so read() serves the
// Spark defaults for it — while a palette with even one admin-touched key is
// returned exactly as stored. This is what carries a product-default rebrand
// to already-provisioned fleet instances without clobbering client branding.

const INK_HERO_LIGHT = {
  bg: '#f4f3f8',
  surface: '#ffffff',
  surfaceMuted: '#f1eff7',
  border: '#e4e1ee',
  text: '#272144',
  textMuted: '#8b87a3',
  primary: '#3cc4b2',
  danger: '#e04848',
};
const INK_HERO_DARK = {
  bg: '#221c3d',
  surface: '#272144',
  surfaceMuted: '#322b52',
  border: '#3a3460',
  text: '#ffffff',
  textMuted: '#a7a3bd',
  primary: '#3cc4b2',
  danger: '#ea4f4f',
};
const SPARK_LIGHT = {
  bg: '#f5f2ec',
  surface: '#ffffff',
  surfaceMuted: '#f0ede4',
  border: '#e6e2d7',
  text: '#17171d',
  textMuted: '#8b8a87',
  primary: '#34c9a2',
  danger: '#e04848',
};
const SPARK_DARK = {
  bg: '#101014',
  surface: '#17171d',
  surfaceMuted: '#1e1e26',
  border: '#2a2a33',
  text: '#ffffff',
  textMuted: '#a4a3a9',
  primary: '#34c9a2',
  danger: '#ea4f4f',
};

function makeService(storedConfig: unknown) {
  const prisma = {
    appConfig: {
      findUnique: () => Promise.resolve({ id: 'singleton', config: storedConfig }),
      upsert: (a: any) => Promise.resolve({ id: 'singleton', config: a.update.config }),
    },
  };
  return new AppConfigService(prisma as any);
}

test('an untouched Ink Hero-era stock row reads back as the Spark defaults', async () => {
  const svc = makeService({
    title: 'Spotlight Academy',
    colorScheme: 'light',
    light: { ...INK_HERO_LIGHT },
    dark: { ...INK_HERO_DARK },
  });
  const cfg = await svc.read();
  assert.deepEqual(cfg.light, SPARK_LIGHT);
  assert.deepEqual(cfg.dark, SPARK_DARK);
});

test('a customized palette is served exactly as stored (no translation)', async () => {
  const customLight = { ...INK_HERO_LIGHT, primary: '#ff6600' }; // one touched key
  const svc = makeService({
    title: 'Client Academy',
    colorScheme: 'light',
    light: customLight,
    dark: { ...INK_HERO_DARK },
  });
  const cfg = await svc.read();
  // The touched palette survives verbatim…
  assert.deepEqual(cfg.light, customLight);
  // …while the untouched sibling palette still upgrades independently.
  assert.deepEqual(cfg.dark, SPARK_DARK);
});

test('legacy detection is case-insensitive on stored hex values', async () => {
  const upper = Object.fromEntries(
    Object.entries(INK_HERO_LIGHT).map(([k, v]) => [k, v.toUpperCase()]),
  );
  const svc = makeService({ light: upper, dark: { ...INK_HERO_DARK } });
  const cfg = await svc.read();
  assert.deepEqual(cfg.light, SPARK_LIGHT);
});

test('a missing row serves the Spark defaults', async () => {
  const prisma = {
    appConfig: { findUnique: () => Promise.resolve(null) },
  };
  const svc = new AppConfigService(prisma as any);
  const cfg = await svc.read();
  assert.equal(cfg.title, 'Spotlight Academy');
  assert.deepEqual(cfg.light, SPARK_LIGHT);
  assert.deepEqual(cfg.dark, SPARK_DARK);
});
