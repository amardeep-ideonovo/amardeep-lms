// Last-known member data, cached in localStorage so the next visit paints the
// real page INSTANTLY and revalidates in the background — the same pattern the
// nav avatar/greeting already uses (lib/api.ts me-cache), generalized. This is
// what removes the skeleton→content and blank→content pops on reload: the
// dashboard payload, the certificate list and each class page's ownership
// answer are all snapshotted after every successful fetch.
//
// Safety model (mirrors the me-cache):
//   • Every entry is stamped with a fingerprint of the member token that
//     produced it. A read under a different token (new login, preview toggle)
//     misses instead of leaking another identity's snapshot.
//   • clearMemberCaches() wipes every entry; lib/api.ts clearToken() calls it,
//     so logout / expired-session / preview-end leave nothing behind.
//   • All reads/writes are try/catch no-ops in private mode / on quota.
//
// This module deliberately imports NOTHING from lib/api.ts (callers pass the
// token) so api.ts can import clearMemberCaches without a cycle.

const PREFIX = "lms_cache:";
const VERSION = 1;

type Envelope<T> = { v: number; tok: string; t: number; data: T };

// Not a secret — just an identity discriminator for cache hits. The token
// itself already lives in localStorage next to these entries.
function fingerprint(token: string): string {
  return token.slice(-24);
}

export function readMemberCache<T>(
  key: string,
  token: string | null,
): { data: T; t: number } | null {
  if (typeof window === "undefined" || !token) return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (env.v !== VERSION || env.tok !== fingerprint(token)) return null;
    return { data: env.data, t: env.t };
  } catch {
    return null;
  }
}

export function writeMemberCache<T>(
  key: string,
  token: string | null,
  data: T,
): void {
  if (typeof window === "undefined" || !token) return;
  try {
    const env: Envelope<T> = {
      v: VERSION,
      tok: fingerprint(token),
      t: Date.now(),
      data,
    };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(env));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export function clearMemberCaches(): void {
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) window.localStorage.removeItem(k);
  } catch {
    /* non-fatal */
  }
}
