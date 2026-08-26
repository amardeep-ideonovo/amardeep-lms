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
  helpdesk: {
    open: "Get help",
    title: "Support",
    close: "Close",
    back: "Back",
    greetingFallback:
      "Hi 👋 — I can help with your classes, courses, lessons and payments. Pick a topic, or tell me what’s going on.",
    menuClasses: "My classes",
    menuCourses: "My courses & lessons",
    menuPayments: "Payments",
    menuLive: "Live session",
    menuSomethingElse: "Something else",
    myRequests: "My requests",
    viewAll: "View all",
    openItem: "Open",
    paymentHistory: "Payment history",
    noRequests: "You haven’t contacted support yet.",
    didThisHelp: "Did this answer your question?",
    yesThanks: "Yes, thanks",
    talkToHuman: "No — talk to a person",
    articlesHeading: "Help articles",
    accountHeading: "Manage your account",
    manageAccount: "Go to account settings",
    describeIssue: "Tell us what’s going on and we’ll help.",
    issuePlaceholder: "Describe your issue…",
    send: "Send",
    sending: "Sending…",
    reply: "Reply",
    replyPlaceholder: "Write a reply…",
    attachImage: "Attach image",
    sent: "Your request was sent — the team will get back to you.",
    signInPrompt: "Please sign in to contact support.",
    signIn: "Sign in",
    pastDueLocked: (name: string) =>
      `${name} is locked because your payment is past due.`,
    fixPayment: "Fix payment method",
    manageBilling: "Manage billing",
    noLiveSessions: "You have no live sessions scheduled right now.",
    statusOpen: "Open",
    statusWaiting: "Waiting on you",
    statusResolved: "Resolved",
    statusClosed: "Closed",
    statusWaitingAdmin: "Waiting on member",
    adminSectionTitle: "Member support",
    tooManyOpen: "You already have open requests — we’ll reply to those first.",
    disabled: "Support chat is unavailable right now.",
  },
} as const;
