import type sanitizeHtml from 'sanitize-html';

// Allowlist of inline CSS properties (+ value patterns) permitted in sanitized
// rich-text (blog/pages/popups/canvas). sanitize-html strips any property NOT
// listed here, so injected CSS can't:
//   • load external resources (background:url(...) tracking beacons), or
//   • overlay the page (position:fixed/absolute clickjacking) — `position`,
//     `top/left/z-index`, and the `background` shorthand are intentionally absent.
// Only benign text/box formatting survives.
export const ALLOWED_STYLES: NonNullable<
  sanitizeHtml.IOptions['allowedStyles']
> = {
  '*': {
    color: [/^#(?:[0-9a-f]{3,8})$/i, /^rgba?\([^)]*\)$/i, /^hsla?\([^)]*\)$/i, /^[a-z]+$/i],
    'background-color': [/^#(?:[0-9a-f]{3,8})$/i, /^rgba?\([^)]*\)$/i, /^hsla?\([^)]*\)$/i, /^[a-z]+$/i],
    'text-align': [/^(?:left|right|center|justify)$/i],
    'text-decoration': [/^(?:none|underline|line-through|overline)$/i],
    'text-transform': [/^(?:none|uppercase|lowercase|capitalize)$/i],
    'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%|pt)$/i],
    'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
    'font-style': [/^(?:normal|italic|oblique)$/i],
    'font-family': [/^[\w\s",'-]+$/],
    'line-height': [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/i],
    'letter-spacing': [/^-?\d+(?:\.\d+)?(?:px|em|rem)$/i],
    margin: [/^[\d.\s]+(?:px|em|rem|%)?$/i],
    padding: [/^[\d.\s]+(?:px|em|rem|%)?$/i],
    width: [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i],
    height: [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/i],
    'border-radius': [/^[\d.\s]+(?:px|em|rem|%)?$/i],
  },
};
