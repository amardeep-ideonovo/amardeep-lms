import type { HelpdeskCategory } from "@lms/types";

/**
 * Topics the MOBILE helpdesk can answer inline from the member's own account.
 *
 * Lives in its own module (rather than inside HelpdeskScreen) so the router
 * spec can import the real value instead of re-declaring a copy that silently
 * goes stale when this list changes. Importing the screen would drag React
 * Native into a plain node:test run.
 *
 * Web answers one more topic (LIVE_SESSION) — see the widget's own list.
 */
export const ANSWERABLE: HelpdeskCategory[] = [
  "ACCESS",
  "TECHNICAL",
  "BILLING",
];
