import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MembersService } from './members.service';

// The paid-status summary drives BOTH the pill the admin list renders and the
// `status` filter's WHERE clause. It used to be find()/[0] over an unordered
// relation, so a member holding several STRIPE grants got a non-deterministic
// answer — which is why it could not be filtered on. These lock the precedence.

/* eslint-disable @typescript-eslint/no-explicit-any */
function svc(): MembersService {
  return new MembersService({} as any, {} as any, {} as any, {} as any);
}

function member(grants: { status: string; source?: string; name?: string }[]) {
  return {
    id: 'u1',
    username: 'u',
    email: 'u@example.com',
    firstName: 'A',
    lastName: 'B',
    phone: null,
    createdAt: new Date(),
    levels: grants.map((g, i) => ({
      levelId: `l${i}`,
      status: g.status,
      source: g.source ?? 'STRIPE',
      lifetime: false,
      level: { id: `l${i}`, name: g.name ?? `Class ${i}` },
    })),
  };
}

const summarize = (grants: Parameters<typeof member>[0]) =>
  (svc() as any).toRow(member(grants)).subscription;

test('ACTIVE outranks every other status regardless of grant order', () => {
  for (const other of ['PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED']) {
    assert.equal(summarize([{ status: other }, { status: 'ACTIVE' }]).status, 'ACTIVE');
    assert.equal(summarize([{ status: 'ACTIVE' }, { status: other }]).status, 'ACTIVE');
  }
});

test('PAST_DUE outranks PAUSED / CANCELED / EXPIRED', () => {
  for (const other of ['PAUSED', 'CANCELED', 'EXPIRED']) {
    assert.equal(summarize([{ status: other }, { status: 'PAST_DUE' }]).status, 'PAST_DUE');
  }
});

test('ACTIVE and PAST_DUE both count as an active subscription', () => {
  assert.equal(summarize([{ status: 'ACTIVE' }]).active, true);
  assert.equal(summarize([{ status: 'PAST_DUE' }]).active, true);
  assert.equal(summarize([{ status: 'PAUSED' }]).active, false);
  assert.equal(summarize([{ status: 'CANCELED' }]).active, false);
});

test('a member with no STRIPE grant has no subscription (the UI shows Active)', () => {
  // This is why the `active` status filter must ALSO match members with zero
  // paid grants — otherwise it drops most of the table.
  assert.equal(summarize([]), null);
  assert.equal(summarize([{ status: 'ACTIVE', source: 'MANUAL' }]), null);
});

test('only ACTIVE grants are surfaced as the member’s classes', () => {
  const row = (svc() as any).toRow(
    member([
      { status: 'ACTIVE', name: 'Held' },
      { status: 'CANCELED', name: 'History' },
    ]),
  );
  assert.deepEqual(
    row.levels.map((l: { name: string }) => l.name),
    ['Held'],
  );
});
