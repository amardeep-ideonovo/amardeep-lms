// Pill-shaped labels: Chip (category/status tags) and Badge (Chip with a
// leading glyph, e.g. "✓ Enrolled"). Tones map to the semantic theme tokens.
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { Theme } from "../theme";
import { useScopedStyles, useScopedTheme } from "./PageScope";

type Tone = "default" | "success" | "warning";

export function Chip({
  label,
  tone = "default",
  onHero,
}: {
  label: string;
  tone?: Tone;
  // Over a HeroBand image/scrim the default tone uses light text.
  onHero?: boolean;
}) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  const box =
    tone === "success"
      ? { backgroundColor: colors.successBg, borderColor: "transparent" }
      : tone === "warning"
        ? { backgroundColor: colors.warningBg, borderColor: "transparent" }
        : null;
  const text =
    tone === "success"
      ? { color: colors.success }
      : tone === "warning"
        ? { color: colors.warning }
        : onHero
          ? { color: colors.heroTextSoft }
          : null;
  return (
    <View style={[styles.chip, box]}>
      <Text style={[styles.chipText, text]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Badge({ label, icon = "✓" }: { label: string; icon?: string }) {
  return <Chip label={`${icon} ${label}`} tone="success" />;
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    chip: {
      alignSelf: "flex-start",
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 11,
      backgroundColor: colors.chipBg,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    chipText: {
      color: colors.textMuted,
      fontSize: 11.5,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
  });
