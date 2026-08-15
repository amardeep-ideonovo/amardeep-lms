// Native popup host. Shows the ACTIVE popups that match the current context
// (a member-area surface — dashboard/classes/courses/lessons — or a CMS
// page) in a RN <Modal>. The API does all visibility
// filtering — this just fetches + renders. The popup body is a Puck document
// rendered by the SAME native PageRenderer used for CMS pages, wrapped in a box
// styled from the popup's presentation settings (background/border/radius/
// padding) and placed per its `position`.
//
// Colors: admins style popups against the web defaults (e.g. a white box), so
// the body must NOT blindly use the ACTIVE app palette — dark-mode white text
// on a white configured background is unreadable. When the popup config sets a
// background, its luminance (same rule as theme.ts's onColor) picks which of
// the INSTANCE's two palettes the content renders with (light bg → the
// instance's light palette, dark bg → its dark palette, scoped to the body via
// PageScope) — so a configured popup still carries the instance's branding
// rather than a hardcoded neutral ramp. With no configured background, the box
// and content fall back to the active theme. The popup CHROME (backdrop, box
// fallbacks, close control) draws from theme tokens.
//
// Display behaviour mirrors the web host: the popup's `behavior` decides WHEN
// it fires (IMMEDIATE/DELAY honored natively; SCROLL and EXIT_INTENT have no
// mobile equivalent and approximate with a short delay) and HOW OFTEN
// (frequency capping persisted in SecureStore; per-session in app memory).
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import * as SecureStore from "expo-secure-store";
import type {
  AppConfig,
  PopupContext,
  PopupPosition,
  PopupPublicDTO,
} from "@lms/types";

