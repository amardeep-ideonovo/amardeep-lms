import React, { useRef } from "react";
import { Animated, Pressable } from "react-native";
import type {
  GestureResponderEvent,
  PressableProps,
  StyleProp,
  ViewStyle,
} from "react-native";

// A Pressable with a springy scale-down on press — the native echo of the web
// `.press` interaction. Wrap primary buttons / CTAs. The inner Animated.View
// carries the transform (driven on the native thread) so the Pressable touch
// target keeps its layout; `style` is applied to that inner view.
type Props = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children?: React.ReactNode;
};

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
  return (
    <Pressable
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
      <Animated.View style={[{ transform: [{ scale }] }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
