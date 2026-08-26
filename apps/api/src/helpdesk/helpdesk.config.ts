// Attachment limits for the member helpdesk. The byte cap applies to the
// RAW upload (pre-re-encode); sharp then downscales to <=1920px WebP/JPEG.
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB per image