import { api } from "../api";
import { scopedKey } from "../config";
import { useAppConfig } from "../config-provider";
import { PageRenderer } from "./PageRenderer";
import { PageScope } from "./PageScope";
import { POPUP_MAX_WIDTH } from "../responsive";
import { paletteFrom, spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

// ---------- frequency capping ----------
// Map of popupId -> last-shown epoch ms, persisted across app runs. SecureStore
// is the storage the app already ships (token + config cache); the value is a
// tiny JSON object. Session scope is plain module memory (cleared on relaunch).
// Namespaced per instance (shared binary): one academy's frequency caps must
// not silence another's popups.
const seenKey = () => scopedKey("lmsPopupSeenV1");
const sessionShown = new Set<string>();

async function readSeen(): Promise<Record<string, number>> {
  try {
    const raw = await SecureStore.getItemAsync(seenKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

async function persistSeen(id: string): Promise<void> {
  try {
    const seen = await readSeen();
    seen[id] = Date.now();
    await SecureStore.setItemAsync(seenKey(), JSON.stringify(seen));
  } catch {
    /* storage unavailable — popup behaves like EVERY_VISIT */
  }
}

function isSuppressed(
  p: PopupPublicDTO,
  seen: Record<string, number>,
): boolean {
  const b = p.behavior;
  if (!b || b.frequency === "EVERY_VISIT") return false;
  if (b.frequency === "ONCE_PER_SESSION") return sessionShown.has(p.id);
  const at = seen[p.id] || 0;
  if (!at) return false;
  if (b.frequency === "ONCE") return true;
  const days = Math.max(1, b.frequencyDays || 7);
  return Date.now() - at < days * 86400000;
}

// The frequency clock starts when the popup actually shows.
function markSeen(p: PopupPublicDTO): void {
  const b = p.behavior;
  if (!b || b.frequency === "EVERY_VISIT") return;
  sessionShown.add(p.id);
  if (b.frequency !== "ONCE_PER_SESSION") void persistSeen(p.id);
}

// Native trigger approximation: IMMEDIATE/DELAY are honored exactly; SCROLL
// and EXIT_INTENT are web concepts, shown here after a short grace period.
function triggerDelayMs(p: PopupPublicDTO): number {
  const b = p.behavior;
  if (!b || b.trigger === "IMMEDIATE") return 0;
  if (b.trigger === "DELAY") return Math.max(0, b.triggerValue || 0) * 1000;
  if (b.trigger === "SCROLL") return 3000;
  return 15000; // EXIT_INTENT
}

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
  // Percentage widths resolve against the window, so a big tablet window
  // needs a hard ceiling — "90%" of a 1024pt iPad is not a popup. The
  // subtraction mirrors styles.overlay's spacing.md gutter on each side.
  const max = Math.min(screenW - spacing.md * 2, POPUP_MAX_WIDTH);
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
    if (
      parts &&
      parts.length >= 3 &&
      parts.slice(0, 3).every(Number.isFinite)
    ) {
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

// Content theme for an admin-configured popup background: the INSTANCE's own
// palette for the background's luminance family (not the active app mode, and
// not a hardcoded neutral ramp — the pre-P3b slate palette here ignored
// instance branding). paletteFrom() re-derives every token (primarySoft,
// borderSoft, …) against that family, so e.g. accent TEXT stays AA on a light
// box even while the app runs dark.
function popupTheme(
  app: Theme,
  config: AppConfig,
  bg: string,
  light: boolean,
): Theme {
  const mode = light ? "light" : "dark";
  return {
    mode,
    spacing: app.spacing,
    fonts: app.fonts,
    colors: { ...paletteFrom(config[mode], mode), bg },
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
  const styles = useStyles(makeStyles);
  const { colors } = theme;
  const { config } = useAppConfig();
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
  const contentTheme = useMemo(
    () =>
      configuredBg ? popupTheme(theme, config, configuredBg, light) : null,
    [configuredBg, theme, config, light],
  );
  // The palette the box's own chrome follows: the content theme when the bg is
  // configured, the app theme otherwise.
  const content = contentTheme ?? theme;
  const boxBorder = (s.borderColor || "").trim() || content.colors.border;

  // Count one impression + start the frequency clock when the popup appears.
  useEffect(() => {
    api.recordPopupEvent(popup.id, "view");
    markSeen(popup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // NONE keeps the modal instant; SLIDE_UP maps to the native slide; FADE and
  // ZOOM (no native zoom) use the fade transition.
  const animationType =
    popup.behavior?.animation === "NONE"
      ? "none"
      : popup.behavior?.animation === "SLIDE_UP"
        ? "slide"
        : "fade";
  const closeOnOverlay = popup.behavior?.closeOnOverlay !== false;

  return (
    <Modal
      transparent
      visible
      animationType={animationType}
      onRequestClose={handleClose}
    >
      {/* Dim backdrop — tapping it dismisses only when the admin allows it. */}
      <Pressable
        style={styles.backdrop}
        onPress={closeOnOverlay ? handleClose : undefined}
      />
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
          {/* The × follows the BOX background, not the app theme: a text-
              tinted wash + the content palette's text color (hex+alpha
              suffix — same technique as theme.ts's borderSoft). */}
          <TouchableOpacity
            style={[
              styles.close,
              {
                backgroundColor: light
                  ? `${content.colors.text}14`
                  : `${content.colors.text}29`,
              },
            ]}
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.closeText, { color: content.colors.text }]}>
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
  const [armedId, setArmedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ctxKey =
    context.type === "page" ? `page:${context.pageId}` : context.type;

  const load = useCallback(async () => {
    try {
      const [list, seen] = await Promise.all([
        api.activePopups(context),
        readSeen(),
      ]);
      // Frequency-capped popups are dropped up front (web parity).
      setPopups(list.filter((p) => !isSuppressed(p, seen)));
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

  // The next popup that hasn't been dismissed in this view.
  const popup = popups.find((p) => !closed.has(p.id)) ?? null;

  // Arm its trigger: show after the behavior-derived delay (0 = instantly).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!popup) return;
    const ms = triggerDelayMs(popup);
    if (ms === 0) {
      setArmedId(popup.id);
      return;
    }
    timer.current = setTimeout(() => setArmedId(popup.id), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup?.id]);

  if (!popup || armedId !== popup.id) return null;

  return (
    <PopupModal
      popup={popup}
      onClose={() => setClosed((prev) => new Set(prev).add(popup.id))}
    />
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      // Modal scrim token (AccountScreen's modals set the precedent) — the
      // pre-P3b literal was an off-palette slate wash.
      backgroundColor: colors.overlayMid,
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
      // Shadow literal kept: a modal-grade drop over the dimmed backdrop;
      // theme.ts elevatedShadow() is the in-page card recipe (different
      // color/geometry) and there is no token for shadow blacks.
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
    closeText: { fontSize: 18, lineHeight: 20, fontFamily: fonts.regular },
  });
