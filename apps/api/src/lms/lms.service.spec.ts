import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { LmsService } from './lms.service';

// Guard tests for the destructive-delete fix: a course that members still own
// can't be hard-deleted (would wipe lifetime purchases + payment correlation).

/* eslint-disable @typescript-eslint/no-explicit-any */
function make(prisma: any): LmsService {
  return new LmsService(prisma, {} as any, {} as any, {} as any);
}

test('deleteCourse() 409s when a member still owns the course', async () => {
  const svc = make({
    course: { findUnique: async () => ({ id: 'C1', lessons: [] }) },
    userCourse: { count: async () => 1 },
  });
  await assert.rejects(() => svc.deleteCourse('C1'), ConflictException);
});

test('deleteCourse() succeeds when nobody owns it', async () => {
  let deleted = false;
  const svc = make({
    course: {
      findUnique: async () => ({ id: 'C1', lessons: [] }),
      delete: async () => {
        deleted = true;
        return {};
      },
    },
    userCourse: { count: async () => 0 },
  });
  const r = await svc.deleteCourse('C1');
  assert.equal(r.ok, true);
  assert.ok(deleted, 'expected the course to be deleted when unblocked');
});

test('deleteCourse() 404s for a missing course', async () => {
  const svc = make({
    course: { findUnique: async () => null },
    userCourse: { count: async () => 0 },
  });
  await assert.rejects(() => svc.deleteCourse('nope'), NotFoundException);
});

test('archiveCourse() sets archivedAt without deleting purchases', async () => {
  let updateArg: any = null;
  const svc = make({
    course: {
      findUnique: async () => ({ id: 'C1' }),
      update: async (a: any) => {
        updateArg = a;
        return {};
      },
    },
  });
  const r = await svc.archiveCourse('C1');
  assert.equal(r.ok, true);
  assert.ok(updateArg.data.archivedAt instanceof Date);
});
