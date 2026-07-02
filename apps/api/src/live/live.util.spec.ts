import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerHostAllowed } from './live.util';

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
