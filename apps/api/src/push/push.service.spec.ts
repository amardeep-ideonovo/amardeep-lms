import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { PushService } from "./push.service";

before(() => {
  // Silence the best-effort warn() logs the service emits on the sad paths.
  Logger.overrideLogger(false);
});

const GOOD = "ExponentPushToken[good]";
const BAD = "ExponentPushToken[bad]";

// Minimal prisma double: each test overrides only the delegates it exercises.
function makePrisma(over: Record<string, unknown> = {}): any {
  return {
    user: { findUnique: async () => ({ pushOptOut: false }) },
    pushLog: { create: async () => ({}) },
    deviceToken: {
      findMany: async () => [] as { expoPushToken: string }[],
      updateMany: async () => ({ count: 0 }),
      upsert: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
    appConfig: { findUnique: async () => ({ config: { title: "Acme" } }) },
    ...over,
  };
}

// Stub the Expo client so no network call is made; captures what was sent.
function stubExpo(svc: PushService, sendImpl: (chunk: any[]) => any[]): any[] {
  const sent: any[] = [];
  (svc as any).expo = {
    chunkPushNotifications: (msgs: any[]) => [msgs],
    sendPushNotificationsAsync: async (chunk: any[]) => {
      sent.push(...chunk);
      return sendImpl(chunk);
    },
  };
  return sent;
}

test("dispatch is a no-op when the member opted out of push", async () => {
  let created = false;
  const prisma = makePrisma({
    user: { findUnique: async () => ({ pushOptOut: true }) },
    pushLog: {
      create: async () => {
        created = true;
        return {};
      },
    },
  });
  const svc = new PushService(prisma);
  const sent = stubExpo(svc, () => []);
  await svc.dispatch({
    userId: "u1",
    category: "helpdesk-reply",
    body: "hi",
    href: "help/1",
    dedupeKey: "k1",
  });
  assert.equal(
    created,
    false,
    "opt-out must short-circuit before the log write",
  );
  assert.equal(sent.length, 0);
});

test("dispatch dedupes on the unique key (replay is a no-op)", async () => {
  const prisma = makePrisma({
    pushLog: {
      create: async () => {
        throw new Error("Unique constraint failed"); // simulates P2002
      },
    },
    deviceToken: {
      findMany: async () => {
        throw new Error("must not reach token lookup on a duplicate");
      },
    },
  });
  const svc = new PushService(prisma);
  const sent = stubExpo(svc, () => []);
  await svc.dispatch({
    userId: "u1",
    category: "helpdesk-reply",
    body: "hi",
    href: "help/1",
    dedupeKey: "dup",
  });
  assert.equal(sent.length, 0);
});

test("dispatch is a no-op when the member has no active tokens", async () => {
  const prisma = makePrisma({
    deviceToken: { ...makePrisma().deviceToken, findMany: async () => [] },
  });
  const svc = new PushService(prisma);
  const sent = stubExpo(svc, () => []);
  await svc.dispatch({
    userId: "u1",
    category: "subscription-active",
    body: "welcome",
    href: "account",
    dedupeKey: "k2",
  });
  assert.equal(sent.length, 0);
});

test("dispatch sends to active tokens and disables DeviceNotRegistered ones", async () => {
  const disabled: string[] = [];
  const prisma = makePrisma({
    deviceToken: {
      ...makePrisma().deviceToken,
      findMany: async () => [{ expoPushToken: GOOD }, { expoPushToken: BAD }],
      updateMany: async ({ where }: any) => {
        disabled.push(...where.expoPushToken.in);
        return { count: where.expoPushToken.in.length };
      },
    },
  });
  const svc = new PushService(prisma);
  const sent = stubExpo(svc, (chunk) =>
    chunk.map((m) =>
      m.to === BAD
        ? { status: "error", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: "t1" },
    ),
  );
  await svc.dispatch({
    userId: "u1",
    category: "helpdesk-reply",
    body: "New reply",
    href: "help/9",
    dedupeKey: "k3",
  });
  assert.equal(sent.length, 2, "both tokens receive a message");
  assert.deepEqual(disabled, [BAD], "only the dead token is disabled");
  const good = sent.find((m) => m.to === GOOD);
  assert.equal(good.data.href, "help/9");
  assert.equal(good.title, "Acme", "title defaults to the academy brand");
});

test("payment-failed body is stripped of any web URL (anti-steering)", async () => {
  const prisma = makePrisma({
    deviceToken: {
      ...makePrisma().deviceToken,
      findMany: async () => [{ expoPushToken: GOOD }],
    },
  });
  const svc = new PushService(prisma);
  const sent = stubExpo(svc, (chunk) => chunk.map(() => ({ status: "ok" })));
  await svc.dispatch({
    userId: "u1",
    category: "payment-failed",
    title: "Acme",
    body: "Payment failed. Update at https://acme.example.com/billing now.",
    href: "account/payments",
    dedupeKey: "k4",
  });
  assert.equal(sent.length, 1);
  assert.ok(
    !/https?:\/\//.test(sent[0].body),
    `URL must be stripped, got: ${sent[0].body}`,
  );
});

test("subscription-active also strips steering links, incl. bare domains", async () => {
  const prisma = makePrisma({
    deviceToken: {
      ...makePrisma().deviceToken,
      findMany: async () => [{ expoPushToken: GOOD }],
    },
  });
  const svc = new PushService(prisma);
  const sent = stubExpo(svc, (chunk) => chunk.map(() => ({ status: "ok" })));
  await svc.dispatch({
    userId: "u1",
    category: "subscription-active",
    title: "Acme",
    body: "Active. Manage at acme.example.com/account or https://x.io/y.",
    href: "account",
    dedupeKey: "k5",
  });
  assert.equal(sent.length, 1);
  assert.ok(
    !/acme\.example\.com|https?:\/\//.test(sent[0].body),
    `links must be stripped, got: ${sent[0].body}`,
  );
});

test("register ignores a non-Expo token", async () => {
  let upserted = false;
  const prisma = makePrisma({
    deviceToken: {
      ...makePrisma().deviceToken,
      upsert: async () => {
        upserted = true;
        return {};
      },
    },
  });
  const svc = new PushService(prisma);
  const res = await svc.register("u1", {
    token: "not-a-token",
    platform: "ios",
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(upserted, false);
});

test("register upserts a valid Expo token scoped to the member", async () => {
  let arg: any = null;
  const prisma = makePrisma({
    deviceToken: {
      ...makePrisma().deviceToken,
      upsert: async (a: any) => {
        arg = a;
        return {};
      },
    },
  });
  const svc = new PushService(prisma);
  await svc.register("u1", {
    token: GOOD,
    platform: "android",
    appVersion: "1.2.3",
  });
  assert.equal(arg.where.expoPushToken, GOOD);
  assert.equal(arg.create.userId, "u1");
  assert.equal(
    arg.update.disabled,
    false,
    "re-register re-enables a pruned token",
  );
  assert.equal(arg.update.appVersion, "1.2.3");
});

test("unregister deletes only the caller's own token", async () => {
  let where: any = null;
  const prisma = makePrisma({
    deviceToken: {
      ...makePrisma().deviceToken,
      deleteMany: async (a: any) => {
        where = a.where;
        return { count: 1 };
      },
    },
  });
  const svc = new PushService(prisma);
  await svc.unregister("u1", GOOD);
  assert.deepEqual(where, { expoPushToken: GOOD, userId: "u1" });
});
