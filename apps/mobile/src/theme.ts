// Shared design tokens. The palette is driven at runtime by the admin's "App
// Customization" config (fetched in config-provider, applied by theme-provider).
// The values below are the defaults / offline fallback and MUST stay in sync
// with the API defaults (apps/api/src/site/app-config.service.ts).
import type { AppConfig, AppThemePalette } from "@lms/types";

// The themeable palette screens consume. It is the 8 admin-configurable colors
// (AppThemePalette) plus a derived `locked` shade (not admin-configurable — used
// for the lock state on gated courses).
export type ThemePalette = AppThemePalette & { locked: string };
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

// Add the derived `locked` shade to an admin palette to form the full ThemePalette.
export function paletteFrom(p: AppThemePalette, mode: "light" | "dark"): ThemePalette {
  return { ...p, locked: LOCKED[mode] };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
};

export const DARK_PALETTE: ThemePalette = paletteFrom(APP_DARK, "dark");
export const LIGHT_PALETTE: ThemePalette = paletteFrom(APP_LIGHT, "light");

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

// Back-compat: the previous static `colors` export equals the dark default, so
// screens not yet migrated to useTheme() keep compiling and look unchanged until
// they're converted. New/migrated code should use useTheme() instead.
export const colors = DARK_PALETTE;
