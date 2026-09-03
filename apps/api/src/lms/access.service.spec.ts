import { test } from "node:test";
import assert from "node:assert/strict";
import { AccessService } from "./access.service";

// canAccessLiveSessionWith is pure (no Prisma / no SitePreviewService), so it's
// constructed with null deps. This is the gate that decides who sees the
// live-session bar and who can be handed the join credentials — its correctness
// is load-bearing.
const svc = new AccessService(null as never, null as never);

test("LEVELS: visible only when the active set intersects a target", () => {
  const active = new Set(["lvl_a", "lvl_b"]);
  assert.equal(
    svc.canAccessLiveSessionWith(active, {
      audience: "LEVELS",
      levelIds: ["lvl_b"],
    }),
    true,
  );
  assert.equal(
    svc.canAccessLiveSessionWith(active, {
      audience: "LEVELS",
      levelIds: ["lvl_z"],
    }),
    false,
  );
});

test("LEVELS: empty targets fail closed (invisible to everyone)", () => {
  const active = new Set(["lvl_a"]);
  assert.equal(
    svc.canAccessLiveSessionWith(active, { audience: "LEVELS", levelIds: [] }),
    false,
  );
});

test("ALL_ACTIVE: visible iff the member holds >=1 active level", () => {
  assert.equal(
    svc.canAccessLiveSessionWith(new Set(["lvl_a"]), {
      audience: "ALL_ACTIVE",
      levelIds: [],
    }),
    true,
  );
  assert.equal(
    svc.canAccessLiveSessionWith(new Set(), {
      audience: "ALL_ACTIVE",
      levelIds: [],
    }),
    false,
  );
});

test("a member with no active levels never accesses a LEVELS session", () => {
  assert.equal(
    svc.canAccessLiveSessionWith(new Set(), {
      audience: "LEVELS",
      levelIds: ["lvl_a"],
    }),
    false,
  );
});

// activeLevelIds must count a grant only while ACTIVE *and* unexpired. A failed
// renewal keeps the grant ACTIVE with expiresAt = the dunning-grace deadline;
// once that lapses (or a period-end passes) the grant no longer grants access,
// enforced at read time so a late sweep can't leave a lapsed member with access.
test("activeLevelIds excludes ACTIVE grants past their expiry", async () => {
  const now = Date.now();
  const rows = [
    { levelId: "lvl_active", status: "ACTIVE", expiresAt: null },
    {
      levelId: "lvl_grace_ok",
      status: "ACTIVE",
      expiresAt: new Date(now + 3_600_000),
    },
    {
      levelId: "lvl_grace_lapsed",
      status: "ACTIVE",
      expiresAt: new Date(now - 3_600_000),
    },
    { levelId: "lvl_pastdue", status: "PAST_DUE", expiresAt: null },
  ];
  let captured: any;
  const prisma: any = {
    userLevel: {
      findMany: async ({ where }: any) => {
        captured = where;
        return rows
          .filter((r) => {
            if (where.status && r.status !== where.status) return false;
            if (where.OR) {
              return where.OR.some((c: any) => {
                if ("expiresAt" in c && c.expiresAt === null)
                  return r.expiresAt === null;
                if (c.expiresAt && c.expiresAt.gt)
                  return r.expiresAt != null && r.expiresAt > c.expiresAt.gt;
                return false;
              });
            }
            return true;
          })
          .map((r) => ({ levelId: r.levelId }));
      },
    },
  };
  const sitePreview: any = { isUnlockedPreviewUser: async () => false };
  const withDb = new AccessService(prisma, sitePreview);
  const active = await withDb.activeLevelIds("u_1");
  assert.deepEqual([...active].sort(), ["lvl_active", "lvl_grace_ok"]);
  assert.equal(captured.status, "ACTIVE");
  assert.ok(
    Array.isArray(captured.OR),
    "query must scope on expiresAt, not status alone",
  );
});
