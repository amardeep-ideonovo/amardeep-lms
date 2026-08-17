import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import {
  PREVIEW_HANDOFF_TTL_SECONDS,
  makePreviewHandoffToken,
  verifyPreviewHandoffToken,
} from "./site-preview-token.util";

// Unit tests for the site-preview handoff token: the crypto round-trip, every
// rejection path (tamper/expiry/garbage/cross-protocol), and the fail-closed
// invariant. Same shape as reset-token.util.spec.ts, but the payload carries no
// user id (just a nonce + expiry) and the MAC domain is distinct.

const TTL_MS = PREVIEW_HANDOFF_TTL_SECONDS * 1000;

before(() => {
  process.env.JWT_SECRET = "site-preview-spec-secret";
});

test("round-trips: a fresh handoff verifies", () => {
  const token = makePreviewHandoffToken();
  assert.deepEqual(verifyPreviewHandoffToken(token), { ok: true });
});

test("two mints differ (nonce is random)", () => {
  assert.notEqual(makePreviewHandoffToken(), makePreviewHandoffToken());
});

test("rejects a tampered payload", () => {
  const token = makePreviewHandoffToken();
  const [payload, mac] = token.split(".");
  const flipped =
    (payload[0] === "A" ? "B" : "A") + payload.slice(1) + "." + mac;
  assert.equal(verifyPreviewHandoffToken(flipped), null);
});

test("rejects garbage inputs without throwing", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "no-dot",
    ".leading-dot",
    "trailing-dot.",
    "a.b",
    "!!!.###",
    "x".repeat(600), // over the length cap
  ]) {
    assert.equal(
      verifyPreviewHandoffToken(bad as string),
      null,
      `input: ${bad}`,
    );
  }
});

test("expires after the TTL", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000_000_000 });
  const token = makePreviewHandoffToken();
  t.mock.timers.setTime(1_000_000_000_000 + TTL_MS - 1);
  assert.ok(verifyPreviewHandoffToken(token), "still valid just before expiry");
  t.mock.timers.setTime(1_000_000_000_000 + TTL_MS + 1);
  assert.equal(verifyPreviewHandoffToken(token), null, "dead after expiry");
});

test("rejects a same-secret MAC without this flow's domain prefix (cross-protocol)", () => {
  // A token whose MAC is HMAC over the RAW payload (no domain separation) —
  // what a sibling util keyed by the same secret would produce.
  const raw = ["deadbeef", Date.now() + 60_000].join("\0");
  const payload = Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const foreignMac = createHmac("sha256", process.env.JWT_SECRET!)
    .update(raw)
    .digest("hex");
  assert.equal(verifyPreviewHandoffToken(`${payload}.${foreignMac}`), null);
});

test("fails closed in production with no signing secret", () => {
  const savedJwt = process.env.JWT_SECRET;
  const savedEnc = process.env.SETTINGS_ENC_KEY;
  const savedEnv = process.env.ENV_NAME;
  try {
    const token = makePreviewHandoffToken(); // minted while configured
    delete process.env.JWT_SECRET;
    delete process.env.SETTINGS_ENC_KEY;
    delete process.env.ENV_NAME; // unset ENV_NAME counts as production
    assert.throws(() => makePreviewHandoffToken());
    assert.equal(verifyPreviewHandoffToken(token), null);
  } finally {
    if (savedJwt !== undefined) process.env.JWT_SECRET = savedJwt;
    if (savedEnc !== undefined) process.env.SETTINGS_ENC_KEY = savedEnc;
    if (savedEnv !== undefined) process.env.ENV_NAME = savedEnv;
  }
});
