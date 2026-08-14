// Brand glyph for the ink band (pure RN — no SVG dependency): the Spark
// four-point star approximated as a rotated-square diamond with a smaller
// companion spark at its top-right, both in the primary color. Only shown when
// the admin hasn't uploaded a logo (the logo image replaces the brand mark).
import React from "react";
import { View } from "react-native";

import { useScopedTheme } from "./PageScope";

export function SpotlightMark({ size = 20 }: { size?: number }) {
  const { colors } = useScopedTheme();
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: size * 0.14,
          top: size * 0.22,
          width: size * 0.46,
          height: size * 0.46,
          borderRadius: size * 0.09,
          backgroundColor: colors.primary,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.64,
          top: size * 0.06,
          width: size * 0.24,
          height: size * 0.24,
          borderRadius: size * 0.05,
          backgroundColor: colors.primary,
          opacity: 0.85,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}
