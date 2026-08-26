import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A demo content pack must never carry credentials. Today that holds only
// because the Setting table is omitted from the model list and the type — a
// comment and an absence, which a future "just add Settings to the pack" change
// would quietly undo. Packs are written unencrypted to /backups/demo-packs and
// replayed into every sample-content instance, so the blast radius of that
// mistake is the whole fleet plus a file on disk. These are source-level
// assertions on purpose: they fail CI at the moment the omission stops being
// true, which no runtime test on a pack built from a fixture would catch.
//
// If you are here because this test failed: the fix is not to relax it. Payment
// credentials reach an instance over the control plane's service-token push
// (POST /instance-admin/demo-payment-keys), which is revocable and per-instance.

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

test("the pack export never reads the Setting table", () => {
  const src = read("content-pack.service.ts");
  assert.ok(
    !/prisma\s*\.\s*setting\b/.test(src),
    "content-pack.service.ts must not touch prisma.setting — Settings hold " +
      "encrypted credentials and must stay out of the pack",
  );
});

test("the pack import never writes the Setting table", () => {
  const src = read("content-pack.service.ts");
  assert.ok(
    !/setting\s*\.\s*(upsert|create|createMany|update)\b/.test(src),
    "an imported pack must never be able to install credentials",
  );
});

test("the pack format declares no settings/credential row set", () => {
  const src = read("content-pack.types.ts");
  // Match a field declaration inside PackContent, not the prose in the header
  // comment (which mentions "encrypted Settings" as an exclusion).
  assert.ok(
    !/^\s*(settings|secrets|credentials)\s*[?]?\s*:/m.test(src),
    "PackContent must not declare a settings/secrets/credentials row set",
  );
});

test("no Stripe/PayPal credential is hardcoded in the content-pack module", () => {
  for (const f of [
    "content-pack.service.ts",
    "content-pack.transform.ts",
    "content-pack.types.ts",
    "content-pack.controller.ts",
  ]) {
    const src = read(f);
    assert.ok(
      !/\b(sk_live_|sk_test_|whsec_|rk_live_|rk_test_)[A-Za-z0-9]/.test(src),
      `${f} must not contain a credential literal`,
    );
  }
});
