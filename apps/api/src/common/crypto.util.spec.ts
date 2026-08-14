import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto.util";

// First tests for the at-rest crypto helper. It backs Setting rows (Stripe/SMTP
// creds), LiveSession join URLs, and now Projects SECRET field values, so its
// failure modes are load-bearing: every caller relies on decrypt THROWING (not
// returning null) when the key is missing or wrong.

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

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

test("round-trips a secret", () => {
  withKey(KEY, () => {
    assert.equal(decryptSecret(encryptSecret("hunter2")), "hunter2");
  });
});

test("round-trips unicode and embedded colons", () => {
  withKey(KEY, () => {
    for (const s of [
      "user:pass:note",
      "ключ🔐",
      "trailing  ",
      ":",
      "a".repeat(4096),
    ]) {
      assert.equal(decryptSecret(encryptSecret(s)), s);
    }
  });
});

test("uses a fresh IV per call (same plaintext -> different ciphertext)", () => {
  withKey(KEY, () => {
    assert.notEqual(encryptSecret("same"), encryptSecret("same"));
  });
});

test("ciphertext does not contain the plaintext", () => {
  withKey(KEY, () => {
    assert.ok(!encryptSecret("topsecret").includes("topsecret"));
  });
});

test("a wrong key fails the auth tag rather than returning garbage", () => {
  const sealed = withKey(KEY, () => encryptSecret("hunter2"));
  withKey(OTHER_KEY, () => {
    assert.throws(() => decryptSecret(sealed));
  });
});

test("a tampered auth tag throws", () => {
  withKey(KEY, () => {
    const [iv, tag, ct] = encryptSecret("hunter2").split(":");
    const flipped = Buffer.from(tag, "base64");
    flipped[0] ^= 0xff;
    assert.throws(() =>
      decryptSecret([iv, flipped.toString("base64"), ct].join(":")),
    );
  });
});

test("a missing key throws by name", () => {
  withKey(undefined, () => {
    assert.throws(() => encryptSecret("x"), /SETTINGS_ENC_KEY is not set/);
  });
});

test("a wrong-length key throws by name", () => {
  withKey(Buffer.alloc(31, 7).toString("base64"), () => {
    assert.throws(() => encryptSecret("x"), /32 bytes/);
  });
});

test("a malformed payload throws", () => {
  withKey(KEY, () => {
    assert.throws(
      () => decryptSecret("not-ciphertext"),
      /Malformed ciphertext/,
    );
  });
});

test("maskSecret keeps only the last 4 characters", () => {
  assert.equal(maskSecret("abcdefgh"), "••••••••efgh");
  assert.equal(maskSecret(""), null);
  assert.equal(maskSecret(null), null);
});
