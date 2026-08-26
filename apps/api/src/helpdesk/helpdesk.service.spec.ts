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
function makeService(prismaOverrides: Record<string, unknown>) {
  const notifications = { record: async () => undefined } as never;
  return new HelpdeskService(prismaOverrides as never, notifications);
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
