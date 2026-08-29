import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { HelpdeskService } from "./helpdesk.service";
import type { AuthenticatedPrincipal } from "../auth/jwt-payload.interface";

before(() => Logger.overrideLogger(false));

const member: AuthenticatedPrincipal = {
  sub: "u1",
  email: "m@example.com",
  username: "m",
  isAdmin: false,
};

// Build a service over a hand-rolled prisma mock (cast `as never` — no DI).
// `sent` collects sendTemplate calls so tests can assert on the reply email.
function makeService(
  prismaOverrides: Record<string, unknown>,
  sent: unknown[] = [],
) {
  const notifications = { record: async () => undefined } as never;
  const email = {
    sendTemplate: async (input: unknown) => {
      sent.push(input);
      return {} as never;
    },
  } as never;
  const appConfig = { read: async () => ({ title: "Spotlight" }) } as never;
  const config = { get: () => "https://members.example.com" } as never;
  return new HelpdeskService(
    prismaOverrides as never,
    notifications,
    email,
    appConfig,
    config,
  );
}

test("start() 403s HELPDESK_DISABLED when the widget is off", async () => {
  const svc = makeService({
    helpdeskSettings: { findUnique: async () => ({ enabled: false }) },
  });
  await assert.rejects(
    () => svc.start(member, { issue: "help" }),
    (e: unknown) => {
      assert.ok(e instanceof ForbiddenException);
      const res = e.getResponse() as { code?: string };
      assert.equal(res.code, "HELPDESK_DISABLED");
      return true;
    },
  );
});

test("start() 409s HELPDESK_TOO_MANY_OPEN at the cap", async () => {
  const svc = makeService({
    helpdeskSettings: {
      findUnique: async () => ({ enabled: true, maxOpenPerMember: 3 }),
    },
    helpdeskConversation: { count: async () => 3 },
  });
  await assert.rejects(
    () => svc.start(member, { issue: "help" }),
    (e: unknown) => {
      assert.ok(e instanceof ConflictException);
      const res = e.getResponse() as { code?: string };
      assert.equal(res.code, "HELPDESK_TOO_MANY_OPEN");
      return true;
    },
  );
});

test("start() 403s an admin/preview principal (members only)", async () => {
  const svc = makeService({});
  await assert.rejects(
    () => svc.start({ ...member, isAdmin: true }, { issue: "hi" }),
    ForbiddenException,
  );
});

test("threadForMember() 404s a conversation owned by someone else", async () => {
  const svc = makeService({
    helpdeskConversation: { findFirst: async () => null },
  });
  await assert.rejects(
    () => svc.threadForMember("u1", "c-other"),
    NotFoundException,
  );
});

test("replyAsMember() 409s HELPDESK_CLOSED on a closed thread", async () => {
  const svc = makeService({
    helpdeskConversation: {
      findFirst: async () => ({ id: "c1", userId: "u1", status: "CLOSED" }),
    },
  });
  await assert.rejects(
    () => svc.replyAsMember(member, "c1", { body: "still broken" }),
    (e: unknown) => {
      assert.ok(e instanceof ConflictException);
      const res = e.getResponse() as { code?: string };
      assert.equal(res.code, "HELPDESK_CLOSED");
      return true;
    },
  );
});

test("config() tells a logged-out visitor to sign in", async () => {
  const svc = makeService({
    helpdeskSettings: { findUnique: async () => ({ enabled: true }) },
  });
  const cfg = await svc.config(undefined);
  assert.equal(cfg.requiresSignIn, true);
  assert.equal(cfg.openConversations.length, 0);
});

function fakeFile(mimetype: string, size = 100): Express.Multer.File {
  return {
    mimetype,
    size,
    buffer: Buffer.from("x"),
    originalname: "x",
  } as Express.Multer.File;
}

test("addMemberAttachments 404s a message not owned by the member", async () => {
  const svc = makeService({
    helpdeskMessage: { findFirst: async () => null },
  });
  await assert.rejects(
    () =>
      svc.addMemberAttachments("u1", "c1", "m-other", [fakeFile("image/png")]),
    NotFoundException,
  );
});

test("addMemberAttachments rejects a non-image attachment", async () => {
  const svc = makeService({
    helpdeskMessage: { findFirst: async () => ({ id: "m1" }) },
  });
  await assert.rejects(
    () =>
      svc.addMemberAttachments("u1", "c1", "m1", [fakeFile("application/pdf")]),
    BadRequestException,
  );
});

test("addMemberAttachments rejects more than 3 images", async () => {
  const svc = makeService({
    helpdeskMessage: { findFirst: async () => ({ id: "m1" }) },
  });
  const four = [0, 1, 2, 3].map(() => fakeFile("image/png"));
  await assert.rejects(
    () => svc.addMemberAttachments("u1", "c1", "m1", four),
    BadRequestException,
  );
});

