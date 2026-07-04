// Timezone-aware wall-clock <-> UTC conversion.
//
// Extracted so live sessions and email campaigns interpret an admin-entered
// local time against an explicit IANA zone identically — and correctly across
// DST — without pulling in a date library. Uses Intl.DateTimeFormat.
//
// The member/admin UI sends a NAIVE wall-time (e.g. "2026-07-02T14:00") plus an
// IANA zone; the server owns the conversion to a UTC instant. Never convert with
// `new Date(local).toISOString()` on the client — that silently reinterprets the
// string in the browser's zone, ignoring the admin's chosen zone.
//
// NOTE: CampaignService still keeps private copies of this logic
// (instantFromWallClock / tzOffsetMs / wallClockIn); those can be migrated to
// call these helpers to de-duplicate. Behavior here is copied verbatim.

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// Decompose an instant into wall-clock Y/M/D/H/M/S as seen in `tz` (UTC when
// null). Intl keeps this correct across DST without a date library.
export function wallClockIn(d: Date, tz: string | null): WallClock {
  if (!tz || tz === 'UTC') {
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  // Intl can emit hour '24' at midnight for hour12:false; normalize to 0.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

// Inverse of wallClockIn: interpret wall-clock fields as a local time in `tz` and
// return the corresponding UTC instant. Computes the zone's offset at the
// candidate instant and subtracts it. For UTC (or null) this is a plain Date.UTC.
export function instantFromWallClock(wall: WallClock, tz: string | null): Date {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  if (!tz || tz === 'UTC') return new Date(asUtc);
  const offsetMs = tzOffsetMs(new Date(asUtc), tz);
  return new Date(asUtc - offsetMs);
}

// Milliseconds `tz` is ahead of UTC at instant `d` (negative west of UTC).
export function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - d.getTime();
}

// Naive local-time string ("YYYY-MM-DDTHH:mm" or "...:ss") authored in `tz`,
// parsed into the UTC instant it denotes. This is what a live-session write path
// calls with the admin's `startsAtLocal` + chosen `timezone`. Throws on a
// malformed string so a bad input is a 400, never a silent wrong time.
const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function utcFromLocalInput(local: string, tz: string | null): Date {
  const m = LOCAL_INPUT_RE.exec(local.trim());
  if (!m) {
    throw new Error(`Invalid local datetime: "${local}" (expected YYYY-MM-DDTHH:mm)`);
  }
  const wall: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
  return instantFromWallClock(wall, tz);
}
