// Shared user-facing strings (docs/coding-standards.md, decision D1).
//
// THE rule: any string used in two or more places, any destructive-confirm
// prompt, and any recurring error sentence lives here — components render
// STR.* instead of retyping copy. Genuinely one-off body copy may stay inline.
//
// This file is also where punctuation is decided: curly apostrophes (’),
// curly quotes (“ ”) and a real ellipsis (…). Pre-catalog code mixed straight
// and curly forms of the same sentence — when migrating a literal here, the
// catalog spelling wins. English-only for now; these keys are the extraction
// seam if i18n ever lands.
//
// Consumption: clients import { STR } from "@lms/types". The API imports this
// file by RELATIVE path (see constants.ts header for why).

export const STR = {
  common: {
    active: "Active",
    add: "Add",
    back: "Back",
    cancel: "Cancel",
    close: "Close",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    loading: "Loading…",
    /** aria-label / screen-reader form (no ellipsis). */
    loadingLabel: "Loading",
    no: "No",
    preview: "Preview",
    remove: "Remove",
    retry: "Try again",
    save: "Save",
    saved: "Saved",
    saving: "Saving…",
    search: "Search",
    yes: "Yes",
  },
  labels: {
    audience: "Audience",
    class: "Class",
    confirmNewPassword: "Confirm new password",
    confirmPassword: "Confirm password",
    date: "Date",
    description: "Description",
    email: "Email",
    firstName: "First name",
    label: "Label",
    lastName: "Last name",
    member: "Member",
    name: "Name",
    newPassword: "New password",
    password: "Password",
    plan: "Plan",
    status: "Status",
    template: "Template",
    title: "Title",
    type: "Type",
    username: "Username",
    version: "Version",
    visibility: "Visibility",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    imageUnreadable: "That image couldn’t be read. Try another file.",
    network: "Network error. Check your connection and try again.",
    passwordsDontMatch: "Passwords don’t match.",
    permissionDenied: "You don’t have permission to view this.",
  },
  validation: {
    passwordMin: (n: number) => `Password must be at least ${n} characters.`,
  },
  confirm: {
    /** Standard destructive prompt — always carries the warning tail. */
    deleteEntity: (kind: string, name?: string) =>
      `Delete ${kind}${name ? ` “${name}”` : ""}? This can’t be undone.`,
    /** Detach/unlink prompt — reversible, so no warning tail. */
    removeEntity: (thing: string) => `Remove ${thing}?`,
    cannotBeUndone: "This can’t be undone.",
  },
} as const;
