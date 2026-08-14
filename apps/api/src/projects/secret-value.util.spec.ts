import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENC_PREFIX,
  isSealed,
  openSecretValue,
  sealSecretValue,
} from "./secret-value.util";

// The envelope around crypto.util that makes Projects SECRET values
// self-identifying — which is what lets a backfill re-run without ever
// double-encrypting, and lets reads tolerate a partially-migrated store.

const KEY = Buffer.alloc(32, 3).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 4).toString("base64");

function withKey<T>(key: string | undefined, fn: () => T): T {
  const prev = process.env.SETTINGS_ENC_KEY;
  if (key === undefined) delete process.env.SETTINGS_ENC_KEY;
  else process.env.SETTINGS_ENC_KEY = key;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.SETTINGS_ENC_KEY;
    else process.env.SETTINGS_ENC_KEY = prev;
  }
}

test("seal tags the value with the envelope prefix and hides the plaintext", () => {
  withKey(KEY, () => {
    const sealed = sealSecretValue("sk_live_abc");
    assert.ok(sealed.startsWith(ENC_PREFIX));
    assert.ok(!sealed.includes("sk_live_abc"));
  });
});

test("open(seal(x)) === x, including the awkward shapes", () => {
  withKey(KEY, () => {
    for (const s of [
      "hunter2",
      "user:pass:note", // 2+ colons: indistinguishable from raw ciphertext without the prefix
      "https://example.com:8443/x",
      "trailing space ",
      "ключ🔐",
      "a".repeat(4096),
    ]) {
      assert.equal(openSecretValue(sealSecretValue(s)), s);
    }
  });
});

test("isSealed is exact — never guesses from shape", () => {
  assert.equal(isSealed(""), false);
  assert.equal(isSealed("hunter2"), false);
  assert.equal(isSealed("user:pass:note"), false); // would pass a 3-part shape check
  assert.equal(isSealed("https://x"), false);
  assert.equal(isSealed(null), false);
  assert.equal(isSealed(42), false);
  assert.equal(isSealed(undefined), false);
  withKey(KEY, () => assert.equal(isSealed(sealSecretValue("x")), true));
});

test("legacy plaintext reads back unchanged (never treated as corrupt)", () => {
  withKey(KEY, () => {
    // A value stored before at-rest encryption shipped — and what a TEXT ->
    // SECRET field flip produces, forever after.
    assert.equal(openSecretValue("legacy-plaintext"), "legacy-plaintext");
    assert.equal(openSecretValue("user:pass:note"), "user:pass:note");
  });
});

test("absent / empty / non-string values read as null", () => {
  withKey(KEY, () => {
    assert.equal(openSecretValue(undefined), null);
    assert.equal(openSecretValue(null), null);
    assert.equal(openSecretValue(""), null);
    assert.equal(openSecretValue(42), null);
  });
});

test("a sealed value under the wrong key THROWS — never null, never raw", () => {
  const sealed = withKey(KEY, () => sealSecretValue("sk_live_abc"));
  withKey(OTHER_KEY, () => {
    // Returning null here would render a recoverable credential as "not set",
    // inviting an overwrite that destroys the only copy.
    assert.throws(() => openSecretValue(sealed));
  });
});

test("sealing without a key throws instead of storing something unreadable", () => {
  withKey(undefined, () => {
    assert.throws(() => sealSecretValue("x"), /SETTINGS_ENC_KEY/);
  });
});

test("re-sealing an already-sealed value is detectable (backfill idempotency)", () => {
  withKey(KEY, () => {
    const once = sealSecretValue("x");
    // The backfill skips on isSealed; this asserts the property it relies on.
    assert.equal(isSealed(once), true);
    const twice = sealSecretValue(once);
    assert.equal(openSecretValue(twice), once); // double-sealing is recoverable, but never happens
  });
});