test("attachmentForDownload 404s a foreign attachment (owner scope)", async () => {
  const svc = makeService({
    helpdeskAttachment: { findFirst: async () => null },
  });
  await assert.rejects(
    () => svc.attachmentForDownload("a1", { userId: "u1", allowAdmin: false }),
    NotFoundException,
  );
});

test("createArticle generates a unique slug on collision", async () => {
  let calls = 0;
  const svc = makeService({
    helpdeskArticle: {
      findUnique: async () => (calls++ === 0 ? { id: "x" } : null),
      create: async (a: { data: Record<string, unknown> }) => ({
        id: "a1",
        updatedAt: new Date(),
        ...a.data,
      }),
    },
  });
  const art = await svc.createArticle({
    title: "Reset my password",
    body: "Use the forgot-password link.",
  });
  assert.equal(art.slug, "reset-my-password-2");
});

test("deleteArticle 404s a missing article", async () => {
  const svc = makeService({
    helpdeskArticle: { findUnique: async () => null },
  });
  await assert.rejects(() => svc.deleteArticle("nope"), NotFoundException);
});

// ───────────────── admin reply → member email ─────────────────

const adminP: AuthenticatedPrincipal = {
  sub: "a1",
  email: "admin@example.com",
  username: "admin",
  isAdmin: true,
};

/** Prisma mock for adminReply. adminThread (the return read) is monkey-patched
 *  out — these tests pin the EMAIL gate, not the thread serializer. */
function replyPrisma(conv: Record<string, unknown>) {
  return {
    helpdeskConversation: {
      findUnique: async () => conv,
      update: async () => ({}),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        helpdeskMessage: { create: async () => ({}) },
        helpdeskConversation: { update: async () => ({}) },
        helpdeskTicket: { update: async () => ({}) },
      }),
  };
}

const baseConv = {
  id: "c1",
  status: "ESCALATED",
  subject: "Invoice looks wrong",
  messageCount: 3,
  firstRespondedAt: null,
  unreadForMember: false,
  ticket: null,
  user: { email: "m@example.com", firstName: "Amar" },
};

/** The fire-and-forget email chain resolves on the microtask queue. */
const flush = () => new Promise((r) => setTimeout(r, 0));

test("adminReply emails the member on the first unseen reply", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const svc = makeService(replyPrisma({ ...baseConv }), sent);
  (svc as unknown as Record<string, unknown>).adminThread = async () => ({});

  await svc.adminReply(adminP, "c1", { body: "We fixed your invoice." });
  await flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "m@example.com");
  assert.equal(sent[0].templateKey, "helpdesk-reply");
  assert.equal(sent[0].transactional, true);
  // Idempotent per message: seq = messageCount + 1.
  assert.equal(sent[0].dedupeKey, "helpdesk-reply:c1:4");
  const vars = sent[0].vars as Record<string, unknown>;
  assert.equal(vars.firstName, "Amar");
  assert.equal(vars.requestSubject, "Invoice looks wrong");
  assert.equal(vars.replyPreview, "We fixed your invoice.");
});

test("adminReply does NOT email when an earlier reply is still unseen", async () => {
  // unreadForMember=true means the member was already told and hasn't looked:
  // a burst of admin messages must produce ONE email, not one per message.
  const sent: unknown[] = [];
  const svc = makeService(
    replyPrisma({ ...baseConv, unreadForMember: true }),
    sent,
  );
  (svc as unknown as Record<string, unknown>).adminThread = async () => ({});

  await svc.adminReply(adminP, "c1", { body: "Also, one more thing." });
  await flush();

  assert.equal(sent.length, 0);
});

test("adminReply does NOT email for an internal note", async () => {
  const sent: unknown[] = [];
  const svc = makeService(replyPrisma({ ...baseConv }), sent);
  (svc as unknown as Record<string, unknown>).adminThread = async () => ({});

  await svc.adminReply(adminP, "c1", {
    body: "note to self: check Stripe",
    internal: true,
  });
  await flush();

  assert.equal(sent.length, 0);
});

test("adminReply truncates a long reply into the email preview", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const svc = makeService(replyPrisma({ ...baseConv }), sent);
  (svc as unknown as Record<string, unknown>).adminThread = async () => ({});

  await svc.adminReply(adminP, "c1", { body: "x".repeat(500) });
  await flush();

  const vars = sent[0].vars as Record<string, unknown>;
  const preview = vars.replyPreview as string;
  assert.equal(preview.length, 241); // 240 chars + the ellipsis
  assert.ok(preview.endsWith("\u2026"));
});

// --- member self-resolve + once-per-resolution CSAT -------------------------

/** Prisma mock for resolve/rate. threadForMember (the return read) is
 *  monkey-patched off; `writes` collects conversation updates and day-stat
 *  upserts so tests can assert exactly what was persisted. */
