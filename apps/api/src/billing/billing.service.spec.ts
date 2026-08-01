import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingService } from './billing.service';

// Tests for the subscription-chargeback revocation (INST-F1): a reversed
// subscription charge must resolve charge -> invoice -> subscription and cancel
// + reconcile it (revoking class access), and must be idempotent so a
// duplicate/retried event can't hit Stripe's "cannot cancel a canceled sub" 400.

/* eslint-disable @typescript-eslint/no-explicit-any */
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

test('refund on a subscription charge cancels the sub + reconciles', async () => {
  let canceled: string | null = null;
  const { svc, reconciled } = make({
    retrieveInvoice: async () => ({ subscription: 'sub_1' }),
    retrieveSubscription: async () => ({ id: 'sub_1', status: 'active' }),
    cancelSubscription: async (id: string) => {
      canceled = id;
      return { id, status: 'canceled' };
    },
  });
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: 'in_1',
    payment_intent: null,
  });
  assert.equal(canceled, 'sub_1');
  assert.ok(reconciled.some((t) => t.includes('sub_1')));
});

test('already-canceled sub is not re-canceled (idempotent) but still reconciled', async () => {
  let cancelCalls = 0;
  const { svc, reconciled } = make({
    retrieveInvoice: async () => ({ subscription: 'sub_2' }),
    retrieveSubscription: async () => ({ id: 'sub_2', status: 'canceled' }),
    cancelSubscription: async () => {
      cancelCalls++;
      return {};
    },
  });
  await svc.handleChargeRefunded({
    refunded: true,
    invoice: { id: 'in_2', subscription: 'sub_2' },
    payment_intent: null,
  });
  assert.equal(cancelCalls, 0, 'must not cancel an already-canceled sub');
  assert.ok(reconciled.some((t) => t.includes('sub_2')));
});

test('non-subscription charge (no invoice) does nothing on the subscription side', async () => {
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

test('dispute.created resolves the string charge id then revokes the subscription', async () => {
  let retrievedCharge: string | null = null;
  let canceled: string | null = null;
  const { svc } = make({
    retrieveCharge: async (id: string) => {
      retrievedCharge = id;
      return { invoice: 'in_3', payment_intent: null };
    },
    retrieveInvoice: async () => ({ subscription: 'sub_3' }),
    retrieveSubscription: async () => ({ id: 'sub_3', status: 'active' }),
    cancelSubscription: async (id: string) => {
      canceled = id;
      return { id, status: 'canceled' };
    },
  });
  await svc.handleChargeDisputeCreated({ charge: 'ch_3', payment_intent: null });
  assert.equal(retrievedCharge, 'ch_3');
  assert.equal(canceled, 'sub_3');
});
