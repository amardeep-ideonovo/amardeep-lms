import sanitizeHtml from "sanitize-html";
import { ALLOWED_STYLES } from "./sanitize-styles";

// Canonical rich-text sanitizer options. Kept identical to the blog/pages/
// popups/canvas allow-list (they each still hold a copy today — a follow-up can
// point them here). Admin-authored rich text is rendered on the PUBLIC member
// site, so it MUST be sanitized server-side to prevent stored XSS.
export const RICH_TEXT_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "blockquote",
    "a",
    "ul",
    "ol",
    "li",
    "b",
    "i",
    "strong",
    "em",
    "s",
    "strike",
    "code",
    "pre",
    "hr",
    "br",
    "span",
    "img",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["style"],
  },
  allowedStyles: ALLOWED_STYLES,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      "a",
      { rel: "noopener noreferrer", target: "_blank" },
      true,
    ),
  },
};

/** Sanitize a rich-text HTML string against RICH_TEXT_OPTS. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, RICH_TEXT_OPTS);
}

// Block-level tags a rich-text value would carry. Used to tell a value that is
// already HTML (from the editor) apart from a legacy plain-text value.
const HTML_MARKER =
  /<(?:p|h[1-6]|ul|ol|li|blockquote|div|br|img|table|pre|a|strong|em|b|i|span)\b|<\/(?:p|h[1-6]|ul|ol|li|blockquote|div|table|pre|a|span)>/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Turn legacy plain text into safe paragraph HTML: escape entities, split on
// blank lines into <p> blocks, single newlines to <br>. NOT markdown — these
// fields were authored as literal plain text, so a markdown pass would mangle
// stray *, #, _, backticks in ordinary prose.
function plainToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/**
 * Normalize a stored description/content value to safe rich-text HTML for
 * serving to clients. Handles the mixed reality during and after rollout:
 *   - null / empty            -> null
 *   - already HTML (editor)   -> sanitized as-is
 *   - legacy plain text       -> escaped + paragraph-wrapped, then sanitized
 * This makes the render migration-free: no per-instance backfill, and legacy
 * plain text never renders as a collapsed wall of text or broken `&`/`<`.
 */
export function toRichHtml(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const html = HTML_MARKER.test(trimmed) ? trimmed : plainToHtml(trimmed);
  const clean = sanitizeRichText(html);
  return clean.trim() ? clean : null;
}

/**
 * Normalize a value received from the admin editor for STORAGE. Same as
 * toRichHtml but also collapses TipTap's empty-editor output (`<p></p>` and
 * whitespace-only paragraphs) to null, so "cleared" descriptions store null
 * rather than an empty paragraph.
 */
export function sanitizeRichTextForStore(
  value: string | null | undefined,
): string | null {
  const normalized = toRichHtml(value);
  if (normalized == null) return null;
  // Strip tags to check for any real text/media content.
  const textOnly = normalized
    .replace(/<(img|hr)\b[^>]*>/gi, "x") // media counts as content
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return textOnly ? normalized : null;
}
