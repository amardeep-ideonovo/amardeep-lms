// Machine-readable API error codes (docs/coding-standards.md D6). The API
// throws `new SomeHttpException({ code, message })`; its HttpExceptionFilter
// guarantees every error body carries a `code` ("UNSPECIFIED" when a legacy
// string-only throw hasn't been converted yet), and the clients' shared
// request cores surface it as `ApiError.code` — so clients branch on codes,
// not on parsing English prose.
//
// Keep this list SMALL and semantic: a code earns its place when a client
// genuinely branches on it (different copy, different recovery), not for
// every distinct sentence the API can say. Codes are derived from the real
// auth/live throw sites first (D6's rollout order); billing and the rest
// convert opportunistically — an unconverted throw is still well-formed, it
// just carries UNSPECIFIED.

export const ERROR_CODES = [
  "UNSPECIFIED",
  // auth
  "INVALID_CREDENTIALS",
  "INVALID_INVITE_CODE",
  "EMAIL_EXISTS",
  "USERNAME_TAKEN",
  "CURRENT_PASSWORD_INCORRECT",
  "PASSWORD_UNCHANGED",
  "RESET_LINK_INVALID",
  // admin site-preview (no-account member-site preview)
  "PREVIEW_LINK_INVALID",
  "PREVIEW_READ_ONLY",
  // live sessions (pre-existing precedent, now part of the family)
  "OUTSIDE_WINDOW",
  // member helpdesk
  "HELPDESK_DISABLED",
  "HELPDESK_TOO_MANY_OPEN",
  "HELPDESK_CLOSED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
