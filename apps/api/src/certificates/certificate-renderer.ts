import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { CertificateFieldKind, CertificateFieldLayout, CertificateFontId } from '@lms/types';
import { CERT_FONTS_DIR, CERT_FONT_FILES } from './certificates.config';

// Renders a certificate PDF from admin-uploaded artwork + the template's
// normalized field layout. The math here MUST mirror the admin editor preview
// (apps/admin/app/certificates/[id]): both sides position boxes by percentages
// of the artwork, size fonts as % of artwork WIDTH, and use line-height:1 /
// ascent-based baselines — same TTF bytes on both sides keeps drift sub-pixel.

export interface RenderCertificateInput {
  artwork: Buffer; // PNG or JPEG bytes (sniffed, never trusted by extension)
  imageWidth: number; // artwork pixel dimensions (drive the page aspect ratio)
  imageHeight: number;
  fields: CertificateFieldLayout[];
  values: Partial<Record<CertificateFieldKind, string>>;
}

// A4-landscape-ish width; height follows the artwork's aspect ratio so any
// artwork shape (landscape, square, portrait) renders edge-to-edge.
const PAGE_WIDTH = 842;
const MIN_FONT_PT = 6;

// Font bytes cached per process — templates re-render rarely and the files
// are immutable repo assets.
const fontBytesCache = new Map<CertificateFontId, Buffer>();

function fontFileFor(id: CertificateFontId): string | null {
  return CERT_FONT_FILES[id] ?? null;
}

function loadFontBytes(id: CertificateFontId): Buffer {
  const cached = fontBytesCache.get(id);
  if (cached) return cached;
  const file = fontFileFor(id);
  if (!file) throw new Error(`Unknown certificate font "${id}"`);
  const bytes = fs.readFileSync(path.join(CERT_FONTS_DIR, file));
  fontBytesCache.set(id, bytes);
  return bytes;
}

function sniffImage(bytes: Buffer): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  return null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x101828;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

// Width of `text` at `size` including optional letter-spacing (em units).
function measure(font: PDFFont, text: string, size: number, letterSpacing?: number): number {
  const base = font.widthOfTextAtSize(text, size);
  if (!letterSpacing || text.length < 2) return base;
  return base + letterSpacing * size * (text.length - 1);
}

export async function renderCertificatePdf(input: RenderCertificateInput): Promise<Buffer> {
  const kind = sniffImage(input.artwork);
  if (!kind) throw new Error('Certificate artwork must be a PNG or JPEG image');

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const pageHeight = (PAGE_WIDTH * input.imageHeight) / Math.max(1, input.imageWidth);
  const page = doc.addPage([PAGE_WIDTH, pageHeight]);

  const image = kind === 'png' ? await doc.embedPng(input.artwork) : await doc.embedJpg(input.artwork);
  page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: pageHeight });

  // Embed each used font once — WHOLE, not subset: fontkit's subsetter drops
  // glyphs from some of these TTFs (observed: Great Vibes + Inter lost most
  // letters). Full embedding costs ~300 KB per used font; correct beats small
  // for a keepsake document.
  const fonts = new Map<CertificateFontId, PDFFont>();
  for (const field of input.fields) {
    if (!field.enabled || fonts.has(field.fontFamily)) continue;
    let bytes: Buffer;
    try {
      bytes = loadFontBytes(field.fontFamily);
    } catch {
      // Fall back to Inter. If CERT_FONTS_DIR itself is wrong this throws too
      // — by design: boot already logged the bad path (see storage-dirs.ts),
      // and a certificate with substituted glyphs is worse than a loud failure.
      bytes = loadFontBytes('inter');
    }
    fonts.set(field.fontFamily, await doc.embedFont(bytes));
  }

  for (const field of input.fields) {
    if (!field.enabled) continue;
    const raw = input.values[field.kind];
    if (!raw) continue; // unknown/blank values are simply not drawn
    const text = field.uppercase ? raw.toUpperCase() : raw;
    const font = fonts.get(field.fontFamily);
    if (!font) continue;

    const boxLeft = (field.xPct / 100) * PAGE_WIDTH;
    const boxTop = (field.yPct / 100) * pageHeight;
    const boxWidth = (field.widthPct / 100) * PAGE_WIDTH;

    // Auto-shrink until the text fits its box (long names on narrow boxes).
    let size = (field.fontSizePct / 100) * PAGE_WIDTH;
    for (let i = 0; i < 4; i++) {
      const w = measure(font, text, size, field.letterSpacing);
      if (w <= boxWidth || size <= MIN_FONT_PT) break;
      size = Math.max(MIN_FONT_PT, (size * boxWidth) / w);
    }

    const textWidth = measure(font, text, size, field.letterSpacing);
    let x = boxLeft;
    if (field.align === 'center') x = boxLeft + (boxWidth - textWidth) / 2;
    if (field.align === 'right') x = boxLeft + boxWidth - textWidth;

    // Editor boxes render at line-height:1 → glyph tops sit ~ascent below the
    // box top. pdf-lib's y is the BASELINE in bottom-left coordinates.
    const ascent = font.heightAtSize(size, { descender: false });
    const y = pageHeight - boxTop - ascent;

    const { r, g, b } = hexToRgb(field.color);
    const color = rgb(r, g, b);

    if (field.letterSpacing && text.length > 1) {
      // pdf-lib has no native tracking — draw per character, advancing by
      // charWidth + spacing (the preview uses CSS letter-spacing:<n>em).
      let cx = x;
      for (const ch of text) {
        page.drawText(ch, { x: cx, y, size, font, color });
        cx += font.widthOfTextAtSize(ch, size) + field.letterSpacing * size;
      }
    } else {
      page.drawText(text, { x, y, size, font, color });
    }
  }

  return Buffer.from(await doc.save());
}

// "June 12, 2026" — fixed locale so certificates are stable across servers.
export function formatIssueDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}
