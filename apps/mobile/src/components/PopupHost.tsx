// Native popup host. Shows the ACTIVE popups that match the current context
// (the dashboard, or a CMS page) in a RN <Modal>. The API does all visibility
// filtering — this just fetches + renders. The popup body is a Puck document
// rendered by the SAME native PageRenderer used for CMS pages, wrapped in a box
// styled from the popup's presentation settings (background/border/radius/
// padding) and placed per its `position`.
//
// Colors: admins style popups against the web defaults (e.g. a white box), so
// the body must NOT use the app theme's text colors — dark-mode white text on
// a white configured background is unreadable. When the popup config sets a
// background, its luminance picks a self-consistent light/dark content palette
// (same rule as theme.ts's onColor) that is scoped to the body via PageScope;
// brand colors (primary/danger/onPrimary) stay from the app theme. With no
// configured background, the box and content fall back to the theme.
//
// Display behaviour: EVERY visit — appears on mount/focus; the close button
// hides it for this view only (no persistence), so it reappears next time.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  PopupContext,
  PopupPosition,
  PopupPublicDTO,
} from "@lms/types";

import { api } from "../api";
import { PageRenderer } from "./PageRenderer";
import { PageScope } from "./PageScope";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useTheme } from "../theme-provider";

// Map a popup position to overlay flex alignment (column layout:
// justifyContent = vertical, alignItems = horizontal).
function overlayAlign(pos: PopupPosition): {
  justifyContent: "flex-start" | "center" | "flex-end";
  alignItems: "flex-start" | "center" | "flex-end";
} {
  switch (pos) {
    case "TOP":
      return { justifyContent: "flex-start", alignItems: "center" };
    case "BOTTOM":
      return { justifyContent: "flex-end", alignItems: "center" };
    case "TOP_LEFT":
      return { justifyContent: "flex-start", alignItems: "flex-start" };
    case "TOP_RIGHT":
      return { justifyContent: "flex-start", alignItems: "flex-end" };
    case "BOTTOM_LEFT":
      return { justifyContent: "flex-end", alignItems: "flex-start" };
    case "BOTTOM_RIGHT":
      return { justifyContent: "flex-end", alignItems: "flex-end" };
    case "CENTER":
    default:
      return { justifyContent: "center", alignItems: "center" };
  }
}

// Resolve a CSS width string ("480px", "90%", "auto") to a pixel width that
// fits the screen.
function resolveWidth(width: string, screenW: number): number {
  const w = (width || "").trim();
  const max = screenW - 32;
  if (w.endsWith("%")) {
    const pct = parseFloat(w);
    if (!Number.isNaN(pct)) return Math.min(max, (pct / 100) * screenW);
  }
  const px = parseFloat(w);
  if (!Number.isNaN(px) && /^\d/.test(w)) return Math.min(max, px);
  return Math.min(max, 480); // auto / unknown
}

