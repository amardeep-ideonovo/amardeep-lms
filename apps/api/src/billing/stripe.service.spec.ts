import { test } from "node:test";
import assert from "node:assert/strict";
import { StripeService, TENANT_METADATA_KEY } from "./stripe.service";

// Shared-account safety. When an instance is armed with the operator's demo
// TEST keys it bills through a Stripe account MANY instances share, so Stripe's
// account-wide endpoints become cross-tenant: every object we create is stamped
// with this instance's tenant tag and every account-wide read is filtered back
// down to it. These tests pin both halves, plus the fail-closed behaviour that
// makes a missing tag show nothing rather than everything.

type Keys = {
  secretKey: string;
  publishableKey: string | null;
  webhookSecret: string | null;
  demo: boolean;
  tenantTag: string | null;
};

const OWN: Keys = {
  secretKey: "sk_live_own",
  publishableKey: "pk_live_own",
  webhookSecret: "whsec_own",
  demo: false,
  tenantTag: null,
};
const DEMO: Keys = {
  secretKey: "sk_test_shared",
  publishableKey: "pk_test_shared",
  webhookSecret: null,
  demo: true,
  tenantTag: "acme",
};

// Builds the service with a stubbed SettingsService and a fake Stripe client,
// so nothing here touches the network.
function make(keys: Keys | null, stripe: any = {}) {
  const settings: any = {
    getEffectiveStripeKeys: async () => keys,
  };
  const svc: any = new StripeService(settings);
  svc.getClient = async () => stripe;
  return svc;
}

test("own account: objects are created unstamped and reads are unfiltered", async () => {
  const created: any[] = [];
  const svc = make(OWN, {
    products: { create: async (p: any) => (created.push(p), { id: "prod_1" }) },
    promotionCodes: {
      list: () => ({
        data: [
          { id: "promo_mine", metadata: {} },
          { id: "promo_other", metadata: { [TENANT_METADATA_KEY]: "other" } },
        ],
      }),
    },
  });

  await svc.createProduct("Cooking");
  assert.deepEqual(created[0].metadata, {}, "no tenant stamp on own account");

  const codes = await svc.listPromotionCodes();
  assert.equal(codes.length, 2, "own account sees every code on it");
  assert.equal(await svc.tenantScope(), null);
});

test("shared account: created objects carry this tenant's tag", async () => {
  const created: Record<string, any> = {};
  const svc = make(DEMO, {
    products: {
      create: async (p: any) => ((created.product = p), { id: "prod_1" }),
    },
    prices: { create: async (p: any) => ((created.price = p), { id: "pr_1" }) },
    customers: {
      create: async (p: any) => ((created.customer = p), { id: "cus_1" }),
    },
    subscriptions: {
      create: async (p: any) => (
        (created.subscription = p),
        { id: "sub_1", status: "incomplete", latest_invoice: null }
      ),
    },
    coupons: {
      create: async (p: any) => ((created.coupon = p), { id: "co_1" }),
    },
    promotionCodes: {
      create: async (p: any) => ((created.promo = p), { id: "promo_1" }),
    },
  });

  await svc.createProduct("Cooking");
  await svc.createPrice({
    productId: "prod_1",
    interval: "month",
    amount: 1000,
    currency: "usd",
  });
  await svc.ensureCustomer({ email: "a@b.c", userId: "u_1" });
  await svc.createSubscriptionIntent({
    customerId: "cus_1",
    priceId: "pr_1",
    userId: "u_1",
    levelId: "lv_1",
  });
  await svc.createCoupon({ duration: "once", percentOff: 10 });
  await svc.createPromotionCode({
    couponId: "co_1",
    metadata: { levelId: "lv_1" },
  });

  for (const [name, params] of Object.entries(created)) {
    assert.equal(
      params.metadata?.[TENANT_METADATA_KEY],
      "acme",
      `${name} must carry the tenant tag`,
    );
  }
  // Stamping must not clobber the metadata the caller already relies on.
  assert.equal(created.customer.metadata.userId, "u_1");
  assert.equal(created.subscription.metadata.levelId, "lv_1");
  assert.equal(created.promo.metadata.levelId, "lv_1");
});

