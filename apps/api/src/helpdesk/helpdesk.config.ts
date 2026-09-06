// Attachment limits for the member helpdesk. The byte cap applies to the
// RAW upload (pre-re-encode); sharp then downscales to <=1920px WebP/JPEG.
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB per image

// Per-MEMBER throttle windows for the helpdesk write surface, enforced by
// HelpdeskThrottlerGuard (keyed on the principal id, not IP — a shared
// office/NAT would otherwise share one bucket). These sit UNDER the generous
// global per-IP guard; their job is to stop a single authenticated member
// scripting the write endpoints (spamming tickets/replies, hammering the
// re-encode path, or inflating the anonymous day-stat counters). All are far
// above any human's natural pace on a support widget.
export const HELPDESK_WRITE_THROTTLE = { limit: 30, ttl: 60_000 };
export const HELPDESK_UPLOAD_THROTTLE = { limit: 15, ttl: 60_000 };
export const HELPDESK_STAT_THROTTLE = { limit: 60, ttl: 60_000 };
