// Gated-content panel: lock glyph + explanation + a deliberately NEUTRAL
// secondary CTA (App Store rules — no purchase buttons, no prices; membership
// changes happen on the web).
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { Theme } from "../theme";
import { useScopedStyles } from "./PageScope";

export function LockedPanel({
  title,
  message,
  note,
  ctaLabel,
  onPress,
}: {
  title: string;
  message: string;
  note?: string;
  ctaLabel?: string;
  onPress?: () => void;
}) {
  const styles = useScopedStyles(makeStyles);
  return (
    <View style={styles.panel}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {ctaLabel && onPress ? (
        <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onPress}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const makeStyles = ({ colors, spacing, fonts }: Theme) =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.lg,
      alignItems: "center",
      gap: spacing.sm,
    },
    lock: { fontSize: 28 },
    title: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textAlign: "center",
    },
    message: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 21,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
    cta: {
      marginTop: spacing.xs,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 999,
      paddingVertical: 10,
      paddingHorizontal: 18,
    },
    ctaText: { color: colors.text, fontSize: 14, fontWeight: "700", fontFamily: fonts.bold },
    note: {
      color: colors.textMuted,
      fontSize: 12.5,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
  });
