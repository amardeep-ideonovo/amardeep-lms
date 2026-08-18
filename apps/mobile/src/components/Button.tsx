// Shared secondary / ghost / danger button — the non-gradient siblings of
// CtaButton. Before this, every screen hand-rolled these three with divergent
// padding/radius/border (audit: retry, btnSecondary, buttonGhost, ghostBtn all
// differed), and none set accessibilityRole. This normalizes the look and bakes
// the button role + label in, the way CtaButton already does for the primary CTA.
//
// The PRIMARY (teal gradient) CTA still lives in CtaButton — use that for the
// marquee action; use this for the quieter secondary/ghost/destructive ones.
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

import type { ThemePalette } from "../theme";
import { fonts, onColor } from "../theme";
import { useScopedTheme } from "./PageScope";
import { Press } from "./Press";

export type ButtonVariant = "secondary" | "ghost" | "danger";

export function Button({
  label,
  onPress,
  variant = "secondary",
  icon,
  disabled = false,
  busy = false,
  block = false,
  style,
  textStyle,
  colors: colorsOverride,
  borderColor,
  radius = 12,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  /** Stretch to the container width (else content-width). */
  block?: boolean;
  /** Outer layout overrides (margins, width, alignSelf). */
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /**
   * Border override for secondary/ghost — e.g. a light hairline when the button
   * sits on a dark ink card, where the theme's `border` would vanish.
   */
  borderColor?: string;
  /**
   * Palette override for screens that theme from a fixed local palette instead
   * of the provider (the pre-instance onboarding screens). Defaults to the
   * scoped/app theme.
   */
  colors?: ThemePalette;
  radius?: number;
  accessibilityLabel?: string;
}) {
  const scoped = useScopedTheme();
  const colors = colorsOverride ?? scoped.colors;

  const surface: ViewStyle =
    variant === "danger"
      ? { backgroundColor: colors.danger }
      : variant === "ghost"
        ? {
            backgroundColor: "transparent",
            borderWidth: 1,
            borderColor: borderColor ?? colors.border,
          }
        : {
            backgroundColor: colors.surfaceMuted,
            borderWidth: 1,
            borderColor: borderColor ?? colors.borderSoft,
          };

  const labelColor =
    variant === "danger" ? onColor(colors.danger) : colors.text;

  return (
    <Press
      style={[
        { borderRadius: radius },
        block ? styles.block : styles.inline,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      hitSlop={8}
    >
      <View style={[styles.body, surface, { borderRadius: radius }]}>
        {busy ? (
          <ActivityIndicator color={labelColor} />
        ) : (
          <View style={styles.row}>
            {icon}
            <Text style={[styles.label, { color: labelColor }, textStyle]}>
              {label}
            </Text>
          </View>
        )}
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  inline: { alignSelf: "flex-start" },
  block: { alignSelf: "stretch" },
  body: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: { fontSize: 15, fontFamily: fonts.semibold },
  disabled: { opacity: 0.55 },
});
