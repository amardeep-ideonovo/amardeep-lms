import type { HelpdeskStatus } from "@lms/types";
import { STR } from "@lms/types";

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
