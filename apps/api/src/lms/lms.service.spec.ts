import { test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { LmsService } from "./lms.service";

// Course delete/archive behaviour.

function make(prisma: any): LmsService {
  return new LmsService(prisma, {} as any, {} as any, {} as any);
}

test("deleteCourse() hard-deletes the course", async () => {
  let deleted = false;
  const svc = make({
    course: {
      findUnique: async () => ({ id: "C1", lessons: [] }),
      delete: async () => {
        deleted = true;
        return {};
      },
    },
  });
  const r = await svc.deleteCourse("C1");
  assert.equal(r.ok, true);
  assert.ok(deleted, "expected the course to be deleted");
});

test("deleteCourse() 404s for a missing course", async () => {
  const svc = make({
    course: { findUnique: async () => null },
  });
  await assert.rejects(() => svc.deleteCourse("nope"), NotFoundException);
});

test("archiveCourse() sets archivedAt instead of hard-deleting", async () => {
  let updateArg: any = null;
  const svc = make({
    course: {
      findUnique: async () => ({ id: "C1" }),
      update: async (a: any) => {
        updateArg = a;
        return {};
      },
    },
  });
  const r = await svc.archiveCourse("C1");
  assert.equal(r.ok, true);
  assert.ok(updateArg.data.archivedAt instanceof Date);
});
