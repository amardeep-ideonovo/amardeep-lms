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
  // Assume live until the real config says otherwise: an unreachable /billing/config
  // must never make a real checkout claim no money will move.
  testMode: false,
};

// Shown on the checkout when the active processor is in test/sandbox mode, so a
// prospect running a demo knows what to type. Stripe's universal test card —
// it is public documented test data, not a credential.
export const TEST_CARD = {
  number: "4242 4242 4242 4242",
  expiry: "any future date",
  cvc: "any 3 digits",
  postal: "any postal code",
} as const;

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
