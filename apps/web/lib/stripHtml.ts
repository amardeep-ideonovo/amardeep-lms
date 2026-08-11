// Strip rich-text HTML to a plain-text single line — for the SEO <meta
// description>, which can't contain markup. The stored value is already
// sanitized HTML (server-side), so this only needs to remove tags + decode the
// handful of entities the sanitizer emits.
export function stripHtml(html: string): string {
  return html
    .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/blockquote)\s*>/gi, " ") // block ends -> space
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}
