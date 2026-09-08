import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

import { useAppConfig } from "./config-provider";
import { paletteFrom, spacing, fonts, type Theme } from "./theme";

const ThemeContext = createContext<Theme | undefined>(undefined);

// Resolves the active palette from the admin config + the device color scheme
// (when colorScheme is "system"), and exposes it reactively so styles recompute
// when the config or system theme changes.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { config } = useAppConfig();
  const system = useColorScheme(); // "light" | "dark" | null

  const mode: "light" | "dark" =
    config.colorScheme === "system"
      ? system === "light"
        ? "light"
        : "dark" // default to dark when the system preference is unknown
      : config.colorScheme;

  // Key the theme on the ACTIVE palette VALUES + mode, not the whole config
  // object. A logo/title/tagline/legal edit produces a new config ref but leaves
  // colors untouched — memoizing on the palette signature keeps those non-color
  // edits from rebuilding every screen's StyleSheet (a visible full re-render).
  const palette = config[mode];
  const paletteKey = JSON.stringify(palette);
  const theme = useMemo<Theme>(
    () => ({ mode, colors: paletteFrom(palette, mode), spacing, fonts }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paletteKey, mode],
  );

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// Build a StyleSheet (or any object) from the active theme, memoized per theme.
// Screens define a module-level `makeStyles(theme)` factory and call
// `const styles = useStyles(makeStyles)` so styles react to theme changes.
export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
