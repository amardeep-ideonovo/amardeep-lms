import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  utcFromLocalInput,
  instantFromWallClock,
  wallClockIn,
} from './wallclock.util';

// The one hard contract: an admin-entered wall-time is anchored to the CHOSEN
// IANA zone (not the server's), and correctly across DST. If this regresses,
// every live session fires at the wrong moment.

test('utcFromLocalInput: same wall-time in different zones yields different UTC instants', () => {
  // 2:00 PM on 2026-07-02 (summer): PDT = UTC-7, EDT = UTC-4.
  assert.equal(
    utcFromLocalInput('2026-07-02T14:00', 'America/Los_Angeles').toISOString(),
    '2026-07-02T21:00:00.000Z',
  );
  assert.equal(
    utcFromLocalInput('2026-07-02T14:00', 'America/New_York').toISOString(),
    '2026-07-02T18:00:00.000Z',
  );
});

test('utcFromLocalInput: DST-aware (winter offsets differ from summer)', () => {
  // 2:00 PM on 2026-01-15 (winter): EST = UTC-5 -> 19:00Z (vs EDT 18:00Z above).
  assert.equal(
    utcFromLocalInput('2026-01-15T14:00', 'America/New_York').toISOString(),
    '2026-01-15T19:00:00.000Z',
  );
});

test('utcFromLocalInput: null and "UTC" are plain UTC', () => {
  assert.equal(
    utcFromLocalInput('2026-07-02T14:00', null).toISOString(),
    '2026-07-02T14:00:00.000Z',
  );
  assert.equal(
    utcFromLocalInput('2026-07-02T14:00', 'UTC').toISOString(),
    '2026-07-02T14:00:00.000Z',
  );
});

test('utcFromLocalInput: accepts optional seconds', () => {
  assert.equal(
    utcFromLocalInput('2026-07-02T14:00:30', 'UTC').toISOString(),
    '2026-07-02T14:00:30.000Z',
  );
});

test('utcFromLocalInput: rejects malformed input', () => {
  assert.throws(() => utcFromLocalInput('not-a-date', 'UTC'));
  assert.throws(() => utcFromLocalInput('2026-07-02', 'UTC'));
});

test('wallClockIn is the inverse of instantFromWallClock', () => {
  const wall = { year: 2026, month: 7, day: 2, hour: 14, minute: 0, second: 0 };
  const instant = instantFromWallClock(wall, 'America/Los_Angeles');
  assert.deepEqual(wallClockIn(instant, 'America/Los_Angeles'), wall);
});
