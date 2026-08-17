import type { BillingConfigDTO } from "@lms/types";
import { PASSWORD_MIN } from "@lms/types";

// Shared constants for the checkout pages (level subscription + one-off course).

// When the public billing config can't be reached: Stripe mock mode, so the
// page stays usable in dev without keys.
export const FALLBACK_BILLING: BillingConfigDTO = {
  provider: "stripe",
  publishableKey: null,
  paypalClientId: null,
  paypalMode: null,
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checkout's inline signup posts to /auth/signup, whose DTO enforces the member
// tier — keep the client check in step with the server minimum.
export const MIN_PASSWORD = PASSWORD_MIN.member;

// Submit runs up to a few calls in sequence; name the one in flight so the
// slowest moment doesn't sit under a frozen "Processing…" label.
export const SUBMIT_STAGE_LABELS = {
  account: "Setting up your account…",
  paying: "Confirming payment…",
  activating: "Activating your access…",
} as const;
