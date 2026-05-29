// Path prefix the admin app is served under in production (e.g. "/admin"),
// mirroring `basePath` in next.config.js. Next automatically prepends basePath
// to <Link> and next/navigation router calls — but NOT to raw `window.location`
// or `window.open`, so use withBase(...) for those. Empty in local dev (the
// admin runs at the root of its dev port).
export const BASE_PATH = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "";

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
