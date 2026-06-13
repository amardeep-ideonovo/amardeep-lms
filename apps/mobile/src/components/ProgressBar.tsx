import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

// Course progress bar: completed / total lessons. Renders nothing when empty.
export function ProgressBar({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const styles = useStyles(makeStyles);
  if (!total) return null;
  const pct = Math.min(100, Math.round((completed / total) * 100));
  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.label}>
        {completed} / {total} lessons · {pct}%
      </Text>
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  track: {
    height: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    overflow: "hidden",
  },
  fill: { height: "100%", backgroundColor: colors.primary, borderRadius: 999 },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    fontFamily: fonts.regular,
  },
});