// WCAG relative luminance of a CSS color — local replica of theme.ts's
// (unexported) helper, widened to the formats the admin color fields emit
// (#rgb/#rrggbb[aa], rgb()/rgba()). Returns null for anything else.
function luminanceOf(color: string): number | null {
  const c = color.trim();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(c)?.[1];
  if (hex && (hex.length === 3 || hex.length === 4)) {
    rgb = [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16));
  } else if (hex && (hex.length === 6 || hex.length === 8)) {
    rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else {
    const fn = /^rgba?\(([^)]+)\)$/i.exec(c);
    const parts = fn?.[1].split(",").map((v) => parseFloat(v));
    if (parts && parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      rgb = parts.slice(0, 3);
    }
  }
  if (!rgb) return null;
  const ch = rgb.map((v) => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Neutral content tokens for an admin-configured popup background — the same
// slate ramps as the app's default light/dark palettes (theme.ts defaults).
const LIGHT_CONTENT = {
  surface: "#f1f5f9",
  surfaceMuted: "#e2e8f0",
  border: "#cbd5e1",
  text: "#101828",
  textMuted: "#475569",
} as const;
const DARK_CONTENT = {
  surface: "#1e293b",
  surfaceMuted: "#334155",
  border: "#334155",
  text: "#f8fafc",
  textMuted: "#94a3b8",
} as const;

function popupTheme(app: Theme, bg: string, light: boolean): Theme {
  return {
    mode: light ? "light" : "dark",
    spacing: app.spacing,
    colors: { ...app.colors, bg, ...(light ? LIGHT_CONTENT : DARK_CONTENT) },
  };
}

function PopupModal({
  popup,
  onClose,
}: {
  popup: PopupPublicDTO;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const { width: screenW, height: screenH } = useWindowDimensions();
  const s = popup.style;
  const align = overlayAlign(s.position);
  const boxWidth = resolveWidth(s.width, screenW);

  // Box colors: the configured set used together, else the theme surface set.
  // An unparseable configured color is treated as light — the admin styles
  // against the web's light defaults.
  const configuredBg = (s.background || "").trim();
  const boxBg = configuredBg || colors.surface;
  const lum = luminanceOf(boxBg);
  const light =
    lum !== null ? lum > 0.45 : configuredBg ? true : theme.mode === "light";
  const boxBorder =
    (s.borderColor || "").trim() ||
    (configuredBg ? (light ? "#e2e8f0" : "#334155") : colors.border);
  const contentTheme = useMemo(
    () => (configuredBg ? popupTheme(theme, configuredBg, light) : null),
    [configuredBg, theme, light]
  );

  // Count one impression when the popup appears.
  useEffect(() => {
    api.recordPopupEvent(popup.id, "view");
  }, [popup.id]);

  const handleClose = () => {
    api.recordPopupEvent(popup.id, "dismiss");
    onClose();
  };

  // Engagement: any link/button pressed inside the body (web parity with the
  // host's click-capture on a/button elements).
  const handleInteract = useCallback(() => {
    api.recordPopupEvent(popup.id, "click");
  }, [popup.id]);

  return (
    <Modal transparent visible animationType="fade" onRequestClose={handleClose}>
      {/* Dim backdrop — tap outside the box to dismiss. */}
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <View style={[styles.overlay, align]} pointerEvents="box-none">
        <View
          style={[
            styles.box,
            {
              width: boxWidth,
              maxHeight: screenH * 0.85,
              backgroundColor: boxBg,
              borderColor: boxBorder,
              borderRadius: s.borderRadius,
              padding: s.padding,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.close, light ? styles.closeLight : styles.closeDark]}
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[
                styles.closeText,
                light ? styles.closeTextLight : styles.closeTextDark,
              ]}
            >
              ×
            </Text>
          </TouchableOpacity>
          <ScrollView showsVerticalScrollIndicator={false}>
            <PageScope theme={contentTheme} onInteract={handleInteract}>
              <PageRenderer data={popup.data} />
            </PageScope>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function PopupHost({ context }: { context: PopupContext }) {
  const [popups, setPopups] = useState<PopupPublicDTO[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const ctxKey =
    context.type === "page" ? `page:${context.pageId}` : "dashboard";

  const load = useCallback(async () => {
    try {
      setPopups(await api.activePopups(context));
    } catch {
      setPopups([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  useEffect(() => {
    let alive = true;
    load().then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Show the first popup that hasn't been dismissed in this view.
  const popup = popups.find((p) => !closed.has(p.id)) ?? null;
  if (!popup) return null;

  return (
    <PopupModal
      popup={popup}
      onClose={() => setClosed((prev) => new Set(prev).add(popup.id))}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(15,23,42,0.5)",
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: spacing.md,
  },
  box: {
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  close: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  // The × follows the BOX background, not the app theme.
  closeLight: { backgroundColor: "rgba(15,23,42,0.08)" },
  closeDark: { backgroundColor: "rgba(248,250,252,0.16)" },
  closeText: { fontSize: 18, lineHeight: 20 },
  closeTextLight: { color: "#101828" },
  closeTextDark: { color: "#f8fafc" },
});
