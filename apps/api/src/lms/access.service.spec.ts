import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessService } from './access.service';

// canAccessLiveSessionWith is pure (no Prisma), so it's constructed with a null
// client. This is the gate that decides who sees the live-session bar and who
// can be handed the join credentials — its correctness is load-bearing.
const svc = new AccessService(null as never);

test('LEVELS: visible only when the active set intersects a target', () => {
  const active = new Set(['lvl_a', 'lvl_b']);
  assert.equal(
    svc.canAccessLiveSessionWith(active, { audience: 'LEVELS', levelIds: ['lvl_b'] }),
    true,
  );
  assert.equal(
    svc.canAccessLiveSessionWith(active, { audience: 'LEVELS', levelIds: ['lvl_z'] }),
    false,
  );
});

test('LEVELS: empty targets fail closed (invisible to everyone)', () => {
  const active = new Set(['lvl_a']);
  assert.equal(
    svc.canAccessLiveSessionWith(active, { audience: 'LEVELS', levelIds: [] }),
    false,
  );
});

test('ALL_ACTIVE: visible iff the member holds >=1 active level', () => {
  assert.equal(
    svc.canAccessLiveSessionWith(new Set(['lvl_a']), { audience: 'ALL_ACTIVE', levelIds: [] }),
    true,
  );
  assert.equal(
    svc.canAccessLiveSessionWith(new Set(), { audience: 'ALL_ACTIVE', levelIds: [] }),
    false,
  );
});

test('a member with no active levels never accesses a LEVELS session', () => {
  assert.equal(
    svc.canAccessLiveSessionWith(new Set(), { audience: 'LEVELS', levelIds: ['lvl_a'] }),
    false,
  );
});
