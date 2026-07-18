import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LevelsService } from './levels.service';

// Guard tests for the destructive-delete fix: a class with active member grants
// can't be hard-deleted (would strand paying members), and archive() is the
// non-destructive alternative that keeps grants intact.

/* eslint-disable @typescript-eslint/no-explicit-any */
function make(prisma: any): LevelsService {
  return new LevelsService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

test('remove() 409s when the class still has active member grants', async () => {
  const svc = make({
    level: { findUnique: async () => ({ id: 'L1' }), delete: async () => ({}) },
    userLevel: { count: async () => 2 },
  });
  await assert.rejects(() => svc.remove('L1'), ConflictException);
});

test('remove() succeeds (and deletes) when there are no active grants', async () => {
  let deleted = false;
  const svc = make({
    level: {
      findUnique: async () => ({ id: 'L1' }),
      delete: async () => {
        deleted = true;
        return {};
      },
    },
    userLevel: { count: async () => 0 },
  });
  const r = await svc.remove('L1');
  assert.equal(r.ok, true);
  assert.ok(deleted, 'expected the level to be deleted when unblocked');
});

test('remove() 404s for a missing class', async () => {
  const svc = make({
    level: { findUnique: async () => null },
    userLevel: { count: async () => 0 },
  });
  await assert.rejects(() => svc.remove('nope'), NotFoundException);
});

test('archive() sets archivedAt + published:false and never deletes grants', async () => {
  let updateArg: any = null;
  const svc = make({
    level: {
      findUnique: async () => ({ id: 'L1' }),
      update: async (a: any) => {
        updateArg = a;
        return {};
      },
    },
  });
  const r = await svc.archive('L1');
  assert.equal(r.ok, true);
  assert.equal(updateArg.data.published, false);
  assert.ok(updateArg.data.archivedAt instanceof Date);
});
