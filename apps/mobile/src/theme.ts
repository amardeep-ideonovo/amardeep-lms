// Shared design tokens — "Ink Hero" edition. The palette is driven at runtime
// by the admin's "App Customization" config (fetched in config-provider,
// applied by theme-provider). The values below are the defaults / offline
// fallback and MUST stay in sync with the API defaults
// (apps/api/src/site/app-config.service.ts) and seedAppConfig() in
// packages/db/prisma/seed.ts.
import type { AppConfig, AppThemePalette } from "@lms/types";

// The themeable palette screens consume: the 8 admin-configurable colors
// (AppThemePalette) plus derived tokens (NOT admin-configurable — computed
// from the 8, so an admin palette change restyles every surface, including
// the ink-chrome ones).
export type ThemePalette = AppThemePalette & {
  locked: string;
  onPrimary: string;
  // brand-derived
  chrome: string; // ink band chrome (Home hero, auth band) — always deep
  inkCard: string; // ink cards floated on light surfaces (live strip, certs)
  ctaStart: string; // teal CTA gradient (design --teal-grad)
  ctaEnd: string;
  onCta: string; // label color legible on the CTA gradient (white or dark ink)
  primaryOnDark: string; // primary accent legible on chrome/ink surfaces
  gradientStart: string; // hero-band gradient start (primary-tinted shade)
  gradientEnd: string; // hero-band gradient end (= bg)
  primarySoft: string; // primary as TEXT on light surfaces (AA-darkened)
  borderSoft: string; // hairline borders (border @ 50% alpha)
  // fixed semantics
  chipBg: string;
  overlayStrong: string; // image scrims — mode-independent (photos stay dark)
  overlayMid: string;
  overlayFaint: string;
  heroText: string; // text over image+scrim is ALWAYS light
  heroTextSoft: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  dangerBg: string;
};
export type Theme = {
  mode: "light" | "dark"; // active resolved mode (drives the status bar)
  colors: ThemePalette;
  spacing: typeof spacing;
  fonts: typeof fonts;
};

// The 8 admin-configurable colors — the Ink Hero design system (light content
// with ink #221c3d chrome; teal #3cc4b2 accent), so web, API defaults, and the
// app agree out of the box. DARK is the all-ink variant for admins who choose
// a dark scheme.
const APP_DARK: AppThemePalette = {
  bg: "#221c3d",
  surface: "#272144",
  surfaceMuted: "#322b52",
  border: "#3a3460",
  text: "#ffffff",
  textMuted: "#a7a3bd",
  primary: "#3cc4b2",
  danger: "#ea4f4f",
};
const APP_LIGHT: AppThemePalette = {
  bg: "#f4f3f8",
  surface: "#ffffff",
  surfaceMuted: "#f1eff7",
  border: "#e4e1ee",
  text: "#272144",
  textMuted: "#8b87a3",
  primary: "#3cc4b2",
  danger: "#e04848",
};

const LOCKED = { dark: "#6f6a8e", light: "#b6b3c9" } as const;

