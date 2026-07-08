// Pure-RN progress ring (this app has no react-native-svg): a bordered track
// circle plus two clipped half-arc overlays. Each overlay is a circle whose
// top+right borders are painted (= a 180° arc) rotated inside a half-width
// clipping view, so the right clip sweeps 0–180° and the left clip 180–360°.
// Caps are flat (RN borders can't do the design's round caps) — accepted
// degradation vs the SVG mocks.
import React from "react";
import { Text, View } from "react-native";

import { fonts } from "../theme";
import { useScopedTheme } from "./PageScope";

export function ProgressRing({
  size = 64,
  stroke = 7,
  pct,
  color,
  trackColor,
  label,
  labelColor,
  labelSize = 14,
}: {
  size?: number;
  stroke?: number;
  pct: number; // 0..100
  color?: string;
  trackColor?: string;
  label?: string; // centered text; defaults to "{pct}%" when undefined
  labelColor?: string;
  labelSize?: number;
}) {
  const { colors } = useScopedTheme();
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const sweep = (clamped / 100) * 360;
  const half = size / 2;
  const fill = color ?? colors.primary;
  const track = trackColor ?? colors.surfaceMuted;

  // Unrotated, the painted (top+right) borders cover compass −45°…135°
  // (0° = 12 o'clock); rotating by R shifts that to [R−45°, R+135°].
  const arc = (rotate: number) => ({
    position: "absolute" as const,
    top: 0,
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
    borderTopColor: fill,
    borderRightColor: fill,
    borderBottomColor: "transparent",
    borderLeftColor: "transparent",
    transform: [{ rotate: `${rotate}deg` }],
  });

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: half,
          borderWidth: stroke,
          borderColor: track,
        }}
      />
      {sweep > 0 ? (
        // Right half of the ring: shows the first 0–180° of sweep.
        <View
          style={{
            position: "absolute",
            left: half,
            top: 0,
            width: half,
            height: size,
            overflow: "hidden",
          }}
        >
          <View style={[arc(Math.min(sweep, 180) - 135), { left: -half }]} />
        </View>
      ) : null}
      {sweep > 180 ? (
        // Left half: shows 180–360°.
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: half,
            height: size,
            overflow: "hidden",
          }}
        >
          <View style={[arc(sweep - 135), { left: 0 }]} />
        </View>
      ) : null}
      <Text
        style={{
          color: labelColor ?? colors.text,
          fontSize: labelSize,
          fontFamily: fonts.bold,
        }}
      >
        {label ?? `${clamped}%`}
      </Text>
    </View>
  );
}
