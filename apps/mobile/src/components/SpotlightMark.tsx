// Brand glyph for the ink band (pure RN — no SVG dependency): the design's
// spotlight beam approximated with a rotated rounded square in the primary
// color, over a translucent elliptical light pool. Only shown when the admin
// hasn't uploaded a logo (the logo image replaces the whole brand row mark).
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
          left: size * 0.34,
          top: size * 0.68,
          width: size * 0.66,
          height: size * 0.3,
          borderRadius: size * 0.33,
          backgroundColor: colors.primary,
          opacity: 0.32,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.08,
          top: size * 0.08,
          width: size * 0.5,
          height: size * 0.5,
          borderRadius: size * 0.07,
          backgroundColor: colors.primary,
          transform: [{ rotate: "30deg" }],
        }}
      />
    </View>
  );
}
