import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { HelpdeskRetentionService } from "./helpdesk-retention.service";

before(() => Logger.overrideLogger(false));

test("retentionDays=0 keeps conversations forever (no scan/purge)", async () => {
  let scanned = false;
  const prisma = {
    helpdeskSettings: { findUnique: async () => ({ retentionDays: 0 }) },
    helpdeskConversation: {
      findMany: async () => {
        scanned = true;
        return [];
      },
      deleteMany: async () => ({ count: 0 }),
    },
    helpdeskAttachment: { findMany: async () => [] },
    adminNotification: { deleteMany: async () => ({ count: 0 }) },
  };
  const svc = new HelpdeskRetentionService(prisma as never);
  await svc.sweep();
  assert.equal(
    scanned,
    false,
    "must not purge conversations when retention is off",
  );
});

test("purges terminal conversations past the window and nulls their deep-links", async () => {
  const captured: Record<string, unknown> = {};
  const prisma = {
    helpdeskSettings: { findUnique: async () => ({ retentionDays: 365 }) },
    helpdeskConversation: {
      findMany: async (a: { where: unknown }) => {
        captured.find = a.where;
        return [{ id: "c1" }, { id: "c2" }];
      },
      deleteMany: async (a: { where: unknown }) => {
        captured.del = a.where;
        return { count: 2 };
      },
    },
    helpdeskAttachment: { findMany: async () => [] },
    adminNotification: {
      updateMany: async (a: { where: unknown }) => {
        captured.upd = a.where;
        return { count: 0 };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };
  const svc = new HelpdeskRetentionService(prisma as never);
  await svc.sweep();
  assert.deepEqual((captured.find as { status: { in: string[] } }).status.in, [
    "RESOLVED",
    "CLOSED",
  ]);
  assert.deepEqual(captured.del, { id: { in: ["c1", "c2"] } });
  assert.equal((captured.upd as { entityType: string }).entityType, "helpdesk");
});
