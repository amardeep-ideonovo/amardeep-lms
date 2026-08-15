// Primary CTA on the teal gradient (design --teal-grad + --shadow-cta). Used
// for the Home Resume button, Mark-as-complete, auth submits, cert downloads.
// Renders a Press-wrapped LinearGradient; pass `style` for width/margins.
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import type { Theme } from "../theme";
import { useScopedStyles, useScopedTheme } from "./PageScope";
import { Press } from "./Press";

export function CtaButton({
  label,
  onPress,
  icon,
  disabled,
  busy,
  style,
  textStyle,
  radius = 10,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  radius?: number;
}) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  return (
    <Press
      style={[{ borderRadius: radius }, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={typeof label === "string" ? label : undefined}
      accessibilityState={{ disabled: disabled || busy, busy }}
      hitSlop={8}
    >
      <LinearGradient
        colors={[colors.ctaStart, colors.ctaEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.18 }}
        style={[styles.grad, { borderRadius: radius }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onCta} />
        ) : (
          <View style={styles.row}>
            {icon}
            <Text style={[styles.label, textStyle]}>{label}</Text>
          </View>
        )}
      </LinearGradient>
    </Press>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    grad: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
      // CTA glow (iOS; Android elevation is skipped — it needs an opaque
      // bg and the gradient wrapper has none). colors.primary so the glow
      // tracks the brand accent (the old #30b895 literal was the pre-Spark
      // teal and stayed teal on recolored instances).
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    // Spark rule: labels on the teal CTA gradient are INK, not white — onCta
    // resolves against the lighter gradient stop (theme.ts).
    label: { color: colors.onCta, fontSize: 12.5, fontFamily: fonts.semibold },
    disabled: { opacity: 0.55 },
  });
