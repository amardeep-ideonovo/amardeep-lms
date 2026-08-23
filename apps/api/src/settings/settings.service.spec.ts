import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// crypto.util reads SETTINGS_ENC_KEY at call time, but set it before the import
// graph loads anyway so this file never depends on that ordering detail.
process.env.SETTINGS_ENC_KEY = randomBytes(32).toString("base64");

import { SettingsService, SETTING_KEYS } from "./settings.service";

// The precedence rules for the operator's DEMO Stripe keys. These decide which
// Stripe account an instance charges on, so they are worth pinning exactly:
//  * a client's own key ALWAYS wins — a pushed demo key must never displace it;
//  * the secret and publishable keys must resolve as a SET from one account,
//    never mixed (a mixed pair points the browser at a different account than
//    the server charges on, and every payment fails);
//  * demo keys have NO env fallback, so they cannot be armed by a stray var.

// SettingsService now also syncs the "demo keys are active" admin notification;
// these stubs record what it would have emitted/withdrawn.
function notificationsStub(emitted: string[] = []) {
  return {
    svc: {
      record: async (i: any) => void emitted.push(`emit:${i.type}`),
    } as any,
    emitted,
  };
}

function makeService(rows = new Map<string, string>()) {
  const prisma: any = {
    setting: {
      findUnique: async ({ where }: any) =>
        rows.has(where.key)
          ? { key: where.key, value: rows.get(where.key) }
          : null,
      upsert: async ({ where, create }: any) => (
        rows.set(where.key, create.value),
        create
      ),
      deleteMany: async ({ where }: any) => (
        rows.delete(where.key),
        { count: 1 }
      ),
    },
  };
  const config: any = { get: (k: string) => process.env[k] };
  const emitted: string[] = [];
  prisma.adminNotification = {
    deleteMany: async () => (emitted.push("withdraw"), { count: 1 }),
  };
  // withStripeCredentialChange also resets provisioned ids on an account switch.
  prisma.price = { updateMany: async () => ({ count: 0 }) };
  prisma.level = { updateMany: async () => ({ count: 0 }) };
  prisma.user = { updateMany: async () => ({ count: 0 }) };
  prisma.subscriptionMirror = { deleteMany: async () => ({ count: 0 }) };
  prisma.$transaction = async (ops: Promise<unknown>[]) => Promise.all(ops);
  const svc = new SettingsService(
    prisma,
    config,
    notificationsStub(emitted).svc,
  );
  return { svc, rows, emitted };
}

const DEMO = {
  secretKey: "sk_test_shared",
  publishableKey: "pk_test_shared",
  webhookSecret: "whsec_shared",
  tenantTag: "acme",
};

test("demo keys alone arm checkout on the shared account", async () => {
  const { svc } = makeService();
  assert.equal(await svc.getEffectiveStripeKeys(), null);
  assert.equal(await svc.isDemoStripeActive(), false);

  await svc.setDemoStripe(DEMO);
  const keys = await svc.getEffectiveStripeKeys();
  assert.deepEqual(keys, {
    secretKey: "sk_test_shared",
    publishableKey: "pk_test_shared",
    webhookSecret: "whsec_shared",
    demo: true,
    tenantTag: "acme",
  });
  assert.equal(await svc.isDemoStripeActive(), true);
  assert.equal(await svc.hasDemoStripeKeys(), true);
});

test("a client's own key wins, and is never mixed with the demo pair", async () => {
  const { svc } = makeService();
  await svc.setDemoStripe(DEMO);
  await svc.setSecret(SETTING_KEYS.stripeSecretKey, "sk_live_client");
  await svc.setSecret(SETTING_KEYS.stripePublishableKey, "pk_live_client");

  const keys = await svc.getEffectiveStripeKeys();
  assert.equal(keys?.secretKey, "sk_live_client");
  assert.equal(keys?.publishableKey, "pk_live_client");
  assert.equal(keys?.demo, false);
  assert.equal(
    keys?.tenantTag,
    null,
    "no tenant scoping on the client's own account",
  );
  assert.equal(await svc.isDemoStripeActive(), false);
  // Still stored — dormant, and revocable by the control plane.
  assert.equal(await svc.hasDemoStripeKeys(), true);
});

