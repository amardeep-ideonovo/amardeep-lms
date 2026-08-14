import test from "node:test";
import assert from "node:assert/strict";

import { createTokenStore } from "./token-store";

// Regression guards for the binding-epoch invariants (config.ts): a member
// must never carry a token from one academy into another — including
// rebinding to the SAME academy after "Switch academy" wiped its stored
// token. The harness models the keychain as a Map whose WRITES park until
// released, so a write can be deterministically overtaken by unbind's delete
// (the race observed during shared-app E2E testing).

function harness() {
  const stored = new Map<string, string>();
  let epoch = 1;
  const key = "lms.auth.token.academy-a";
  let reads = 0;
  const parkedWrites: Array<() => void> = [];

  const ts = createTokenStore({
    currentKey: () => key,
    currentEpoch: () => epoch,
    readItem: async (k) => {
      reads++;
      return stored.get(k) ?? null;
    },
    writeItem: (k, v) =>
      new Promise<void>((resolve) => {
        parkedWrites.push(() => {
          stored.set(k, v);
          resolve();
        });
      }),
    deleteItem: async (k) => {
      stored.delete(k);
    },
  });

  return {
    ts,
    stored,
    key,
    readCount: () => reads,
    /** Land every parked keychain write (models the native write resolving). */
    releaseWrites: () => {
      for (const w of parkedWrites.splice(0)) w();
    },
    /** Models unbindInstance(): epoch bump + stored-token delete. */
    unbind: () => {
      epoch++;
      stored.delete(key);
    },
    /** Models re-binding (applyBinding): epoch bump only. */
    rebind: () => {
      epoch++;
    },
  };
}

test("REGRESSION: sign-in write overtaken by Switch academy leaves no token at rest", async () => {
  const h = harness();

  // A sign-in's keychain write goes in flight…
  const signIn = h.ts.setToken("old-member-token");
  // …the member taps "Switch academy" while it is pending: unbindInstance
  // deletes the stored token and bumps the epoch…
  h.unbind();
  // …and only then does the parked write land, overtaking the delete.
  h.releaseWrites();
  await signIn;

  // The compensating delete must have undone the overtaking write.
  assert.equal(h.stored.size, 0, "no token may survive at rest past an unbind");

  // Rebinding to the SAME academy must find nothing — not the old member.
  h.rebind();
  assert.equal(await h.ts.getToken(), null);
});

test("stable epoch: write persists, cache serves it, resumption after plain rebind is legitimate", async () => {
  const h = harness();

  const p = h.ts.setToken("member-token");
  h.releaseWrites();
  await p;

  assert.equal(h.stored.get(h.key), "member-token");
  assert.equal(await h.ts.getToken(), "member-token");

  // A plain epoch bump WITHOUT unbind (e.g. rebinding after an app reinstall
  // that kept the keychain) re-reads the store and resumes the session — that
  // token was never wiped, so resumption is intended behavior.
  h.rebind();
  assert.equal(await h.ts.getToken(), "member-token");
});

test("getToken cache never outlives an unbind", async () => {
  const h = harness();
  const p = h.ts.setToken("member-token");
  h.releaseWrites();
  await p;
  assert.equal(await h.ts.getToken(), "member-token"); // cached

  h.unbind();
  // Same key, new epoch: the cache entry must not be served; the fresh store
  // read sees the deletion.
  assert.equal(await h.ts.getToken(), null);
});

test("concurrent getToken callers share one store read", async () => {
  const h = harness();
  const [a, b, c] = await Promise.all([
    h.ts.getToken(),
    h.ts.getToken(),
    h.ts.getToken(),
  ]);
  assert.deepEqual([a, b, c], [null, null, null]);
  assert.equal(h.readCount(), 1);
});

test("a rejected read evicts itself and the next read retries", async () => {
  const stored = new Map<string, string>();
  const epoch = 1;
  let failNext = true;
  const ts = createTokenStore({
    currentKey: () => "k",
    currentEpoch: () => epoch,
    readItem: async () => {
      if (failNext) {
        failNext = false;
        throw new Error("keychain unavailable");
      }
      return stored.get("k") ?? null;
    },
    writeItem: async (k, v) => {
      stored.set(k, v);
    },
    deleteItem: async (k) => {
      stored.delete(k);
    },
  });

  await assert.rejects(ts.getToken(), /keychain unavailable/);
  stored.set("k", "recovered");
  assert.equal(await ts.getToken(), "recovered");
});

test("clearToken racing an unbind stays safe and signed out", async () => {
  const h = harness();
  const p = h.ts.setToken("member-token");
  h.releaseWrites();
  await p;

  const clearing = h.ts.clearToken();
  h.unbind();
  await clearing;

  assert.equal(h.stored.size, 0);
  h.rebind();
  assert.equal(await h.ts.getToken(), null);
});
