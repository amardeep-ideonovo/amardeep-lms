// Pure token cache + persistence logic behind api.ts's getToken/setToken/
// clearToken. Extracted so the binding-epoch invariants are testable under
// node:test (api.ts imports react-native/expo modules and cannot be).
//
// The invariant this module enforces (see config.ts): a member must never
// carry a token from one academy into another — including rebinding to the
// SAME academy after "Switch academy" wiped its stored token. config.ts bumps
// the binding epoch on every bind/unbind; everything here is stamped with the
// key + epoch it was captured under and refuses to outlive them.

export type TokenStoreDeps = {
  /** Scoped storage key for the CURRENT binding (config.ts scopedKey). */
  currentKey: () => string;
  /** Current binding epoch (config.ts bindingEpoch). */
  currentEpoch: () => number;
  readItem: (key: string) => Promise<string | null>;
  writeItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

type TokenCache = { key: string; epoch: number; value: Promise<string | null> };

export function createTokenStore(deps: TokenStoreDeps) {
  // ---------- in-memory token cache ----------
  // Every authed request used to await a keychain read (the dashboard's four
  // parallel calls = four of them). The cache is stamped with BOTH the scoped
  // storage key and the binding epoch, and a hit requires both to still match:
  //
  //   * key   — the shared build namespaces the token per instance, so
  //             switching academies changes the key and misses the cache.
  //   * epoch — bumped on every bind/unbind. This is the part the key alone
  //             cannot cover: "Switch academy" DELETES the stored token while
  //             its key is still current, so rebinding to that same academy
  //             would otherwise hit a cache entry for a token that no longer
  //             exists and silently resurrect the previous member's session on
  //             a shared device.
  //
  // The entry holds the in-flight promise, so concurrent callers share one
  // read instead of racing separate ones. A rejected read evicts itself and is
  // never cached — the failure still propagates to the caller as before.
  let tokenCache: TokenCache | null = null;

  function getToken(): Promise<string | null> {
    const key = deps.currentKey();
    const epoch = deps.currentEpoch();
    if (tokenCache && tokenCache.key === key && tokenCache.epoch === epoch) {
      return tokenCache.value;
    }
    const entry: TokenCache = {
      key,
      epoch,
      value: deps.readItem(key).catch((e: unknown) => {
        if (tokenCache === entry) tokenCache = null;
        throw e;
      }),
    };
    tokenCache = entry;
    return entry.value;
  }

  // Writers keep the cache authoritative rather than dropping it: the value
  // they just persisted IS the current token for the key/epoch they wrote it
  // under. Both are captured BEFORE the awaited write — if the app rebinds
  // mid-write the value belongs to the previous binding and must not be filed
  // under the new one.
  //
  // The persistent write needs the same care as the cache: unbindInstance()
  // deletes the stored token and THEN the epoch-changed world moves on, but a
  // sign-in's keychain write that was already in flight can land AFTER that
  // delete and resurrect the old member's token at rest — rebinding to the
  // same academy would then auto-sign-in the previous member (a shared-device
  // leak). So when the epoch moved while our write was in flight, we undo the
  // write with a compensating delete. Deleting is always the safe direction:
  // once the epoch moved, a token captured under the old epoch is obsolete by
  // definition, and the worst case of an over-delete is a fresh sign-in being
  // bounced back to Login — signed-out, never the wrong member.
  async function writeToken(token: string | null): Promise<void> {
    const key = deps.currentKey();
    const epoch = deps.currentEpoch();
    if (token === null) {
      await deps.deleteItem(key);
    } else {
      await deps.writeItem(key, token);
    }
    if (deps.currentEpoch() === epoch) {
      tokenCache = { key, epoch, value: Promise.resolve(token) };
      return;
    }
    if (token !== null) {
      await deps.deleteItem(key);
    }
  }

  return {
    getToken,
    setToken: (token: string): Promise<void> => writeToken(token),
    clearToken: (): Promise<void> => writeToken(null),
  };
}