function csatPrisma(
  conv: Record<string, unknown>,
  writes: Array<Record<string, unknown>>,
  dayRow: Record<string, unknown> | null = null,
) {
  const tx = {
    helpdeskConversation: {
      update: async (args: Record<string, unknown>) => {
        writes.push({ table: "conversation", ...args });
        return {};
      },
    },
    helpdeskDayStat: {
      findUnique: async () => dayRow,
      upsert: async (args: Record<string, unknown>) => {
        writes.push({ table: "dayStat", ...args });
        return {};
      },
    },
  };
  return {
    helpdeskConversation: {
      findFirst: async () => conv,
      update: tx.helpdeskConversation.update,
    },
    helpdeskDayStat: tx.helpdeskDayStat,
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
}

const patchThreadRead = (svc: HelpdeskService) => {
  (svc as unknown as Record<string, unknown>).threadForMember = async () => ({
    id: "c1",
  });
};

test("resolveAsMember flips an open conversation to RESOLVED as MEMBER_RESOLVED", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const svc = makeService(
    csatPrisma({ id: "c1", status: "ESCALATED", reopenCount: 0 }, writes),
  );
  patchThreadRead(svc);

  await svc.resolveAsMember("u1", "c1");

  const upd = writes.find((w) => w.table === "conversation") as {
    data: Record<string, unknown>;
  };
  assert.equal(upd.data.status, "RESOLVED");
  assert.equal(upd.data.resolution, "MEMBER_RESOLVED");
  assert.ok(upd.data.resolvedAt instanceof Date);
});

test("resolveAsMember is idempotent on RESOLVED and rejects CLOSED", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const svc = makeService(
    csatPrisma({ id: "c1", status: "RESOLVED", reopenCount: 0 }, writes),
  );
  patchThreadRead(svc);
  await svc.resolveAsMember("u1", "c1");
  assert.equal(writes.length, 0); // no second write

  const svc2 = makeService(
    csatPrisma({ id: "c1", status: "CLOSED", reopenCount: 0 }, []),
  );
  await assert.rejects(
    () => svc2.resolveAsMember("u1", "c1"),
    (e: unknown) => {
      assert.ok(e instanceof ConflictException);
      assert.equal(
        (e.getResponse() as { code?: string }).code,
        "HELPDESK_CLOSED",
      );
      return true;
    },
  );
});

test("rateAsMember requires a resolved conversation", async () => {
  const svc = makeService(
    csatPrisma({ id: "c1", status: "ESCALATED", satisfactionUp: null }, []),
  );
  await assert.rejects(
    () => svc.rateAsMember("u1", "c1", { up: true }),
    (e: unknown) => {
      assert.ok(e instanceof ConflictException);
      assert.equal(
        (e.getResponse() as { code?: string }).code,
        "HELPDESK_NOT_RESOLVED",
      );
      return true;
    },
  );
});

test("first rating writes the conversation and increments the day stat once", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const svc = makeService(
    csatPrisma(
      {
        id: "c1",
        status: "RESOLVED",
        category: "BILLING",
        satisfactionUp: null,
      },
      writes,
    ),
  );
  patchThreadRead(svc);

  await svc.rateAsMember("u1", "c1", { up: true });

  const conv = writes.find((w) => w.table === "conversation") as {
    data: Record<string, unknown>;
  };
  assert.equal(conv.data.satisfactionUp, true);
  assert.ok(conv.data.satisfactionAt instanceof Date);
  const stat = writes.find((w) => w.table === "dayStat") as {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  assert.equal((stat.create as { ratedUp: number }).ratedUp, 1);
  assert.deepEqual(stat.update, { ratedUp: { increment: 1 } });
});

test("repeat rating with the same value only updates the note — never the tally", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const svc = makeService(
    csatPrisma(
      {
        id: "c1",
        status: "RESOLVED",
        category: "BILLING",
        satisfactionUp: false,
        satisfactionAt: new Date(),
      },
      writes,
    ),
  );
  patchThreadRead(svc);

  await svc.rateAsMember("u1", "c1", { up: false, note: "  too slow  " });

  assert.equal(writes.filter((w) => w.table === "dayStat").length, 0);
  const conv = writes.find((w) => w.table === "conversation") as {
    data: Record<string, unknown>;
  };
  assert.equal(conv.data.satisfactionNote, "too slow");
  assert.equal("satisfactionUp" in conv.data, false);
});

test("a flipped rating moves the tally on the original rating day", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const svc = makeService(
    csatPrisma(
      {
        id: "c1",
        status: "RESOLVED",
        category: "OTHER",
        satisfactionUp: false,
        satisfactionAt: new Date("2026-08-01T10:00:00Z"),
      },
      writes,
      { ratedUp: 0, ratedDown: 3 },
    ),
  );
  patchThreadRead(svc);

  await svc.rateAsMember("u1", "c1", { up: true });

  const stat = writes.find((w) => w.table === "dayStat") as {
    where: { day_category: { day: Date } };
    update: Record<string, unknown>;
  };
  // Adjusted on the ORIGINAL day, not today.
  assert.equal(
    stat.where.day_category.day.toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
  assert.deepEqual(stat.update, {
    ratedUp: { increment: 1 },
    ratedDown: { set: 2 },
  });
});
