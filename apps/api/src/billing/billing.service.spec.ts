import { test } from "node:test";
import assert from "node:assert/strict";
import { BillingService } from "./billing.service";

// Tests for the subscription-chargeback revocation (INST-F1): a reversed
// subscription charge must resolve charge -> invoice -> subscription and cancel
// + reconcile it (revoking class access), and must be idempotent so a
// duplicate/retried event can't hit Stripe's "cannot cancel a canceled sub" 400.
//
// Plus the ownership gate: the cancel happens BEFORE reconcileSubscription's own
// user lookup, so a subscription whose customer has no local user must never be
// touched. That matters the moment two instances share one Stripe account —
// which the operator's shared demo test keys make routine — because every
// webhook endpoint on an account receives EVERY event on it.

// `owner` controls the local-user lookup: an object = this customer is ours,
// null = the subscription belongs to some other instance on the same account.
function make(
  stripe: any,
  owner: { id: string } | null = { id: "u_1" },
  // "acme" = billing on the operator's SHARED demo account (ownership gate on);
  // null = the academy's own account (gate off, legacy behaviour preserved).
  tenantScope: string | null = "acme",
): { svc: any; reconciled: string[]; lookedUp: string[] } {
  const lookedUp: string[] = [];
  const prisma: any = {
    user: {
      findUnique: async ({ where }: any) => {
        lookedUp.push(where.stripeCustomerId);
        return owner;
      },
    },
  };
  const svc: any = new BillingService(
    prisma,
    { ...stripe, tenantScope: async () => tenantScope },
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const reconciled: string[] = [];
  svc.reconcileSubscription = async (_sub: any, tag: string) => {
    reconciled.push(tag);
  };
  svc.notify = async () => {};
  return { svc, reconciled, lookedUp };
}

test("refund on a subscription charge cancels the sub + reconciles", async () => {
  let canceled: string | null = null;
  const { svc, reconciled } = make({
    retrieveInvoice: async () => ({ subscription: "sub_1" }),
    retrieveSubscription: async () => ({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
    }),
    cancelSubscription: async (id: string) => {
      canceled = id;
      return { id, status: "canceled" };
    },
  });
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: "in_1",
    payment_intent: null,
  });
  assert.equal(canceled, "sub_1");
  assert.ok(reconciled.some((t) => t.includes("sub_1")));
});

test("already-canceled sub is not re-canceled (idempotent) but still reconciled", async () => {
  let cancelCalls = 0;
  const { svc, reconciled } = make({
    retrieveInvoice: async () => ({ subscription: "sub_2" }),
    retrieveSubscription: async () => ({
      id: "sub_2",
      status: "canceled",
      customer: "cus_2",
    }),
    cancelSubscription: async () => {
      cancelCalls++;
      return {};
    },
  });
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: { id: "in_2", subscription: "sub_2" },
    payment_intent: null,
  });
  assert.equal(cancelCalls, 0, "must not cancel an already-canceled sub");
  assert.ok(reconciled.some((t) => t.includes("sub_2")));
});

test("non-subscription charge (no invoice) does nothing on the subscription side", async () => {
  let cancelCalls = 0;
  const { svc, reconciled } = make({
    cancelSubscription: async () => {
      cancelCalls++;
      return {};
    },
  });
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: null,
    payment_intent: null,
  });
  assert.equal(cancelCalls, 0);
  assert.equal(reconciled.length, 0);
});

test("dispute.created resolves the string charge id then revokes the subscription", async () => {
  let retrievedCharge: string | null = null;
  let canceled: string | null = null;
  const { svc } = make({
    retrieveCharge: async (id: string) => {
      retrievedCharge = id;
      return { invoice: "in_3", payment_intent: null };
    },
    retrieveInvoice: async () => ({ subscription: "sub_3" }),
    retrieveSubscription: async () => ({
      id: "sub_3",
      status: "active",
      customer: "cus_3",
    }),
    cancelSubscription: async (id: string) => {
      canceled = id;
      return { id, status: "canceled" };
    },
  });
  await svc.handleChargeDisputeCreated({
    charge: "ch_3",
    payment_intent: null,
  });
  assert.equal(retrievedCharge, "ch_3");
  assert.equal(canceled, "sub_3");
});

// --- Shared-account (demo test keys) cross-tenant guards ---

test("refund for a FOREIGN customer never cancels the subscription", async () => {
  let cancelCalls = 0;
  const { svc, reconciled, lookedUp } = make(
    {
      retrieveInvoice: async () => ({ subscription: "sub_other" }),
      retrieveSubscription: async () => ({
        id: "sub_other",
        status: "active",
        customer: "cus_other",
      }),
      cancelSubscription: async () => {
        cancelCalls++;
        return {};
      },
    },
    null, // no local user for this Stripe customer — another instance owns it
  );
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: "in_other",
    payment_intent: null,
  });
  assert.equal(lookedUp[0], "cus_other", "must check ownership by customer");
  assert.equal(
    cancelCalls,
    0,
    "must not cancel a subscription belonging to another tenant",
  );
  assert.equal(reconciled.length, 0, "and must not reconcile it either");
});

test("chargeback for a FOREIGN customer never cancels the subscription", async () => {
  let cancelCalls = 0;
  const { svc, reconciled } = make(
    {
      retrieveCharge: async () => ({ invoice: "in_x", payment_intent: null }),
      retrieveInvoice: async () => ({ subscription: "sub_x" }),
      retrieveSubscription: async () => ({
        id: "sub_x",
        status: "active",
        customer: "cus_x",
      }),
      cancelSubscription: async () => {
        cancelCalls++;
        return {};
      },
    },
    null,
  );
  await svc.handleChargeDisputeCreated({
    charge: "ch_x",
    payment_intent: null,
  });
  assert.equal(cancelCalls, 0);
  assert.equal(reconciled.length, 0);
});

test("on the academy's OWN account, a refund with no local user STILL cancels", async () => {
  // Regression guard for the ownership gate above: on a private account there is
  // no other tenant to protect, and a refund for a customer whose member row is
  // gone must keep cancelling at Stripe. Skipping it would leave a refunded
  // subscription billing on with nobody watching.
  let canceled: string | null = null;
  const { svc, reconciled } = make(
    {
      retrieveInvoice: async () => ({ subscription: "sub_own" }),
      retrieveSubscription: async () => ({
        id: "sub_own",
        status: "active",
        customer: "cus_own",
      }),
      cancelSubscription: async (id: string) => {
        canceled = id;
        return { id, status: "canceled" };
      },
    },
    null, // member row gone
    null, // own account — not the shared demo one
  );
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: "in_own",
    payment_intent: null,
  });
  assert.equal(canceled, "sub_own", "must still cancel on a private account");
  assert.ok(reconciled.some((t) => t.includes("sub_own")));
});
