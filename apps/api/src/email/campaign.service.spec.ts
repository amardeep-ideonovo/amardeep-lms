import { test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { CampaignService } from "./campaign.service";

// Unit tests for CampaignService.stats(): the delivery + engagement rollup maps
// EmailLog statuses into the send/failed/queued/bounced/complained breakdown and
// the EmailEvent type-groups into delivered/opened/clicked, with rates over
// `sends`. Prisma is a hand mock so we assert the aggregation math without a DB.

type Log = { id: string; status: string };
type Group = { type: string; _count: { _all: number } };

function makeService(opts: {
  campaign: unknown;
  logs?: Log[];
  groups?: Group[];
}) {
  const calls = { groupBy: 0 };
  const prisma = {
    campaign: { findUnique: async () => opts.campaign },
    emailLog: { findMany: async () => opts.logs ?? [] },
    emailEvent: {
      groupBy: async () => {
        calls.groupBy += 1;
        return opts.groups ?? [];
      },
    },
  };
  const svc = new CampaignService(prisma as never, {} as never, {} as never);
  return { svc, calls };
}

test("stats: maps statuses + events into the rollup and computes rates", async () => {
  const { svc } = makeService({
    campaign: { id: "c1" },
    logs: [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`,
        status: "SENT",
      })),
      { id: "b1", status: "BOUNCED" },
      { id: "x1", status: "COMPLAINED" },
      { id: "f1", status: "FAILED" },
      { id: "f2", status: "FAILED" },
      { id: "q1", status: "QUEUED" },
    ],
    groups: [
      { type: "DELIVERED", _count: { _all: 11 } },
      { type: "OPEN", _count: { _all: 6 } },
      { type: "CLICK", _count: { _all: 3 } },
    ],
  });
  const s = await svc.stats("c1");
  assert.equal(s.sends, 12); // 10 SENT + 1 BOUNCED + 1 COMPLAINED (all dispatched)
  assert.equal(s.failed, 2);
  assert.equal(s.queued, 1);
  assert.equal(s.bounced, 1);
  assert.equal(s.complained, 1);
  assert.equal(s.delivered, 11);
  assert.equal(s.opened, 6);
  assert.equal(s.clicked, 3);
  assert.equal(s.openRate, 0.5); // 6/12
  assert.equal(s.clickRate, 0.25); // 3/12
});

test("stats: no logs -> all zeros, rates 0, and no event query", async () => {
  const { svc, calls } = makeService({ campaign: { id: "c2" }, logs: [] });
  const s = await svc.stats("c2");
  assert.equal(s.sends, 0);
  assert.equal(s.opened, 0);
  assert.equal(s.openRate, 0);
  assert.equal(s.clickRate, 0);
  assert.equal(calls.groupBy, 0); // skipped the needless empty-`in` round trip
});

test("stats: unknown campaign throws NotFound", async () => {
  const { svc } = makeService({ campaign: null });
  await assert.rejects(() => svc.stats("nope"), NotFoundException);
});
