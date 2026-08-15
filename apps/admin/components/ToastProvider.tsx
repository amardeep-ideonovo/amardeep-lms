"use client";

// The toast implementation moved to @lms/ui (docs/coding-standards.md D5) —
// web and admin carried byte-identical copies of it. Re-exported so existing
// `@/components/ToastProvider` imports stay stable; styling still comes from
// this app's `.toast-*` classes in globals.css.
export { ToastProvider, useToast } from "@lms/ui";
