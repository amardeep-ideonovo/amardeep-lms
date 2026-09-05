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
    // Branded 404 (not-found.tsx) + error-boundary (error.tsx) copy, shared by
    // web + admin so a fresh academy never shows a raw framework page.
    notFoundTitle: "Page not found",
    notFoundBody:
      "The page you’re looking for doesn’t exist or may have moved.",
    errorTitle: "Something went wrong",
    errorBody:
      "An unexpected error occurred on our end. You can try again, or head back home.",
    backHome: "Back to home",
    // Shown above a support-correlatable id — never the raw error message/stack.
    referenceId: "Reference",
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
  classes: {
    /** Section heading over the tiles the member does NOT own. "More" is
        comparative — it only reads right once they own something to have more
        THAN. With an empty membership the whole page is the catalogue, so the
        heading drops it. Shared by the web dashboard, /classes and the mobile
        dashboard; keeping the branch here is what stops the three drifting. */
    exploreHeading: (ownsAny: boolean) =>
      ownsAny ? "Explore More Classes" : "Explore Classes",
    /** Sentence-case sibling. Mobile "My Classes" titles its sections in
        sentence case ("Also enrolled", "No classes yet"), so it takes this one
        rather than the title-case form the dashboards use. The casing split is
        pre-existing; both forms drop "More" on the same condition. */
    exploreHeadingSentence: (ownsAny: boolean) =>
      ownsAny ? "Explore more classes" : "Explore classes",
  },
  helpdesk: {
    open: "Get help",
    title: "Support",
    close: "Close",
    back: "Back",
    greetingFallback:
      "Hi 👋 — look up your classes, lessons and payments below, or message the team about anything else.",
    menuClasses: "My classes",
    menuCourses: "My courses & lessons",
    menuPayments: "Payments",
    menuLive: "Live session",
    menuCertificates: "My certificates",
    menuAccount: "Account & sign-in",
    menuSomethingElse: "Something else",
    myRequests: "My requests",
    viewAll: "View all",
    openItem: "Open",
    paymentHistory: "Payment history",
    noRequests: "You haven’t contacted support yet.",
    // The single permanent human affordance. Worded as a CHANNEL, not as a
    // verdict on the bot — the old "No — talk to a person" fused a feedback
    // answer with a routing action, so a member with a follow-up question had
    // no correct button to press.
    messageTeam: "Message the team",
    stillStuck: "Still need help?",
    // Chip that returns to the topic menu after an answer.
    somethingElseChip: "Something else",
    /** Home sections — self-serve lookups are kept apart from the human
     *  channel, so a visit that touches three topics never becomes one scroll. */
    findAnswer: "Find an answer",
    /** Eyebrow on an answer card — marks it as LIVE personal data, which is
     *  what visually separates an answer from the menu that led to it. */
    fromYourAccount: "From your account",
    /** Eyebrow on a help-article card — academy content, not account data. */
    helpArticleEyebrow: "Help article",
    yourRequests: "Your requests",
    relatedHeading: "Related",
    /** One box: a recognised question opens that answer, anything else becomes
     *  a message to the team pre-filled with what was typed. */
    composerPlaceholder: "Ask a question, or message the team…",
    sendToTeam: "Send to the team",
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
    /** Member closes their own request — reversible (a reply reopens it). */
    markResolved: "Mark as resolved",
    // Once-per-resolution CSAT. Deliberately the ONLY feedback ask in the whole
    // helpdesk (the per-answer nags were removed on industry evidence): one
    // quiet question after a request is resolved, never a modal, never twice.
    csatPrompt: "Did this sort it out?",
    csatYes: "👍 Yes",
    csatNo: "👎 No",
    csatThanks: "Thanks for the feedback.",
    csatNotePlaceholder: "What could we have done better? (optional)",
    csatSendNote: "Send",
    statusWaitingAdmin: "Waiting on member",
    adminSectionTitle: "Member support",
    tooManyOpen: "You already have open requests — we’ll reply to those first.",
    disabled: "Support chat is unavailable right now.",
    // Conversational read-only summaries (member's own account data, shown in
    // the chat instead of navigating to a section). Shared by web + mobile.
    summaryClassesCount: (n: number) =>
      `You have ${n} purchased ${n === 1 ? "class" : "classes"}:`,
    summaryNoClasses: "You haven’t purchased any classes yet.",
    summaryCourseProgress: (done: number, total: number) =>
      `${done}/${total} lessons complete`,
    /** Spoken value of a progress bar (screen readers only, web + mobile). */
    progressSpoken: (done: number, total: number) =>
      `${done} of ${total} complete`,
    summaryNoCourses: "You don’t have any courses in progress yet.",
    summaryLastPayment: (amount: string, item: string, date: string) =>
      `Your last payment was ${amount} for ${item} on ${date}.`,
    summaryNextBilling: (date: string) => `Next billing: ${date}.`,
    summaryNoPayments: "No payments on file yet.",
    membershipActive: "Your membership is active.",
    membershipItem: "your membership",
    summaryCertsCount: (n: number) =>
      `You’ve earned ${n} ${n === 1 ? "certificate" : "certificates"}:`,
    summaryNoCerts:
      "No certificates yet — they’re awarded when you complete a class.",
    /** Pointer under the account card — info-only surfaces never navigate. */
    accountManageHint: "Change your details or password in account settings.",
    viewCertificates: "View certificates",
    // Contextual entry points — a quiet question near the moment of need,
    // paired with the standing "Get help" label as the action.
    entryPayments: "Questions about a payment?",
    entryCertificates: "Missing a certificate?",
  },
} as const;
