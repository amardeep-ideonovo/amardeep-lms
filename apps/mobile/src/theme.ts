// Shared design tokens. The palette is driven at runtime by the admin's "App
// Customization" config (fetched in config-provider, applied by theme-provider).
// The values below are the defaults / offline fallback and MUST stay in sync
// with the API defaults (apps/api/src/site/app-config.service.ts).
import type { AppConfig, AppThemePalette } from "@lms/types";

// The themeable palette screens consume. It is the 8 admin-configurable colors
// (AppThemePalette) plus derived tokens (not admin-configurable): `locked` for
// the lock state on gated courses, and `onPrimary` — the text color that stays
// readable on a `primary` surface (computed from the primary's luminance, so an
// admin-chosen light primary gets dark text and a dark one gets white).
export type ThemePalette = AppThemePalette & {
  locked: string;
  onPrimary: string;
};
export type Theme = {
  mode: "light" | "dark"; // active resolved mode (drives the status bar)
  colors: ThemePalette;
  spacing: typeof spacing;
};

// The 8 admin-configurable colors (match AppThemePalette / the API defaults).
const APP_DARK: AppThemePalette = {
  bg: "#0f172a",
  surface: "#1e293b",
  surfaceMuted: "#334155",
  border: "#334155",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  primary: "#6366f1",
  danger: "#ef4444",
};
const APP_LIGHT: AppThemePalette = {
  bg: "#ffffff",
  surface: "#f1f5f9",
  surfaceMuted: "#e2e8f0",
  border: "#cbd5e1",
  text: "#0f172a",
  textMuted: "#475569",
  primary: "#6366f1",
  danger: "#ef4444",
};

const LOCKED = { dark: "#64748b", light: "#94a3b8" } as const;

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
  return luminance(hex) > 0.45 ? "#0f172a" : "#ffffff";
}

// Add the derived tokens to an admin palette to form the full ThemePalette.
export function paletteFrom(p: AppThemePalette, mode: "light" | "dark"): ThemePalette {
  return { ...p, locked: LOCKED[mode], onPrimary: onColor(p.primary) };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
};

// Default config used for the very first paint and when offline. Mirrors the API
// default-merge so an unconfigured / disconnected app looks like it does today.
export const DEFAULT_APP_CONFIG: AppConfig = {
  title: "LMS",
  tagline: null,
  description: null,
  logoUrl: null,
  iconUrl: null,
  splashUrl: null,
  colorScheme: "system",
  light: APP_LIGHT,
  dark: APP_DARK,
};
