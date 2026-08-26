import type { HelpdeskCategory, HelpdeskStatus } from "@lms/types";
import { STR } from "@lms/types";

// Human-readable topic names for the by-category stats and the queue's category
// column — the raw enum values (ACCESS, TECHNICAL, …) aren't member-facing
// language. Keyed on HelpdeskCategory so a new enum member fails tsc here.
export const CATEGORY_LABEL: Record<HelpdeskCategory, string> = {
  BILLING: "Payments",
  ACCESS: "Classes & access",
  TECHNICAL: "Courses & lessons",
  CERTIFICATE: "Certificates",
  LIVE_SESSION: "Live sessions",
  ACCOUNT: "Account",
  OTHER: "Other",
};

// Single source for the queue/thread status vocabulary (docs/coding-standards.md
// D1) — was duplicated across the list and thread pages.
export const STATUS_LABEL: Record<HelpdeskStatus, string> = {
  ESCALATED: STR.helpdesk.statusOpen,
  WAITING_ON_MEMBER: STR.helpdesk.statusWaitingAdmin,
  RESOLVED: STR.helpdesk.statusResolved,
  CLOSED: STR.helpdesk.statusClosed,
};

export const STATUS_BADGE: Record<HelpdeskStatus, string> = {
  ESCALATED: "badge badge--warn",
  WAITING_ON_MEMBER: "badge badge--info",
  RESOLVED: "badge badge--ok",
  CLOSED: "badge badge--neutral",
};

export const STATUS_TABS: { key: HelpdeskStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ESCALATED", label: STR.helpdesk.statusOpen },
  { key: "WAITING_ON_MEMBER", label: STR.helpdesk.statusWaitingAdmin },
  { key: "RESOLVED", label: STR.helpdesk.statusResolved },
  { key: "CLOSED", label: STR.helpdesk.statusClosed },
];

export const fmtHelpdeskDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
