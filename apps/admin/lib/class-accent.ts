// Class-accent slot selection lives in @lms/types now — the single source
// across web/admin/mobile (docs/coding-standards.md D2; this file was one of
// three verbatim copies). This shim keeps existing admin imports stable.
//
// NOTE the canonical signature is classAccentIndex(name, categories, fallback)
// — admin call sites that only have a class name pass [] for categories.
export { ACCENT_SLOT_COUNT, classAccentIndex } from "@lms/types";
