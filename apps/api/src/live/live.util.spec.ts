import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import {
  parseZoomMeetingNumber,
  providerHostAllowed,
  zoomSdkSignature,
} from './live.util';

// The provider-host allow-list is an anti-phishing control: it decides whether a
// stored "Zoom"/"Meet" link is really on that provider's domain before we ever
// hand the URL to a member. Its correctness is security-relevant.

test('ZOOM: accepts zoom.us and its subdomains, https only', () => {
  assert.equal(providerHostAllowed('ZOOM', 'https://zoom.us/j/123'), true);
  assert.equal(providerHostAllowed('ZOOM', 'https://us02web.zoom.us/j/123?pwd=x'), true);
  assert.equal(providerHostAllowed('ZOOM', 'http://zoom.us/j/123'), false); // not https
});

test('GOOGLE_MEET: accepts meet.google.com only', () => {
  assert.equal(providerHostAllowed('GOOGLE_MEET', 'https://meet.google.com/abc-defg-hij'), true);
  assert.equal(providerHostAllowed('GOOGLE_MEET', 'https://zoom.us/j/1'), false);
});

test('rejects look-alike and embedded-suffix hosts', () => {
  assert.equal(providerHostAllowed('ZOOM', 'https://zoom.us.evil.com/j/1'), false);
  assert.equal(providerHostAllowed('ZOOM', 'https://notzoom.us/j/1'), false);
  assert.equal(providerHostAllowed('GOOGLE_MEET', 'https://meet.google.com.evil.com/x'), false);
  assert.equal(providerHostAllowed('ZOOM', 'not-a-url'), false);
});

test('parseZoomMeetingNumber extracts the numeric meeting id', () => {
  assert.equal(
    parseZoomMeetingNumber('https://us02web.zoom.us/j/88888888888?pwd=x'),
    '88888888888',
  );
  assert.equal(parseZoomMeetingNumber('https://zoom.us/wc/1234567890/join'), '1234567890');
  assert.equal(parseZoomMeetingNumber('https://zoom.us/my/vanity-name'), null);
});

test('zoomSdkSignature is a valid HS256 JWT with the expected claims', () => {
  const jwt = zoomSdkSignature('KEY', 'SECRET', '88888888888', 0, 7200);
  const [h, p, s] = jwt.split('.');
  assert.ok(h && p && s);
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(header.alg, 'HS256');
  assert.equal(payload.sdkKey, 'KEY');
  assert.equal(payload.appKey, 'KEY');
  assert.equal(payload.mn, '88888888888');
  assert.equal(payload.role, 0);
  assert.ok(payload.exp > payload.iat);
  // signature verifies against the secret
  const expected = createHmac('sha256', 'SECRET')
    .update(`${h}.${p}`)
    .digest('base64url');
  assert.equal(s, expected);
});

test('zoomSdkSignature clamps expiry into Zoom’s allowed window', () => {
  const decode = (jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  const short = decode(zoomSdkSignature('K', 'S', '1', 0, 5));
  assert.ok(short.exp - short.iat >= 1800); // floored to 30 min
  const long = decode(zoomSdkSignature('K', 'S', '1', 0, 10_000_000));
  assert.ok(long.exp - long.iat <= 172800); // capped at 48h
});
