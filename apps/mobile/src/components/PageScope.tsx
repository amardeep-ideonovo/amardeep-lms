// Scoped context for content rendered by PageRenderer. A host that draws page
// blocks on a surface whose colors come from admin config rather than the app
// theme (the popup box) provides:
//   - `theme`: a Theme override so block styles stay self-consistent with that
//     surface (a light popup background gets dark text even when the app theme
//     is dark, and vice versa)
//   - `onInteract`: called when a link/button inside the content is pressed,
//     so the popup can record "click" analytics (mirrors the web popup host's
//     click-capture on a/button elements)
// Outside a scope the hooks fall through to the app theme / a null callback.
import React, { createContext, useContext, useMemo } from "react";
import { Linking } from "react-native";

import type { Theme } from "../theme";
import { useTheme } from "../theme-provider";

const ScopeThemeContext = createContext<Theme | null>(null);
const InteractionContext = createContext<(() => void) | null>(null);

export function PageScope({
  theme = null,
  onInteract = null,
  children,
}: {
  theme?: Theme | null;
  onInteract?: (() => void) | null;
  children: React.ReactNode;
}) {
  return (
    <ScopeThemeContext.Provider value={theme}>
      <InteractionContext.Provider value={onInteract}>
        {children}
      </InteractionContext.Provider>
    </ScopeThemeContext.Provider>
  );
}

export function useScopedTheme(): Theme {
  const scoped = useContext(ScopeThemeContext);
  const app = useTheme();
  return scoped ?? app;
}

// Drop-in for theme-provider's useStyles that honors the scope override.
export function useScopedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useScopedTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

export function useInteraction(): (() => void) | null {
  return useContext(InteractionContext);
}

// Shared link handler for page blocks (buttons, cards, menu links, redirects).
// Only external schemes can be opened from here; in-app routes are app-specific.
export function openHref(href?: string) {
  if (!href) return;
  if (/^(https?:|mailto:|tel:)/i.test(href)) Linking.openURL(href).catch(() => {});
}
