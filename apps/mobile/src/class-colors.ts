// Class accents live in @lms/types now — the single source across
// web/admin/mobile (docs/coding-standards.md D2; this file was one of three
// verbatim copies). This shim keeps mobile's existing "./class-colors" imports
// stable; values and signatures are unchanged.
export {
  ACCENT_SLOT_COUNT,
  ACCENT_TINT_LOCATIONS,
  CLASS_ACCENTS,
  accentIndexMap,
  accentTint,
  classAccent,
  classAccentIndex,
} from "@lms/types";
export type { ClassAccent } from "@lms/types";
