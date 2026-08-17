import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { BillingService } from "./billing.service";

// Tests for the subscription-chargeback revocation (INST-F1): a reversed
// subscription charge must resolve charge -> invoice -> subscription and cancel
// + reconcile it (revoking class access), and must be idempotent so a
// duplicate/retried event can't hit Stripe's "cannot cancel a canceled sub" 400.

function make(stripe: any): { svc: any; reconciled: string[] } {
  const svc: any = new BillingService(
    {} as any,
    stripe,
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
  return { svc, reconciled };
}

test("refund on a subscription charge cancels the sub + reconciles", async () => {
  let canceled: string | null = null;
  const { svc, reconciled } = make({
    retrieveInvoice: async () => ({ subscription: "sub_1" }),
    retrieveSubscription: async () => ({ id: "sub_1", status: "active" }),
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
    retrieveSubscription: async () => ({ id: "sub_2", status: "canceled" }),
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
    retrieveSubscription: async () => ({ id: "sub_3", status: "active" }),
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

// ---- One-off course purchase (embedded one-time PaymentIntent) ----
// Money-safety on the inline confirm + the webhook backstop: NEVER grant a
// payment that isn't a SUCCEEDED course purchase owned by the caller, and let
// the webhook + inline confirm converge on the same idempotent grant.

function makeCourse(stripe: any): { svc: any; grants: any[] } {
  const svc: any = new BillingService(
    {} as any,
    stripe,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const grants: any[] = [];
  svc.grantCoursePurchase = async (input: any) => {
    grants.push(input);
  };
  return { svc, grants };
}

test("confirmCourseIntent rejects a PaymentIntent owned by another member (fail closed)", async () => {
  const { svc, grants } = makeCourse({
    retrievePaymentIntent: async () => ({
      id: "pi_1",
      status: "succeeded",
      metadata: { kind: "course", courseId: "C1", userId: "someone-else" },
      amount_received: 2500,
      currency: "usd",
    }),
  });
  await assert.rejects(
    () => svc.confirmCourseIntent("me", "pi_1"),
    ForbiddenException,
  );
  assert.equal(grants.length, 0, "must not grant a foreign payment");
});

test("confirmCourseIntent ignores a non-course PaymentIntent", async () => {
  const { svc, grants } = makeCourse({
    retrievePaymentIntent: async () => ({
      id: "pi_2",
      status: "succeeded",
      metadata: { userId: "me", levelId: "L1" }, // a subscription invoice PI
    }),
  });
  const res = await svc.confirmCourseIntent("me", "pi_2");
  assert.deepEqual(res, { granted: false });
  assert.equal(grants.length, 0);
});

test("confirmCourseIntent does not grant until the PaymentIntent has succeeded", async () => {
  const { svc, grants } = makeCourse({
    retrievePaymentIntent: async () => ({
      id: "pi_3",
      status: "requires_payment_method",
      metadata: { kind: "course", courseId: "C1", userId: "me" },
    }),
  });
  const res = await svc.confirmCourseIntent("me", "pi_3");
  assert.deepEqual(res, { granted: false });
  assert.equal(grants.length, 0);
});

test("confirmCourseIntent grants a succeeded course purchase owned by the caller", async () => {
  const { svc, grants } = makeCourse({
    retrievePaymentIntent: async () => ({
      id: "pi_4",
      status: "succeeded",
      metadata: { kind: "course", courseId: "C1", userId: "me" },
      amount_received: 2500,
      amount: 2500,
      currency: "usd",
    }),
  });
  const res = await svc.confirmCourseIntent("me", "pi_4");
  assert.deepEqual(res, { granted: true });
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0], {
    userId: "me",
    courseId: "C1",
    paymentIntentId: "pi_4",
    amount: 2500,
    currency: "usd",
  });
});

test("payment_intent.succeeded webhook grants a course purchase but ignores subscription PIs", async () => {
  const { svc, grants } = makeCourse({});
  // A subscription's first-invoice PaymentIntent carries no kind:"course".
  await svc.handleCoursePaymentIntentEvent({
    id: "pi_sub",
    status: "succeeded",
    metadata: { userId: "me", levelId: "L1" },
  });
  assert.equal(grants.length, 0, "subscription PI must be ignored");
  // A one-off course PaymentIntent is granted (the webhook backstop).
  await svc.handleCoursePaymentIntentEvent({
    id: "pi_course",
    status: "succeeded",
    metadata: { kind: "course", courseId: "C1", userId: "me" },
    amount_received: 2500,
    currency: "usd",
  });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].paymentIntentId, "pi_course");
});

// createCourseIntent double-charge / recovery guards (money-review fixes): a
// locked, purchasable course ($25) with no active grant.
function makeIntentSvc(opts: { stripe: any }): { svc: any; grants: any[] } {
  const prisma: any = {
    user: {
      findUnique: async () => ({
        id: "me",
        email: "me@example.com",
        stripeCustomerId: "cus_1",
      }),
      update: async () => ({}),
    },
    course: {
      findUnique: async () => ({
        id: "C1",
        title: "Course One",
        priceActive: true,
        priceAmount: 2500,
        priceCurrency: "usd",
        courseLevels: [{ levelId: "L1" }],
      }),
    },
    userLevel: { findMany: async () => [] }, // no active levels → course is locked
    userCourse: { findFirst: async () => null }, // no active grant
  };
  const stripe: any = { ensureCustomer: async () => "cus_1", ...opts.stripe };
  const svc: any = new BillingService(
    prisma,
    stripe,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const grants: any[] = [];
  svc.grantCoursePurchase = async (input: any) => {
    grants.push(input);
  };
  return { svc, grants };
}

test("createCourseIntent recovers a paid-but-ungranted purchase instead of charging again", async () => {
  let minted = false;
  const { svc, grants } = makeIntentSvc({
    stripe: {
      listCoursePaymentIntents: async () => [
        {
          id: "pi_paid",
          status: "succeeded",
          amount: 2500,
          amount_received: 2500,
          currency: "usd",
          latest_charge: "ch_1",
          metadata: { kind: "course", courseId: "C1", userId: "me" },
        },
      ],
      retrieveCharge: async () => ({ refunded: false }),
      createCoursePaymentIntent: async () => {
        minted = true;
        return {
          paymentIntentId: "pi_new",
          clientSecret: "cs_new",
          status: "requires_payment_method",
        };
      },
    },
  });
  const res = await svc.createCourseIntent("me", "C1");
  assert.deepEqual(res, {
    status: "paid",
    clientSecret: null,
    paymentIntentId: "pi_paid",
  });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].paymentIntentId, "pi_paid");
  assert.equal(minted, false, "must not mint/charge again when already paid");
});

test("createCourseIntent does NOT re-grant a refunded PaymentIntent — it starts a fresh charge", async () => {
  let minted = false;
  const { svc, grants } = makeIntentSvc({
    stripe: {
      listCoursePaymentIntents: async () => [
        {
          id: "pi_refunded",
          status: "succeeded",
          amount: 2500,
          currency: "usd",
          latest_charge: "ch_r",
          metadata: { kind: "course", courseId: "C1", userId: "me" },
        },
      ],
      retrieveCharge: async () => ({ refunded: true }),
      createCoursePaymentIntent: async () => {
        minted = true;
        return {
          paymentIntentId: "pi_fresh",
          clientSecret: "cs_fresh",
          status: "requires_payment_method",
        };
      },
    },
  });
  const res = await svc.createCourseIntent("me", "C1");
  assert.equal(
    grants.length,
    0,
    "a refunded purchase must not be re-granted for free",
  );
  assert.equal(minted, true);
  assert.deepEqual(res, {
    status: "requires_payment",
    clientSecret: "cs_fresh",
    paymentIntentId: "pi_fresh",
  });
});

test("createCourseIntent reuses an open PaymentIntent at the current price (retrieving its client secret)", async () => {
  let minted = false;
  let retrievedId: string | null = null;
  const { svc } = makeIntentSvc({
    stripe: {
      listCoursePaymentIntents: async () => [
        {
          id: "pi_open",
          status: "requires_payment_method",
          amount: 2500,
          currency: "usd",
          metadata: { kind: "course", courseId: "C1", userId: "me" },
        },
      ],
      retrievePaymentIntent: async (id: string) => {
        retrievedId = id;
        return { id, client_secret: "cs_open" };
      },
      createCoursePaymentIntent: async () => {
        minted = true;
        return {
          paymentIntentId: "pi_new",
          clientSecret: "cs_new",
          status: "requires_payment_method",
        };
      },
    },
  });
  const res = await svc.createCourseIntent("me", "C1");
  assert.equal(
    retrievedId,
    "pi_open",
    "must retrieve to get a usable client_secret (list responses redact it)",
  );
  assert.deepEqual(res, {
    status: "requires_payment",
    clientSecret: "cs_open",
    paymentIntentId: "pi_open",
  });
  assert.equal(
    minted,
    false,
    "must not mint a second PaymentIntent (double-charge guard)",
  );
});

test("createCourseIntent skips a stale-priced open PaymentIntent and mints at the current price", async () => {
  let minted = false;
  const { svc } = makeIntentSvc({
    stripe: {
      listCoursePaymentIntents: async () => [
        {
          id: "pi_stale",
          status: "requires_payment_method",
          amount: 9999, // priced before an admin changed it to $25
          currency: "usd",
          metadata: { kind: "course", courseId: "C1", userId: "me" },
        },
      ],
      retrievePaymentIntent: async () => {
        throw new Error("must not reuse a stale-priced PaymentIntent");
      },
      createCoursePaymentIntent: async (input: any) => {
        minted = true;
        assert.equal(input.amount, 2500, "must charge the current price");
        return {
          paymentIntentId: "pi_new",
          clientSecret: "cs_new",
          status: "requires_payment_method",
        };
      },
    },
  });
  const res = await svc.createCourseIntent("me", "C1");
  assert.equal(minted, true);
  assert.deepEqual(res, {
    status: "requires_payment",
    clientSecret: "cs_new",
    paymentIntentId: "pi_new",
  });
});

test("grantCoursePurchase upserts one entitlement + notifies once when the webhook replays the same PaymentIntent", async () => {
  const upserts: any[] = [];
  const notifications: any[] = [];
  let prevRow: any = null; // no prior grant
  const prisma: any = {
    user: { findUnique: async () => ({ id: "me", email: "me@example.com" }) },
    course: { findUnique: async () => ({ id: "C1", title: "Course One" }) },
    userCourse: {
      findUnique: async () => prevRow,
      upsert: async (args: any) => {
        upserts.push(args);
        prevRow = {
          status: "ACTIVE",
          stripePaymentIntentId: args.create.stripePaymentIntentId,
        };
        return prevRow;
      },
    },
  };
  const svc: any = new BillingService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  svc.notify = async (n: any) => {
    notifications.push(n);
  };

  const input = {
    userId: "me",
    courseId: "C1",
    paymentIntentId: "pi_9",
    amount: 2500,
    currency: "usd",
  };
  // Inline confirm grants, then the webhook replays the SAME PaymentIntent.
  await svc.grantCoursePurchase(input);
  await svc.grantCoursePurchase(input);

  assert.equal(
    upserts.length,
    2,
    "both calls upsert on the (userId,courseId,STRIPE) unique tuple (one row)",
  );
  assert.equal(
    notifications.filter((n) => n.dedupeKey === "course:purchase:pi_9").length,
    1,
    "only the first grant is new; the replay must not re-notify",
  );
});
