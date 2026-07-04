import React, { useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  ViewStyle,
} from "react-native";

// A Pressable with a springy scale-down on press — the native echo of the web
// `.press` interaction. Wrap primary buttons / CTAs.
type Props = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children?: React.ReactNode;
};

// Box / positioning props must live on the OUTER Pressable so <Press> occupies
// the same space in its parent as the styled view it replaces. If they rode on
// the inner Animated.View instead, a full-width `alignSelf:"stretch"` button
// inside a center-aligned container would collapse to its content width (the
// Pressable would shrink-wrap). Everything else — background, padding, border,
// radius, content alignment — plus the scale transform rides on the inner view
// that actually animates.
const LAYOUT_KEYS = new Set<string>([
  "alignSelf",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "marginStart",
  "marginEnd",
  "position",
  "top",
  "bottom",
  "left",
  "right",
  "start",
  "end",
  "zIndex",
]);

export function Press({
  style,
  scaleTo = 0.96,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 50,
      bounciness: 6,
    }).start();

  // Split the style: layout/box props position the Pressable in its parent; the
  // rest + the press transform ride on the inner Animated.View that scales.
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const k of Object.keys(flat)) {
    (LAYOUT_KEYS.has(k) ? outer : inner)[k] = flat[k];
  }

  return (
    <Pressable
      style={outer as ViewStyle}
      onPressIn={(e: GestureResponderEvent) => {
        animate(scaleTo);
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        animate(1);
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[inner as ViewStyle, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