test("shared account: account-wide reads are filtered to this tenant", async () => {
  const svc = make(DEMO, {
    subscriptions: {
      list: () => ({
        autoPagingToArray: async () => [
          { id: "sub_mine", metadata: { [TENANT_METADATA_KEY]: "acme" } },
          { id: "sub_theirs", metadata: { [TENANT_METADATA_KEY]: "other" } },
          { id: "sub_untagged", metadata: {} },
        ],
      }),
    },
    promotionCodes: {
      list: () => ({
        data: [
          { id: "promo_mine", metadata: { [TENANT_METADATA_KEY]: "acme" } },
          { id: "promo_theirs", metadata: { [TENANT_METADATA_KEY]: "other" } },
        ],
        autoPagingToArray: async () => [
          { id: "promo_mine", metadata: { [TENANT_METADATA_KEY]: "acme" } },
          { id: "promo_theirs", metadata: { [TENANT_METADATA_KEY]: "other" } },
        ],
      }),
    },
  });

  const subs = await svc.listAllSubscriptions();
  assert.deepEqual(
    subs.map((s: any) => s.id),
    ["sub_mine"],
    "another tenant's subscriptions (and their customer PII) must not surface",
  );

  const codes = await svc.listPromotionCodes();
  assert.deepEqual(
    codes.map((c: any) => c.id),
    ["promo_mine"],
  );
});

test("shared account: a foreign promotion code is unusable and untouchable", async () => {
  let updated = 0;
  let deleted = 0;
  const foreign = {
    id: "promo_theirs",
    metadata: { [TENANT_METADATA_KEY]: "other" },
    coupon: "co_theirs",
  };
  const svc = make(DEMO, {
    promotionCodes: {
      list: () => ({
        data: [foreign],
        autoPagingToArray: async () => [foreign],
      }),
      retrieve: async () => foreign,
      update: async () => (updated++, foreign),
    },
    coupons: {
      retrieve: async () => ({
        id: "co_theirs",
        metadata: { [TENANT_METADATA_KEY]: "other" },
      }),
      del: async () => (deleted++, {}),
    },
  });

  // Checkout must not redeem another tenant's code.
  assert.equal(await svc.findPromotionCode("THEIRS20"), null);

  // Admin mutations must refuse it rather than acting on a raw Stripe id.
  await assert.rejects(() => svc.setPromotionCodeActive("promo_theirs", false));
  await assert.rejects(() => svc.updatePromotionCode("promo_theirs", {}));
  await assert.rejects(() => svc.retrievePromotionCode("promo_theirs"));
  await assert.rejects(() => svc.deleteCoupon("co_theirs"));
  assert.equal(updated, 0, "no write reached Stripe");
  assert.equal(deleted, 0, "no coupon was deleted");
});

test("shared account with NO tenant tag fails closed (shows nothing)", async () => {
  const svc = make(
    { ...DEMO, tenantTag: null },
    {
      subscriptions: {
        list: () => ({
          autoPagingToArray: async () => [
            { id: "sub_a", metadata: { [TENANT_METADATA_KEY]: "acme" } },
            { id: "sub_b", metadata: {} },
          ],
        }),
      },
    },
  );
  assert.equal(await svc.tenantScope(), "");
  assert.deepEqual(
    await svc.listAllSubscriptions(),
    [],
    "an untagged shared instance must leak nothing, not everything",
  );
});

test("publishable key and secret key always come from the same account", async () => {
  assert.equal(await make(OWN).getElementsPublishableKey(), "pk_live_own");
  assert.equal(await make(DEMO).getElementsPublishableKey(), "pk_test_shared");
  assert.equal(await make(null).getElementsPublishableKey(), null);
  assert.equal(await make(null).isConfigured(), false);
  assert.equal(await make(DEMO).isConfigured(), true);
});
