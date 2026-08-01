import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import type { JwtPayload } from './jwt-payload.interface';

// Unit tests for the tokenVersion session-revocation check added to
// JwtStrategy.validate: a token whose `tv` no longer matches the DB row (a
// password change/reset bumped it) is rejected, while a legacy token with no
// `tv` claim stays valid only while the row's tokenVersion is still 0.

before(() => {
  process.env.JWT_SECRET = 'jwt-strategy-spec-secret';
});

const config = { get: () => process.env.JWT_SECRET } as never;

function strategyWith(row: unknown, kind: 'admin' | 'user'): JwtStrategy {
  const prisma = {
    admin: { findUnique: async () => (kind === 'admin' ? row : null) },
    user: { findUnique: async () => (kind === 'user' ? row : null) },
  } as never;
  return new JwtStrategy(config, prisma);
}

const adminTok = (tv?: number): JwtPayload => ({
  sub: 'a1',
  email: 'a@x.io',
  isAdmin: true,
  tv,
});
const memberTok = (tv?: number): JwtPayload => ({
  sub: 'u1',
  email: 'u@x.io',
  username: 'u',
  isAdmin: false,
  tv,
});

test('admin: matching tv returns the principal with live role', async () => {
  const s = strategyWith(
    { id: 'a1', role: 'ADMIN', permissions: {}, tokenVersion: 3 },
    'admin',
  );
  const p = await s.validate(adminTok(3));
  assert.equal(p.sub, 'a1');
  assert.equal(p.isAdmin, true);
  assert.equal(p.role, 'ADMIN');
});

test('admin: stale tv is rejected (session revoked)', async () => {
  const s = strategyWith(
    { id: 'a1', role: 'ADMIN', permissions: {}, tokenVersion: 4 },
    'admin',
  );
  await assert.rejects(() => s.validate(adminTok(3)), UnauthorizedException);
});

test('admin: legacy token (no tv) valid at row tv=0, rejected once bumped', async () => {
  const ok = strategyWith(
    { id: 'a1', role: 'ADMIN', permissions: {}, tokenVersion: 0 },
    'admin',
  );
  await ok.validate(adminTok(undefined)); // no tv ⇒ treated as 0
  const bumped = strategyWith(
    { id: 'a1', role: 'ADMIN', permissions: {}, tokenVersion: 1 },
    'admin',
  );
  await assert.rejects(
    () => bumped.validate(adminTok(undefined)),
    UnauthorizedException,
  );
});

test('member: matching tv returns principal; stale tv rejected', async () => {
  const ok = strategyWith({ id: 'u1', tokenVersion: 2 }, 'user');
  const p = await ok.validate(memberTok(2));
  assert.equal(p.sub, 'u1');
  assert.equal(p.isAdmin, false);

  const stale = strategyWith({ id: 'u1', tokenVersion: 3 }, 'user');
  await assert.rejects(() => stale.validate(memberTok(2)), UnauthorizedException);
});

test('missing subject → 401 (unchanged behavior)', async () => {
  const s = strategyWith(null, 'user');
  await assert.rejects(
    () => s.validate({ sub: 'gone', email: 'x@x.io', isAdmin: false }),
    UnauthorizedException,
  );
});
