import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Logger, NotFoundException } from "@nestjs/common";
import { MemberNotificationsService } from "./member-notifications.service";

before(() => {
  Logger.overrideLogger(false);
});

function makePrisma(over: any = {}): any {
  return {
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    memberNotification: {
      create: async () => ({}),
      createMany: async () => ({ count: 0 }),
      findMany: async () => [],
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
      deleteMany: async () => ({ count: 0 }),
      ...over,
    },
  };
}

test("record writes one inbox row", async () => {
  let data: any = null;
  const svc = new MemberNotificationsService(
    makePrisma({
      create: async (a: any) => {
        data = a.data;
        return {};
      },
    }),
  );
  await svc.record({
    userId: "u1",
    category: "new-course",
    title: "Acme",
    body: "New course",
    href: "courses/c1",
    dedupeKey: "new-course:c1:u1",
  });
  assert.equal(data.userId, "u1");
  assert.equal(data.dedupeKey, "new-course:c1:u1");
});

test("record swallows a duplicate (P2002) idempotently", async () => {
  const svc = new MemberNotificationsService(
    makePrisma({
      create: async () => {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      },
    }),
  );
  await svc.record({
    userId: "u1",
    category: "new-course",
    title: "t",
    body: "b",
    href: "courses/c1",
    dedupeKey: "dup",
  });
  assert.ok(true, "must not throw on a duplicate");
});

test("recordMany builds a per-recipient dedupeKey from the prefix", async () => {
  let rows: any[] = [];
  const svc = new MemberNotificationsService(
    makePrisma({
      createMany: async ({ data }: any) => {
        rows = data;
        return { count: data.length };
      },
    }),
  );
  await svc.recordMany(["u1", "u2"], {
    category: "new-course",
    title: "Acme",
    body: "New course",
    href: "courses/c1",
    dedupePrefix: "new-course:c1",
  });
  assert.deepEqual(
    rows.map((r) => r.dedupeKey),
    ["new-course:c1:u1", "new-course:c1:u2"],
  );
});

test("list maps read state from readAt and returns unreadCount", async () => {
  const svc = new MemberNotificationsService(
    makePrisma({
      findMany: async () => [
        {
          id: "n1",
          category: "new-course",
          title: "t",
          body: "b",
          href: "courses/c1",
          readAt: null,
          createdAt: new Date("2026-09-13T00:00:00Z"),
        },
        {
          id: "n2",
          category: "live-now",
          title: "t2",
          body: "b2",
          href: "live/s1",
          readAt: new Date("2026-09-13T01:00:00Z"),
          createdAt: new Date("2026-09-12T00:00:00Z"),
        },
      ],
      count: async ({ where }: any) => (where.readAt === null ? 1 : 2),
    }),
  );
  const res = await svc.list({ userId: "u1" });
  assert.equal(res.total, 2);
  assert.equal(res.unreadCount, 1);
  assert.equal(res.items[0].read, false);
  assert.equal(res.items[1].read, true);
});

test("list clamps non-numeric page/pageSize instead of passing NaN to Prisma", async () => {
  let args: any = null;
  const svc = new MemberNotificationsService(
    makePrisma({
      findMany: async (a: any) => {
        args = a;
        return [];
      },
    }),
  );
  // Simulates ?page=abc&pageSize=x from the controller (Number("abc") === NaN).
  const res = await svc.list({ userId: "u1", page: NaN, pageSize: NaN });
  assert.equal(res.page, 1);
  assert.equal(res.pageSize, 20);
  assert.equal(args.skip, 0, "skip must be a real integer, never NaN");
  assert.equal(args.take, 20);
});

test("markRead is scoped to the member and 404s a missing row", async () => {
  let where: any = null;
  const svc = new MemberNotificationsService(
    makePrisma({
      updateMany: async (a: any) => {
        where = a.where;
        return { count: 1 };
      },
    }),
  );
  await svc.markRead("u1", "n1");
  assert.equal(where.userId, "u1");
  assert.equal(where.id, "n1");

  const svc404 = new MemberNotificationsService(
    makePrisma({
      updateMany: async () => ({ count: 0 }),
      findFirst: async () => null,
    }),
  );
  await assert.rejects(() => svc404.markRead("u1", "gone"), NotFoundException);
});

test("markAllRead updates only the member's unread rows", async () => {
  let where: any = null;
  const svc = new MemberNotificationsService(
    makePrisma({
      updateMany: async (a: any) => {
        where = a.where;
        return { count: 3 };
      },
    }),
  );
  await svc.markAllRead("u1");
  assert.equal(where.userId, "u1");
  assert.equal(where.readAt, null);
});
