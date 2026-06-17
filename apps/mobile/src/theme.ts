// Shared design tokens. The palette is driven at runtime by the admin's "App
// Customization" config (fetched in config-provider, applied by theme-provider).
// The values below are the defaults / offline fallback and MUST stay in sync
// with the API defaults (apps/api/src/site/app-config.service.ts).
import type { AppConfig, AppThemePalette } from "@lms/types";

// The themeable palette screens consume: the 8 admin-configurable colors
// (AppThemePalette) plus derived tokens (NOT admin-configurable — computed
// from the 8, so an admin palette change restyles every surface, including
// the cinematic ones).
export type ThemePalette = AppThemePalette & {
  locked: string;
  onPrimary: string;
  // brand-derived
  gradientStart: string; // hero-band gradient start (primary-tinted deep shade)
  gradientEnd: string; // hero-band gradient end (= bg)
  primarySoft: string; // lightened primary for eyebrows / quiet CTAs
  borderSoft: string; // hairline borders (border @ 50% alpha)
  // fixed semantics
  chipBg: string;
  overlayStrong: string; // image scrims — mode-independent
  overlayMid: string;
  overlayFaint: string;
  heroText: string; // text over image+scrim is ALWAYS light
  heroTextSoft: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
};
export type Theme = {
  mode: "light" | "dark"; // active resolved mode (drives the status bar)
  colors: ThemePalette;
  spacing: typeof spacing;
  fonts: typeof fonts;
};

// The 8 admin-configurable colors — the member website's theme (see
// apps/web/app/globals.css and its cinematic dark scopes), so web, API
// defaults, and the app agree out of the box.
const APP_DARK: AppThemePalette = {
  bg: "#100c1b",
  surface: "#211a33",
  surfaceMuted: "#2a2240",
  border: "#342a4f",
  text: "#f4f1fb",
  textMuted: "#948cb4",
  primary: "#7c5cfc",
  danger: "#f2557b",
};
const APP_LIGHT: AppThemePalette = {
  bg: "#f5f3fc",
  surface: "#ffffff",
  surfaceMuted: "#f2eefb",
  border: "#e7e2f4",
  text: "#251f3d",
  textMuted: "#8b84a4",
  primary: "#7c5cfc",
  danger: "#e11d48",
};

const LOCKED = { dark: "#5c5c66", light: "#98a2b3" } as const;

// Mode-keyed semantic constants (success/warning have no admin color to
// derive from; chip fills are theme-relative translucencies).
const SEMANTIC = {
  dark: {
    chipBg: "rgba(255,255,255,0.05)",
    success: "#46c9a0",
    successBg: "rgba(70,201,160,0.16)",
    warning: "#f6a623",
    warningBg: "rgba(246,166,35,0.14)",
  },
  light: {
    chipBg: "rgba(16,24,40,0.05)",
    success: "#079455",
    successBg: "rgba(7,148,85,0.12)",
    warning: "#b54708",
    warningBg: "rgba(181,71,8,0.12)",
  },
} as const;

// WCAG relative luminance of a #rrggbb color.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// White text on dark/saturated surfaces, near-black on light ones. The admin's
// live preview mirrors this derivation (AppCustomizationBuilder), so what the
// admin sees is what the app computes.
function onColor(hex: string): string {
  return luminance(hex) > 0.45 ? "#101828" : "#ffffff";
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
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

function hslToHex(h: number, s: number, l: number): string {
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
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Add the derived tokens to an admin palette to form the full ThemePalette.
// Derivations are clamped so extreme admin primaries (gray, near-black, neon)
// still produce visible eyebrows and sane gradients.
export function paletteFrom(p: AppThemePalette, mode: "light" | "dark"): ThemePalette {
  const { h, s, l } = hexToHsl(p.primary);
  return {
    ...p,
    locked: LOCKED[mode],
    onPrimary: onColor(p.primary),
    gradientStart: hslToHex(h, 0.36, mode === "dark" ? 0.17 : 0.92),
    gradientEnd: p.bg,
    primarySoft:
      mode === "dark" ? hslToHex(h, Math.max(s, 0.3), Math.max(l, 0.81)) : p.primary,
    borderSoft: p.border + "80",
    heroText: "#f4f4f6",
    heroTextSoft: "#c2c2cb",
    overlayStrong: "rgba(8,8,10,0.92)",
    overlayMid: "rgba(8,8,10,0.55)",
    overlayFaint: "rgba(8,8,10,0.15)",
    ...SEMANTIC[mode],
  };
}

// Deterministic per-item gradient for image-less tiles (parity with the web
// dashboard's letterGradient).
export function letterGradient(seed: string): [string, string] {
  // Deterministic per seed, constrained to the violet→magenta brand band
  // (255–330°) so image-less tiles read on-brand (parity with web).
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 75;
  const h = 255 + hash;
  const h2 = 255 + ((hash + 30) % 75);
  // Muted dark-violet (low saturation + lightness) so image-less tiles read as
  // quiet placeholders, not loud magenta.
  return [`hsl(${h}, 36%, 34%)`, `hsl(${h2}, 32%, 26%)`];
}

// Elevated-card shadow. Android's `elevation` only renders on views with an
// opaque backgroundColor — apply to surface cards, never gradient wrappers.
export const elevatedShadow = (mode: "light" | "dark") => ({
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: mode === "dark" ? 0.4 : 0.12,
  shadowRadius: 12,
  elevation: 8,
});

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
};

// Montserrat (UI/body) + Playfair Display (headlines), loaded via expo-font in
// App.tsx. RN doesn't synthesize custom-font weights, so each weight is its own
// family — use fontFamily(weight) or theme.fonts.* instead of bare fontWeight.
export const fonts = {
  regular: "Montserrat_400Regular",
  medium: "Montserrat_500Medium",
  semibold: "Montserrat_600SemiBold",
  bold: "Montserrat_700Bold",
  extrabold: "Montserrat_800ExtraBold",
  display: "PlayfairDisplay_700Bold",
  displaySemi: "PlayfairDisplay_600SemiBold",
  displayBlack: "PlayfairDisplay_800ExtraBold",
} as const;

// Map a fontWeight to the matching Montserrat family (so existing `fontWeight`
// values pick the right loaded face rather than synthetic bold).
export function fontFamily(weight?: string | number): string {
  const w = typeof weight === "string" ? parseInt(weight, 10) || 400 : weight ?? 400;
  if (w >= 800) return fonts.extrabold;
  if (w >= 700) return fonts.bold;
  if (w >= 600) return fonts.semibold;
  if (w >= 500) return fonts.medium;
  return fonts.regular;
}

// Default config used for the very first paint and when offline. Mirrors the API
// default-merge so an unconfigured / disconnected app looks like it does today.
export const DEFAULT_APP_CONFIG: AppConfig = {
  title: "LMS",
  tagline: null,
  description: null,
  logoUrl: null,
  iconUrl: null,
  splashUrl: null,
  colorScheme: "dark",
  light: APP_LIGHT,
  dark: APP_DARK,
};
