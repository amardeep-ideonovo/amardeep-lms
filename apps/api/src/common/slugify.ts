// The ONE server-side slugify, shared by every service that derives a URL slug
// (levels, courses, blog posts, pages, audiences). Lives in the API's own source
// tree — NOT imported from @lms/types — because @lms/types is a source-only
// package (main: index.ts) that the built API can't `require()` at runtime; a
// value import from it crashes the API on boot. This file compiles into the
// API's own dist, so it resolves fine.
//
// It is a VERBATIM copy of the client-side slugify in @lms/types/format.ts (used
// by the admin's live slug-autofill). `slugify.spec.ts` asserts the two stay
// byte-identical, so the admin's preview always matches what the server stores.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
