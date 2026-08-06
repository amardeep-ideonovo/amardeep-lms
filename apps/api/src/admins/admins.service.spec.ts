import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { AdminsService } from './admins.service';

// Unit tests for the control-plane recovery path
// (setOwnerPasswordFromControlPlane): which admin gets reset is the security-
// relevant decision, so exercise the email match, the SUPER_ADMIN fallbacks, the
// no-admin failure, and that the new password is stored hashed with sessions
// revoked. Prisma is a hand mock — no DB, no Nest DI.

type FindArgs = {
  where?: { email?: string; role?: string };
  orderBy?: unknown;
};
type UpdateArgs = {
  where: { id: string };
  data: { passwordHash: string; tokenVersion: { increment: number } };
};

function makeService(opts: {
  byEmail?: { id: string; email: string } | null;
  superAdmin?: { id: string; email: string } | null;
}) {
  const calls: { findFirst: FindArgs[]; update: UpdateArgs[] } = {
    findFirst: [],
    update: [],
  };
  const prisma = {
    admin: {
      findFirst: async (args: FindArgs) => {
        calls.findFirst.push(args);
        if (args.where?.email !== undefined) return opts.byEmail ?? null;
        if (args.where?.role === 'SUPER_ADMIN') return opts.superAdmin ?? null;
        return null;
      },
      update: async (args: UpdateArgs) => {
        calls.update.push(args);
        return { id: args.where.id };
      },
    },
  };
  const cp = { adminCredentialsChanged: async () => {} };
  const svc = new AdminsService(prisma as never, cp as never);
  return { svc, calls };
}

test('resets the admin matched by the displayed email', async () => {
  const { svc, calls } = makeService({
    byEmail: { id: 'a1', email: 'owner@acme.com' },
    superAdmin: { id: 'super', email: 'super@acme.com' },
  });
  const res = await svc.setOwnerPasswordFromControlPlane(
    'owner@acme.com',
    'a-strong-pw-123',
  );
  assert.equal(res.email, 'owner@acme.com');
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].where.id, 'a1');
  // Stored as a bcrypt hash of the given password, and sessions are revoked.
  assert.ok(
    await bcrypt.compare('a-strong-pw-123', calls.update[0].data.passwordHash),
  );
  assert.deepEqual(calls.update[0].data.tokenVersion, { increment: 1 });
});

test('falls back to the earliest SUPER_ADMIN when the email is not found', async () => {
  // e.g. the admin renamed their email, so the control plane's displayed email
  // no longer matches — recovery must still land on the seeded owner.
  const { svc, calls } = makeService({
    byEmail: null,
    superAdmin: { id: 'super', email: 'super@acme.com' },
  });
  const res = await svc.setOwnerPasswordFromControlPlane(
    'stale@acme.com',
    'a-strong-pw-123',
  );
  assert.equal(res.email, 'super@acme.com');
  assert.equal(calls.update[0].where.id, 'super');
});

test('falls back to SUPER_ADMIN and skips the email lookup when no email given', async () => {
  const { svc, calls } = makeService({
    superAdmin: { id: 'super', email: 'super@acme.com' },
  });
  const res = await svc.setOwnerPasswordFromControlPlane(
    null,
    'a-strong-pw-123',
  );
  assert.equal(res.email, 'super@acme.com');
  assert.ok(calls.findFirst.every((c) => c.where?.email === undefined));
});

test('throws when the instance has no admin to reset', async () => {
  const { svc } = makeService({ byEmail: null, superAdmin: null });
  await assert.rejects(() =>
    svc.setOwnerPasswordFromControlPlane('x@y.com', 'a-strong-pw-123'),
  );
});