test("a client's own secret key does NOT borrow the demo publishable key", async () => {
  const { svc } = makeService();
  await svc.setDemoStripe(DEMO);
  await svc.setSecret(SETTING_KEYS.stripeSecretKey, "sk_live_client");
  // No own publishable key saved yet.
  const keys = await svc.getEffectiveStripeKeys();
  assert.equal(keys?.secretKey, "sk_live_client");
  assert.equal(
    keys?.publishableKey,
    null,
    "mixing accounts would point the browser at a different account than the server",
  );
});

test("demo keys have no env fallback", async () => {
  const { svc } = makeService();
  process.env.STRIPE_SECRET_KEY = "sk_test_from_env";
  try {
    // The env fallback is for the instance's OWN key only...
    assert.equal(await svc.getStripeSecretKey(), "sk_test_from_env");
    // ...and never arms the demo path.
    assert.equal(await svc.getDemoStripeSecretKey(), null);
    assert.equal(await svc.hasDemoStripeKeys(), false);
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
  }
});

test("a re-push without a webhook secret clears the stale one", async () => {
  const { svc } = makeService();
  await svc.setDemoStripe(DEMO);
  assert.equal(await svc.getDemoStripeWebhookSecret(), "whsec_shared");

  await svc.setDemoStripe({ ...DEMO, webhookSecret: null });
  assert.equal(
    await svc.getDemoStripeWebhookSecret(),
    null,
    "setSecret treats blank as 'keep', which is wrong for a machine push",
  );
});

test("revoke removes every demo row and disarms checkout", async () => {
  const { svc, rows } = makeService();
  await svc.setDemoStripe(DEMO);
  await svc.clearDemoStripe();

  assert.equal(await svc.getEffectiveStripeKeys(), null);
  assert.equal(await svc.hasDemoStripeKeys(), false);
  for (const key of [
    SETTING_KEYS.demoStripeSecretKey,
    SETTING_KEYS.demoStripePublishableKey,
    SETTING_KEYS.demoStripeWebhookSecret,
    SETTING_KEYS.demoStripeTenantTag,
  ]) {
    assert.equal(rows.has(key), false, `${key} must be deleted, not blanked`);
  }
});

test("demo keys are stored encrypted, never as plaintext", async () => {
  const { svc, rows } = makeService();
  await svc.setDemoStripe(DEMO);
  const stored = rows.get(SETTING_KEYS.demoStripeSecretKey) ?? "";
  assert.ok(stored.length > 0);
  assert.ok(
    !stored.includes("sk_test_shared"),
    "the plaintext key must not appear in the Setting row",
  );
  assert.equal(stored.split(":").length, 3, "iv:authTag:ciphertext");
});

test("an unreadable OWN key fails closed — it never promotes the demo keys", async () => {
  // getSecret() reports a row it cannot decrypt as "not set" (SETTINGS_ENC_KEY
  // rotated, ciphertext corrupted). Without the fail-closed check that would
  // silently move a paying client's checkout onto the OPERATOR'S sandbox, where
  // it collects nothing. Payments must break loudly instead.
  const rows = new Map<string, string>();
  const { svc } = makeService(rows);
  await svc.setDemoStripe(DEMO);
  await svc.setSecret(SETTING_KEYS.stripeSecretKey, "sk_live_client");
  // Corrupt the client's own ciphertext.
  rows.set(SETTING_KEYS.stripeSecretKey, "not:valid:ciphertext");

  assert.equal(await svc.getStripeSecretKey(), null, "reads back as unset");
  assert.equal(
    await svc.getEffectiveStripeKeys(),
    null,
    "must NOT fall through to the operator's demo keys",
  );
  assert.equal(await svc.isDemoStripeActive(), false);
});

