import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  RESET_TOKEN_TTL_MS,
  fingerprintMatches,
  makePasswordResetToken,
  passwordHashFingerprint,
  verifyPasswordResetToken,
} from './reset-token.util';

// Unit tests for the stateless password-reset token: the crypto round-trip,
// every rejection path (tamper/expiry/garbage/cross-protocol), and the two
// security invariants — tokens die when the password hash changes, and the
// util fails closed in a production with no signing secret.

const HASH = '$2a$10$abcdefghijklmnopqrstuv'; // shape of a bcrypt hash — value irrelevant
const OTHER_HASH = '$2a$10$vutsrqponmlkjihgfedcba';

// The util resolves its secret per call from JWT_SECRET/SETTINGS_ENC_KEY and
// fails closed when neither is set (ENV_NAME unset counts as production), so
// give the test process a secret up front.
before(() => {
  process.env.JWT_SECRET = 'reset-token-spec-secret';
});

test('round-trips: a fresh token verifies to its userId + hash fingerprint', () => {
  const token = makePasswordResetToken('user-123', HASH);
  const data = verifyPasswordResetToken(token);
  assert.ok(data, 'expected a valid token to verify');
  assert.equal(data.userId, 'user-123');
  assert.ok(fingerprintMatches(data.fingerprint, passwordHashFingerprint(HASH)));
});

test('dies once the password hash changes (single-use invariant)', () => {
  const token = makePasswordResetToken('user-123', HASH);
  const data = verifyPasswordResetToken(token)!;
  // Same comparison resetPassword() makes after the hash was updated.
  assert.equal(
    fingerprintMatches(data.fingerprint, passwordHashFingerprint(OTHER_HASH)),
    false,
  );
});

test('rejects a tampered payload', () => {
  const token = makePasswordResetToken('user-123', HASH);
  const [payload, mac] = token.split('.');
  const flipped =
    (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1) + '.' + mac;
  assert.equal(verifyPasswordResetToken(flipped), null);
});

test('rejects garbage inputs without throwing', () => {
  for (const bad of [
    null,
    undefined,
    '',
    'no-dot',
    '.leading-dot',
    'trailing-dot.',
    'a.b',
    '!!!.###',
    'x'.repeat(600), // over the length cap
  ]) {
    assert.equal(verifyPasswordResetToken(bad as string), null, `input: ${bad}`);
  }
});

test('expires after RESET_TOKEN_TTL_MS', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
  const token = makePasswordResetToken('user-123', HASH);
  t.mock.timers.setTime(1_000_000_000_000 + RESET_TOKEN_TTL_MS - 1);
  assert.ok(verifyPasswordResetToken(token), 'still valid just before expiry');
  t.mock.timers.setTime(1_000_000_000_000 + RESET_TOKEN_TTL_MS + 1);
  assert.equal(verifyPasswordResetToken(token), null, 'dead after expiry');
});

test('rejects a same-secret MAC that lacks the domain prefix (cross-protocol)', () => {
  // What unsubscribe.util/confirm-token.util would produce for this payload:
  // HMAC over the RAW payload with the same key, no domain separation.
  const raw = ['user-123', Date.now() + 60_000, passwordHashFingerprint(HASH)]
    .join('\0');
  const payload = Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const foreignMac = createHmac('sha256', process.env.JWT_SECRET!)
    .update(raw)
    .digest('hex');
  assert.equal(verifyPasswordResetToken(`${payload}.${foreignMac}`), null);
});

test('fails closed in production with no signing secret', () => {
  const savedJwt = process.env.JWT_SECRET;
  const savedEnc = process.env.SETTINGS_ENC_KEY;
  const savedEnv = process.env.ENV_NAME;
  try {
    const token = makePasswordResetToken('user-123', HASH); // minted while configured
    delete process.env.JWT_SECRET;
    delete process.env.SETTINGS_ENC_KEY;
    delete process.env.ENV_NAME; // unset ENV_NAME counts as production
    // Minting must refuse the insecure dev fallback…
    assert.throws(() => makePasswordResetToken('user-123', HASH));
    // …and verification must degrade to "invalid" (a public route), not throw.
    assert.equal(verifyPasswordResetToken(token), null);
  } finally {
    if (savedJwt !== undefined) process.env.JWT_SECRET = savedJwt;
    if (savedEnc !== undefined) process.env.SETTINGS_ENC_KEY = savedEnc;
    if (savedEnv !== undefined) process.env.ENV_NAME = savedEnv;
  }
});
