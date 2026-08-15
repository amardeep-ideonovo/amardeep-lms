// Shared cross-app constants (docs/coding-standards.md, decision D2). Values
// that used to be re-typed in more than one file live here.
//
// Consumption note — two import styles, both deliberate:
//   • Bundled clients (web/admin/control-plane/mobile) import "@lms/types";
//     their bundlers transpile the raw TS via transpilePackages / Metro.
//   • apps/api imports this file by RELATIVE path
//     (e.g. ../../../../packages/types/constants). The API's imports from
//     "@lms/types" are type-only and ERASED at compile time — a bare
//     "@lms/types" VALUE import would emit require("@lms/types"), which
//     resolves to raw index.ts at runtime and crashes the compiled dist.
//     Relative imports compile into the API's own dist tree instead.

// Password minimum lengths — TIERED ON PURPOSE (owner decision, 2026-08-14):
// members sign up with 10+; instance admins are operator-created at 8+;
// the instance-admin recovery reset demands 12+. Every DTO and client-side
// pre-check imports these instead of re-hardcoding the number.
export const PASSWORD_MIN = {
  member: 10,
  admin: 8,
  instanceAdminReset: 12,
} as const;

/** Debounce for search-as-you-type inputs. */
export const SEARCH_DEBOUNCE_MS = 250;

// Upload caps shared by more than one route (route-specific caps like the
// 25 MB lesson-note limit stay next to their route config).
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AVATAR_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

// Safe web-image subset -> canonical extension. SVG is deliberately excluded
// (it can carry inline script and these files are served from our origin).
// The media library (adds video/audio/svg), lesson notes (adds documents) and
// avatars (no AVIF, adds the image/jpg alias) keep their own maps BY DESIGN —
// this is only the subset that was copy-pasted identically.
export const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};
