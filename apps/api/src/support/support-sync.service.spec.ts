import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { SupportSyncService } from './support-sync.service';

// Unit tests for the control-plane push-back entrypoint, requestSync(). Its one
// hard contract is coalescing: a push that lands WHILE a sync is in flight must
// trigger exactly ONE more pass when the current one drains — never a second
// concurrent pull (two overlapping reconciles would double-create mirror
// messages), and a burst of pushes must collapse into a single extra pass. We
// stub the two network halves (reconcileOutbound / pullReplies) and count passes.

before(() => Logger.overrideLogger(false));

// Build a service whose sync is enabled (baseUrl + token present) with inert
// collaborators — the reconcile internals are stubbed per test, so Prisma/email
// are never touched.
function makeService(enabled = true): SupportSyncService {
  if (enabled) {
    process.env.CONTROL_PLANE_URL = 'http://cp.local';
    process.env.INSTANCE_SERVICE_TOKEN = 'tok';
  } else {
    delete process.env.CONTROL_PLANE_URL;
    delete process.env.INSTANCE_SERVICE_TOKEN;
  }
  return new SupportSyncService({} as never, {} as never, {} as never);
}

// Replace the two private network halves with counting stubs. `hold` (if given)
// parks the FIRST pass open until it resolves, letting a test inject a mid-sync
// push before the pass completes.
function instrument(svc: SupportSyncService, hold?: Promise<void>) {
  const state = { passes: 0 };
  const s = svc as unknown as {
    reconcileOutbound: () => Promise<void>;
    pullReplies: () => Promise<void>;
  };
  s.reconcileOutbound = async () => {};
  s.pullReplies = async () => {
    state.passes++;
    if (state.passes === 1 && hold) await hold;
  };
  return state;
}

test('requestSync runs exactly one pass when idle', async () => {
  const svc = makeService();
  const state = instrument(svc);
  await svc.requestSync();
  assert.equal(state.passes, 1);
});

test('a push landing mid-sync coalesces into exactly one extra pass', async () => {
  const svc = makeService();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const state = instrument(svc, gate);

  const inFlight = svc.requestSync(); // pass 1 starts, parks on the gate
  await Promise.resolve(); //            let it reach the await
  await svc.requestSync(); //            push #1 arrives mid-flight → coalesced
  await svc.requestSync(); //            push #2 in the same window → still one resync
  assert.equal(state.passes, 1, 'no concurrent pull while pass 1 is in flight');

  release(); //                          pass 1 drains → resync flag triggers pass 2
  await inFlight;
  assert.equal(state.passes, 2, 'a burst of pushes collapses to a single extra pass');
});

test('requestSync is inert when sync is disabled (no service token)', async () => {
  const svc = makeService(false);
  const state = instrument(svc);
  await svc.requestSync();
  assert.equal(state.passes, 0);
});