// Mode-keyed semantic constants (success/warning have no admin color to
// derive from; values are the Ink Hero status tokens — teal set on light,
// teal-on-dark set on ink).
const SEMANTIC = {
  dark: {
    chipBg: "rgba(255,255,255,0.08)",
    success: "#7ce4d2",
    successBg: "rgba(60,196,178,0.2)",
    warning: "#f6a623",
    warningBg: "rgba(246,166,35,0.16)",
    dangerBg: "rgba(234,79,79,0.16)",
  },
  light: {
    chipBg: "#f1eff7",
    success: "#2a9d8d",
    successBg: "rgba(53,179,162,0.12)",
    warning: "#c07f10",
    warningBg: "rgba(246,166,35,0.16)",
    dangerBg: "rgba(224,72,72,0.1)",
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
// admin sees is what the app computes. Note: the Ink Hero teal #3cc4b2 has a
// luminance of ~0.44, so this correctly resolves to WHITE button text.
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
  const t = hexToHsl(p.text);

  // Ink CHROME (bands / hero headers). Derived from the admin TEXT color's hue
  // so the band always sits in the same ink family as the headings: saturation
  // pinned to 0.37 and lightness to 0.175 — for the stock Ink Hero text
  // (#272144) this lands on EXACTLY #221c3d (the design's ink-900). Near-gray
  // text keeps its own (low) saturation so we never invent a hue. In dark mode
  // the whole app already sits on an ink bg, so the chrome IS the bg.
  const chrome =
    mode === "dark" ? p.bg : hslToHex(t.h, t.s < 0.08 ? t.s : 0.37, 0.175);

  // Ink CARDS floated on light content (live strip, active class, certificate
  // hero). For the stock palettes this is exactly #272144 (ink-800) in both
  // modes: light re-uses the ink text color, dark re-uses the ink surface.
  const inkCard = mode === "dark" ? p.surface : p.text;

  // Teal CTA gradient + on-dark accent. The stock primary (#3cc4b2) pins the
  // exact design values (#4fcdb8 → #2f9d8e; on-dark #7ce4d2); custom primaries
  // derive a same-hue ramp so a recolored app keeps identical treatment.
  const stockPrimary = p.primary.toLowerCase() === "#3cc4b2";
  const ctaStart = stockPrimary
    ? "#4fcdb8"
    : hslToHex(h, Math.max(s, 0.35), Math.min(0.62, l + 0.06));
  const ctaEnd = stockPrimary
    ? "#2f9d8e"
    : hslToHex(h, Math.max(s, 0.35), Math.max(0.18, l - 0.11));
  const primaryOnDark = stockPrimary
    ? "#7ce4d2"
    : hslToHex(h, Math.max(s, 0.4), 0.69);

  return {
    ...p,
    locked: LOCKED[mode],
    onPrimary: onColor(p.primary),
    chrome,
    inkCard,
    ctaStart,
    ctaEnd,
    // Label color chosen against the LIGHTER gradient stop (worst case for white
    // text), so a light brand accent gets dark ink instead of unreadable white.
    onCta: onColor(luminance(ctaStart) >= luminance(ctaEnd) ? ctaStart : ctaEnd),
    primaryOnDark,
    gradientStart: hslToHex(h, 0.36, mode === "dark" ? 0.17 : 0.92),
    gradientEnd: p.bg,
    // Primary as TEXT: on light surfaces the raw teal fails AA, so it darkens
    // (#2a9d8d for the stock primary — the design's teal-text-on-light); on
    // dark it lifts to the on-dark accent.
    primarySoft:
      mode === "dark"
        ? primaryOnDark
        : stockPrimary
          ? "#2a9d8d"
          : hslToHex(h, Math.max(s, 0.35), Math.min(l, 0.4)),
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
  // Deterministic per seed, constrained to the teal→sea brand band (150–200°)
  // so image-less tiles read on-brand with the Ink Hero teal.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 50;
  const h = 150 + hash;
  const h2 = 150 + ((hash + 20) % 50);
  // Muted deep-teal (low saturation + lightness) so image-less tiles read as
  // quiet placeholders, not loud neon.
  return [`hsl(${h}, 38%, 32%)`, `hsl(${h2}, 34%, 24%)`];
}

// Elevated-card shadow (design --shadow-overlap ink tint). Android's
// `elevation` only renders on views with an opaque backgroundColor — apply to
// surface cards, never gradient wrappers.
export const elevatedShadow = (mode: "light" | "dark") => ({
  shadowColor: "#140f2d",
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

// Plus Jakarta Sans everywhere (Ink Hero), loaded via expo-font in App.tsx.
// RN doesn't synthesize custom-font weights, so each weight is its own family
// — use fontFamily(weight) or theme.fonts.* instead of bare fontWeight. The
// display aliases remain so existing call sites keep working: headings are
// simply heavier Jakarta cuts now (700/600/800).
export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
  display: "PlusJakartaSans_700Bold",
  displaySemi: "PlusJakartaSans_600SemiBold",
  displayBlack: "PlusJakartaSans_800ExtraBold",
} as const;

// Map a fontWeight to the matching Jakarta family (so existing `fontWeight`
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
// Ink Hero ships LIGHT by default (light content under ink chrome).
export const DEFAULT_APP_CONFIG: AppConfig = {
  title: "LMS",
  tagline: null,
  description: null,
  logoUrl: null,
  iconUrl: null,
  splashUrl: null,
  colorScheme: "light",
  light: APP_LIGHT,
  dark: APP_DARK,
};
