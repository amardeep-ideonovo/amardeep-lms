import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { LiveReminderService } from "./live-reminder.service";

before(() => {
  Logger.overrideLogger(false);
});

type Session = {
  id: string;
  title: string;
  audience: "ALL_ACTIVE" | "LEVELS";
  startsAt: Date;
  joinLeadMin: number;
  targets: { levelId: string }[];
};

function svcWith(opts: {
  startingSoon?: Session[];
  liveNow?: Session[];
  claimCount?: number;
}) {
  const sent: { levelIds: string[]; input: any }[] = [];
  const claims: any[] = [];
  const prisma: any = {
    liveSession: {
      findMany: async ({ where }: any) => {
        if (where.reminderSentAt === null) return opts.startingSoon ?? [];
        if (where.liveNowSentAt === null) return opts.liveNow ?? [];
        return [];
      },
      updateMany: async ({ where, data }: any) => {
        claims.push({ where, data });
        return { count: opts.claimCount ?? 1 };
      },
    },
  };
  const push: any = {
    dispatchToLevels: async (levelIds: string[], input: any) => {
      sent.push({ levelIds, input });
    },
  };
  return { svc: new LiveReminderService(prisma, push), sent, claims };
}

test("fires live-starting-soon inside the lead window, to the target levels", async () => {
  const startsAt = new Date(Date.now() + 5 * 60_000); // 5 min out
  const { svc, sent, claims } = svcWith({
    startingSoon: [
      {
        id: "s1",
        title: "Yoga",
        audience: "LEVELS",
        startsAt,
        joinLeadMin: 10, // window opened at startsAt-10min => already inside
        targets: [{ levelId: "L1" }, { levelId: "L2" }],
      },
    ],
  });
  await svc.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.category, "live-starting-soon");
  assert.deepEqual(sent[0].levelIds, ["L1", "L2"]);
  assert.equal(sent[0].input.href, "live/s1");
  assert.equal(sent[0].input.broadcast, false);
  assert.ok(
    claims.some((c) => "reminderSentAt" in c.data),
    "claims the reminderSentAt marker",
  );
});

test("does not fire starting-soon before the lead window", async () => {
  const startsAt = new Date(Date.now() + 60 * 60_000); // 60 min out
  const { svc, sent } = svcWith({
    startingSoon: [
      {
        id: "s2",
        title: "T",
        audience: "LEVELS",
        startsAt,
        joinLeadMin: 10, // window opens at startsAt-10min, still ~50 min away
        targets: [{ levelId: "L1" }],
      },
    ],
  });
  await svc.tick();
  assert.equal(sent.length, 0);
});

test("fires live-now for a started, ongoing ALL_ACTIVE session (broadcast)", async () => {
  const { svc, sent } = svcWith({
    liveNow: [
      {
        id: "s3",
        title: "Live class",
        audience: "ALL_ACTIVE",
        startsAt: new Date(Date.now() - 60_000),
        joinLeadMin: 10,
        targets: [],
      },
    ],
  });
  await svc.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.category, "live-now");
  assert.equal(sent[0].input.broadcast, true);
  assert.deepEqual(sent[0].levelIds, []);
  assert.equal(sent[0].input.href, "live/s3");
});

test("skips a fire when the marker claim loses the race", async () => {
  const { svc, sent } = svcWith({
    startingSoon: [
      {
        id: "s4",
        title: "T",
        audience: "LEVELS",
        startsAt: new Date(Date.now() + 5 * 60_000),
        joinLeadMin: 10,
        targets: [{ levelId: "L1" }],
      },
    ],
    claimCount: 0, // another worker already claimed it
  });
  await svc.tick();
  assert.equal(sent.length, 0);
});
