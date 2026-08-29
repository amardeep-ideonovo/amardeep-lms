// Contextual entry points into the helpdesk widget. Pages that sit near a
// moment of need ("Questions about a payment?") dispatch this event; the
// globally-mounted widget listens and opens straight on that topic's answer.
// A plain window event keeps the pages decoupled from the widget's state.
import type { HelpdeskCategory } from "@lms/types";

export const HELPDESK_OPEN_EVENT = "lms:helpdesk-open";

export function openHelpdeskAnswer(category: HelpdeskCategory) {
  window.dispatchEvent(
    new CustomEvent(HELPDESK_OPEN_EVENT, { detail: { category } }),
  );
}
