import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { CourseCard } from "@lms/types";

import { ProgressBar } from "./ProgressBar";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

// A single course card: thumbnail, title, description, progress, lock state.
// Shared by the Dashboard (flat mode) and the CourseList screen.
export function CourseRow({
  course,
  onPress,
}: {
  course: CourseCard;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const locked = course.locked;
  return (
    <TouchableOpacity
      style={[styles.card, locked && styles.cardLocked]}
      onPress={onPress}
      disabled={locked}
      activeOpacity={0.8}
    >
      <View style={styles.cardRow}>
        {course.thumbnailUrl ? (
          <Image source={{ uri: course.thumbnailUrl }} style={styles.thumb} />
        ) : null}
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, locked && styles.lockedText]}>
            {course.title}
          </Text>
          {course.description ? (
            <Text style={styles.cardDesc} numberOfLines={2}>
              {course.description}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.indicator, locked && styles.lockedText]}>
          {locked ? "🔒" : "›"}
        </Text>
      </View>
      {!locked && course.lessonCount > 0 ? (
        <ProgressBar
          completed={course.completedCount}
          total={course.lessonCount}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardRow: { flexDirection: "row", alignItems: "center" },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  cardLocked: { opacity: 0.6 },
  cardText: { flex: 1, paddingRight: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardDesc: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xs },
  indicator: { color: colors.text, fontSize: 18 },
  lockedText: { color: colors.locked },
});