test("an academy that never had its own key still uses the demo keys", async () => {
  // The guard above keys off the presence of the ROW, so it must not affect an
  // academy that simply has no key of its own — the normal demo case.
  const { svc } = makeService();
  await svc.setDemoStripe(DEMO);
  assert.equal((await svc.getEffectiveStripeKeys())?.demo, true);
});

test("switching Stripe account drops the ids minted on the old one", async () => {
  // Stripe product/price ids are account-scoped. ensureStripePrice only mints a
  // Price when stripePriceId is null, so a stale id from the previous account is
  // permanent: every paid checkout afterwards dies on "No such price".
  const rows = new Map<string, string>();
  const cleared: string[] = [];
  const prisma: any = {
    setting: {
      findUnique: async ({ where }: any) =>
        rows.has(where.key)
          ? { key: where.key, value: rows.get(where.key) }
          : null,
      upsert: async ({ where, create }: any) => (
        rows.set(where.key, create.value),
        create
      ),
      deleteMany: async ({ where }: any) => (
        rows.delete(where.key),
        { count: 1 }
      ),
    },
    price: { updateMany: async () => (cleared.push("price"), { count: 1 }) },
    level: { updateMany: async () => (cleared.push("level"), { count: 1 }) },
    user: { updateMany: async () => (cleared.push("user"), { count: 1 }) },
    subscriptionMirror: {
      deleteMany: async () => (cleared.push("mirror"), { count: 1 }),
    },
    adminNotification: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const svc = new SettingsService(
    prisma,
    { get: () => undefined } as any,
    { record: async () => {} } as any,
  );

  // Arming for the first time is an account change: null -> demo.
  await svc.withStripeCredentialChange(() => svc.setDemoStripe(DEMO));
  assert.deepEqual(cleared.sort(), ["level", "mirror", "price", "user"]);

  // A no-op write is NOT an account change — it must not churn the ids.
  cleared.length = 0;
  await svc.withStripeCredentialChange(async () => {});
  assert.deepEqual(cleared, [], "same account must not reset anything");

  // The client adding their own key switches accounts again.
  await svc.withStripeCredentialChange(() =>
    svc.setSecret(SETTING_KEYS.stripeSecretKey, "sk_live_client"),
  );
  assert.deepEqual(cleared.sort(), ["level", "mirror", "price", "user"]);
});

// Fixture keys are ASSEMBLED rather than written as literals: a string shaped
// like a Stripe key trips GitHub's push protection, and a fake test fixture is
// not worth teaching anyone to click "allow this secret". The shape still has to
// be exact — isAccountChange reads the embedded account segment.
const key = (mode: "test" | "live", account: string, tail: string) =>
  ["sk", mode, `${account}${tail}`].join("_");
const ACCOUNT_A = "51AAAAAAAAAAAAAAA";
const ACCOUNT_B = "51BBBBBBBBBBBBBBB";

test("a SAME-account key rotation does not wipe provisioned ids", async () => {
  // Rotating a key inside one account changes nothing about the ids that account
  // holds. Wiping them would stop every live subscription reconciling (no local
  // Price matches, so grants are never renewed or revoked), orphan per-level
  // coupons, and mint duplicate Products on the next checkout.
  const same = SettingsService.isAccountChange(
    key("live", ACCOUNT_A, "oldTail"),
    key("live", ACCOUNT_A, "newTail"),
  );
  assert.equal(same, false, "same account, different key = NOT a switch");

  assert.equal(
    SettingsService.isAccountChange(
      key("test", ACCOUNT_A, "xyz"),
      key("test", ACCOUNT_B, "xyz"),
    ),
    true,
    "different account = a switch",
  );
  // Configured <-> unconfigured is always a switch.
  assert.equal(
    SettingsService.isAccountChange(null, key("test", ACCOUNT_A, "")),
    true,
  );
  assert.equal(
    SettingsService.isAccountChange(key("test", ACCOUNT_A, ""), null),
    true,
  );
  assert.equal(SettingsService.isAccountChange(null, null), false);
  // Legacy keys carry no account segment — assume a switch rather than miss one.
  assert.equal(
    SettingsService.isAccountChange(
      key("test", "oldstyle", "1"),
      key("test", "oldstyle", "2"),
    ),
    true,
  );
});

test("a keys-only push keeps the stored webhook secret; an explicit null clears it", async () => {
  // The control plane pushes keys ALONE first as a reachability probe. If that
  // probe stripped the signing secret, every re-push would knock a working
  // academy off its webhook for the duration.
  const { svc } = makeService();
  await svc.setDemoStripe(DEMO);
  assert.equal(await svc.getDemoStripeWebhookSecret(), "whsec_shared");

  await svc.setDemoStripe({
    secretKey: DEMO.secretKey,
    publishableKey: DEMO.publishableKey,
    tenantTag: DEMO.tenantTag,
  }); // webhookSecret omitted
  assert.equal(
    await svc.getDemoStripeWebhookSecret(),
    "whsec_shared",
    "an omitted webhook secret must be left alone",
  );

  await svc.setDemoStripe({ ...DEMO, webhookSecret: null });
  assert.equal(
    await svc.getDemoStripeWebhookSecret(),
    null,
    "an explicit null must clear it",
  );
});

test("an account switch also drops the stale Stripe customer ids", async () => {
  // ensureCustomer RETURNS an existing stripeCustomerId without calling Stripe,
  // so a member who bought during the demo would point at a customer in the old
  // account forever: their next checkout dies on "No such customer" and their
  // account page throws on every load.
  const touched: string[] = [];
  const prisma: any = {
    setting: {
      findUnique: async () => null,
      upsert: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
    price: { updateMany: async () => (touched.push("price"), {}) },
    level: { updateMany: async () => (touched.push("level"), {}) },
    user: { updateMany: async () => (touched.push("user"), {}) },
    subscriptionMirror: {
      deleteMany: async () => (touched.push("mirror"), {}),
    },
    adminNotification: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };
  const svc = new SettingsService(
    prisma,
    { get: () => undefined } as any,
    { record: async () => {} } as any,
  );
  await svc.clearStripeProvisionedIds();
  assert.deepEqual(touched.sort(), ["level", "mirror", "price", "user"]);
});

test("the demo-keys warning is emitted while active and WITHDRAWN when it stops", async () => {
  // The notification is a standing STATE, not an event. It must appear when the
  // academy is actually billing on our sandbox and disappear the moment it
  // isn't — a stale "no money reaches you" left in the bell after the client
  // added their own keys is worse than never warning them at all.
  const { svc, emitted } = makeService();

  // Nothing configured -> nothing to warn about.
  await svc.syncDemoKeyNotification();
  assert.deepEqual(emitted, ["withdraw"]);

  // Armed -> warn.
  emitted.length = 0;
  await svc.withStripeCredentialChange(() => svc.setDemoStripe(DEMO));
  assert.ok(
    emitted.includes("emit:PAYMENT_KEYS_DEMO"),
    "arming must raise the warning",
  );

  // Client adds their own key -> the demo keys go dormant, so withdraw it.
  emitted.length = 0;
  await svc.withStripeCredentialChange(() =>
    svc.setSecret(SETTING_KEYS.stripeSecretKey, "sk_live_client"),
  );
  assert.deepEqual(
    emitted,
    ["withdraw"],
    "their own keys make the warning wrong — it must be withdrawn",
  );

  // Operator revokes while the client has their own key: still nothing to warn.
  emitted.length = 0;
  await svc.withStripeCredentialChange(() => svc.clearDemoStripe());
  assert.deepEqual(emitted, ["withdraw"]);
});

test("a notification failure never breaks a credential save", async () => {
  const { svc } = makeService();
  (
    svc as unknown as { notifications: { record: () => Promise<void> } }
  ).notifications = {
    record: async () => {
      throw new Error("notification store is down");
    },
  };
  await svc.withStripeCredentialChange(() => svc.setDemoStripe(DEMO));
  assert.equal(
    (await svc.getEffectiveStripeKeys())?.secretKey,
    DEMO.secretKey,
    "the keys must still be saved",
  );
});
