// Small, dependency-free color helpers shared by the admin color pickers. The
// API stores colors strictly as #rrggbb, so every public parse function returns
// a normalized lowercase #rrggbb (or null) — the UI may DISPLAY a color as RGB
// or HSL, but only ever persists hex.
//
// hexToHsl / hslToHex mirror the math in AppCustomizationBuilder.tsx (and
// apps/mobile/src/theme.ts) so palette derivation stays consistent.

export type ColorFormat = "hex" | "rgb" | "hsl";

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

// Expand #abc → #aabbcc, drop a leading #, validate, lowercase. null if not hex.
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    const [r, g, b] = s.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

// A guaranteed #rrggbb for feeding a native <input type="color"> (which rejects
// anything else); falls back to black when the stored value isn't valid hex.
export function toSwatchHex(value: string): string {
  return normalizeHex(value) ?? "#000000";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex) ?? "#000000";
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toHex2 = (v: number) =>
  clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

// h in [0,360), s and l in [0,1].
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r: R, g: G, b: B } = hexToRgb(hex);
  const r = R / 255;
  const g = G / 255;
  const b = B / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// Render a #rrggbb color as a display string in the given notation. Falls back
// to the raw input if it isn't a valid hex color.
export function formatColor(hex: string, fmt: ColorFormat): string {
  const norm = normalizeHex(hex);
  if (!norm) return hex;
  if (fmt === "rgb") {
    const { r, g, b } = hexToRgb(norm);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (fmt === "hsl") {
    const { h, s, l } = hexToHsl(norm);
    return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(
      l * 100,
    )}%)`;
  }
  return norm.toUpperCase();
}

// Parse hex / rgb() / hsl() (and bare hex without #) into a normalized lowercase
// #rrggbb. Returns null for anything unparseable, so callers can hold an
// in-progress draft without ever emitting a non-hex value.
export function parseColor(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const hex = normalizeHex(text);
  if (hex) return hex;

  const nums = (body: string): number[] =>
    body
      .replace(/%/g, "")
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n));

  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const p = nums(rgb[1]);
    if (p.length >= 3)
      return rgbToHex(
        clamp(p[0], 0, 255),
        clamp(p[1], 0, 255),
        clamp(p[2], 0, 255),
      );
  }

  const hsl = text.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const p = nums(hsl[1]);
    if (p.length >= 3) return hslToHex(p[0], p[1] / 100, p[2] / 100);
  }

  return null;
}
