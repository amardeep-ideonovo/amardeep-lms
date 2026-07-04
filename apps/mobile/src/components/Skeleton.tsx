// Pulsing placeholder block for first loads — screens compose row/tile-shaped
// layouts from these instead of a full-screen spinner.
import React, { useEffect, useRef } from "react";
import { Animated } from "react-native";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";

import { useScopedTheme } from "./PageScope";

export function Skeleton({
  width = "100%",
  height,
  radius = 10,
  style,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useScopedTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.surfaceMuted, opacity },
        style,
      ]}
    />
  );
}
