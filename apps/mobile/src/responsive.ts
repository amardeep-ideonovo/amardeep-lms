// Tablet / large-screen support. One rule everywhere: screens keep their
// phone-first fluid layouts, but the content column is capped and centered on
// wide windows instead of stretching edge to edge. Anything that sizes itself
// from the window width must size from `useContentLayout().contentWidth`
// instead, so images, embeds and grids agree with the capped column. Works for
// every width the OS can hand us — phones, Android tablets, iPad full screen
// AND iPad Split View / Slide Over (where the window is phone-sized on a
// tablet device, which is why everything keys off window width, never off
// "is this device a tablet").
import { Dimensions, Platform, useWindowDimensions } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";

import { spacing } from "./theme";

// Main reading/content column. 700 keeps text measures comfortable and matches
// the web app's article width; grids fill it with an extra column instead.
export const CONTENT_MAX_WIDTH = 700;

// Auth / connect forms — a full-bleed 700px form looks broken; forms cap
// tighter, like a centered dialog.
export const FORM_MAX_WIDTH = 460;

// Marketing popups (PopupHost) — admin-configured % widths resolve against the
// window, so on a 1024pt iPad "90%" would be a 920pt modal. Hard ceiling.
export const POPUP_MAX_WIDTH = 560;

// Above this effective content width, screens switch to their wide variants
// (3-up grids, side-by-side heroes). Portrait phones stay below it; tablets
// and landscape phones clear it — both genuinely have the room.
export const WIDE_CONTENT_MIN = 560;

// Style fragments for ScrollView/FlatList `contentContainerStyle` (or any
// full-width wrapper): full width up to the cap, centered. Spread them into
// the screen's existing content style inside StyleSheet.create.
export const contentColumn = {
  width: "100%",
  maxWidth: CONTENT_MAX_WIDTH,
  alignSelf: "center",
} as const;

export const formColumn = {
  width: "100%",
  maxWidth: FORM_MAX_WIDTH,
  alignSelf: "center",
} as const;

// The effective content width of the current window — the number every
// width-derived computation (tile math, HtmlView contentWidth, 16:9 heights)
// must use in place of the raw window width.
export function useContentLayout(): {
  contentWidth: number;
  isWide: boolean;
} {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, CONTENT_MAX_WIDTH);
  return { contentWidth, isWide: contentWidth >= WIDE_CONTENT_MIN };
}

// Explore-grid tiles (Dashboard + My Classes share this exact formula): 2-up
// on phones, 3-up once the column is wide enough that 2-up tiles turn into
// slabs. `contentWidth` is the capped column; padding/gap mirror the screens'
// grid styles (paddingHorizontal spacing.md, gap spacing.sm).
export function exploreTileWidth(contentWidth: number): number {
  const columns = contentWidth >= WIDE_CONTENT_MIN ? 3 : 2;
  return (contentWidth - spacing.md * 2 - spacing.sm * (columns - 1)) / columns;
}

// Android ships with the activity portrait-locked in the manifest (phones
// should not rotate). On tablet-class devices we lift that lock at startup so
// the OS sensor drives orientation — Play's large-screen guidelines treat a
// portrait-locked tablet app as not optimized, and Android 12L+ letterboxes
// it anyway. iOS needs no runtime call: the Info.plist ~ipad orientation list
// (app.config.ts) already frees the iPad while iPhone stays portrait.
// `screen` (not `window`) so Split-screen/freeform windows can't misclassify
// the device; ≥600dp shortest edge is the Android tablet convention.
export function unlockTabletOrientation(): void {
  if (Platform.OS !== "android") return;
  const { width, height } = Dimensions.get("screen");
  if (Math.min(width, height) < 600) return;
  void ScreenOrientation.unlockAsync().catch(() => {
    // Best-effort: a failure just leaves the app portrait — never fatal.
  });
}
