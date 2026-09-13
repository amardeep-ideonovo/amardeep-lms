// Floating back chevron for pushed screens whose header is a full-bleed hero
// (Class / Course / Lesson) — those set headerShown:false, so this replaces the
// native back button. Sits over the dark hero with a translucent scrim puck and
// respects the safe-area top inset (it floats under the notch/Dynamic Island).
// The OS back-swipe still works; this is the tappable affordance.
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { Press } from "./Press";
import { spacing } from "../theme";

export function HeroBackButton({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.wrap, { top: insets.top + 6 }]}
      pointerEvents="box-none"
    >
      <Press
        style={styles.button}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color="#ffffff" />
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    zIndex: 10,
  },
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    // Translucent ink puck so the chevron reads on any hero photo; the border is
    // a hairline lift. Mode-independent (heroes are always dark).
    backgroundColor: "rgba(20,16,40,0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
});
