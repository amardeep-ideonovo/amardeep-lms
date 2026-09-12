import { test } from "node:test";
import assert from "node:assert/strict";
import { ConflictException } from "@nestjs/common";
import { ContentPackService } from "./content-pack.service";
import { LEGAL_PAGE_ID_PREFIX } from "./content-pack.transform";

// The import's emptiness guard vs the boot seed. EVERY academy boots with its 3
// editable legal template pages (legal-* ids, seedLegalPages) BEFORE the control
// plane can push a content pack, so a guard that counted them refused every
// sample-content seed: 409 → the control plane treats 4xx as terminal → the
// academy stays empty with no classes. Pin the contract: seeded legal pages are
// the academy's own identity, not content; anything else still is.

const zero = { count: async () => 0 };

function fakePrisma(
  pageCount: (args: unknown) => Promise<number>,
  extra: Record<string, unknown> = {},
) {
  return {
    level: zero,
    course: zero,
    post: zero,
    menu: zero,
    mediaAsset: zero,
    header: zero,
    popup: zero,
    form: zero,
    certificateTemplate: zero,
    footer: zero,
    appConfig: zero,
    page: { count: pageCount },
    ...extra,
  } as any;
}

test("emptiness guard leaves the seeded legal pages out of the page count", async () => {
  let where: unknown;
  const svc = new ContentPackService(
    fakePrisma(async (args) => {
      where = (args as { where?: unknown } | undefined)?.where;
      return 0;
    }),
  );
  await (svc as any).assertEmpty();
  assert.deepEqual(where, {
    NOT: { id: { startsWith: LEGAL_PAGE_ID_PREFIX } },
  });
});

test("emptiness guard still refuses when a non-legal page exists", async () => {
  const svc = new ContentPackService(fakePrisma(async () => 1));
  await assert.rejects(() => (svc as any).assertEmpty(), ConflictException);
});

test("emptiness guard still refuses on any other content", async () => {
  const svc = new ContentPackService(
    fakePrisma(async () => 0, { level: { count: async () => 1 } }),
  );
  await assert.rejects(() => (svc as any).assertEmpty(), ConflictException);
});
