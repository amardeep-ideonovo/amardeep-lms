import * as fs from 'fs';
import * as path from 'path';
import sanitizeHtml from 'sanitize-html';

// ---------- Local-disk storage (cloud impl swaps in later) ----------
// Served PUBLICLY at /media (see main.ts) so every asset has a stable,
// embeddable URL. On ephemeral hosts (Render), point MEDIA_DIR at a persistent
// disk — or switch the storage service to object storage.
export const MEDIA_ROOT =
  process.env.MEDIA_DIR ||
  path.resolve(process.cwd(), 'src', 'media-uploads');
export const MEDIA_ROUTE = '/media';

export function ensureMediaDir(): void {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

export const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB / file

// mime -> canonical extension (fallback when the filename has none).
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
};

// Broad allow-list by extension. Markup/script/executable types are blocked so
// a PUBLIC URL can never serve something that runs in a viewer's browser.
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg', // images
  '.mp4', '.webm', '.mov', '.m4v', '.ogv', // video
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', // audio
  '.pdf',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', // office
  '.txt', '.csv', '.md', '.rtf', // text
  '.zip', // archive
]);

// Resolve a safe, allowed extension from the uploaded filename (primary) or
// mime (fallback). Returns null for disallowed types (.html/.js/.exe/…).
export function resolveMediaExt(
  originalName: string,
  mime: string,
): string | null {
  let ext = path.extname(originalName || '').toLowerCase();
  if (!ext && mime) ext = MIME_TO_EXT[mime] ?? '';
  if (ext === '.jpeg') ext = '.jpg';
  return ALLOWED_EXT.has(ext) ? ext : null;
}

export type MediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'archive'
  | 'other';

export function mediaKind(mime: string, ext: string): MediaKind {
  if (mime.startsWith('image/') ||
    ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'].includes(ext))
    return 'image';
  if (mime.startsWith('video/') ||
    ['.mp4', '.webm', '.mov', '.m4v', '.ogv'].includes(ext))
    return 'video';
  if (mime.startsWith('audio/') ||
    ['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(ext))
    return 'audio';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (ext === '.zip') return 'archive';
  if (['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.md', '.rtf'].includes(ext))
    return 'document';
  return 'other';
}

export function isSvg(mime: string, ext: string): boolean {
  return mime === 'image/svg+xml' || ext === '.svg';
}

// Unique, timestamp-based stored filename (preserves the extension).
export function timestampName(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${rand}${ext}`;
}

// Best-effort image dimensions from an SVG (width/height attrs, else viewBox).
export function svgDimensions(svg: string): {
  width: number | null;
  height: number | null;
} {
  const w = svg.match(/\bwidth\s*=\s*["']?\s*([\d.]+)/i);
  const h = svg.match(/\bheight\s*=\s*["']?\s*([\d.]+)/i);
  if (w && h) return { width: Math.round(+w[1]), height: Math.round(+h[1]) };
  const vb = svg.match(
    /viewBox\s*=\s*["']\s*[\d.]+[ ,]+[\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i,
  );
  if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
  return { width: null, height: null };
}

// SVG can carry script (<script>, on* handlers, javascript: hrefs, foreignObject).
// Since gallery files are served publicly, sanitize on upload: keep presentational
// SVG, drop anything scriptable. Defense-in-depth alongside the nosniff header.
export function sanitizeSvg(svg: string): string {
  return sanitizeHtml(svg, {
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    allowedTags: [
      'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
      'polygon', 'text', 'tspan', 'textPath', 'defs', 'linearGradient',
      'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'image', 'use',
      'symbol', 'title', 'desc', 'marker', 'filter', 'feGaussianBlur',
      'feOffset', 'feBlend', 'feMerge', 'feMergeNode', 'feColorMatrix',
      'feComposite', 'feFlood', 'feMorphology', 'style',
    ],
    allowedAttributes: {
      '*': [
        'id', 'class', 'style', 'transform', 'x', 'y', 'width', 'height',
        'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink', 'version',
        'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
        'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
        'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'opacity',
        'd', 'points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
        'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset',
        'stop-color', 'stop-opacity', 'clip-path', 'clip-rule', 'mask', 'color',
        'display', 'visibility', 'font-family', 'font-size', 'font-weight',
        'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing',
        'href', 'xlink:href', 'patternUnits', 'patternTransform', 'markerWidth',
        'markerHeight', 'orient', 'refX', 'refY', 'stdDeviation', 'in', 'in2',
        'result', 'mode', 'type', 'values', 'filterUnits', 'maskUnits',
        'maskContentUnits',
      ],
    },
    allowedSchemes: ['http', 'https', 'data', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'xlink:href'],
    disallowedTagsMode: 'discard',
  });
}
