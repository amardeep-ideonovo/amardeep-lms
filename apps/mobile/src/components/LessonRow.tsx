// Shared web-parity lesson row: "Lesson N" · thumbnail · title · duration, plus
// a trailing state control and a highlight for the current lesson. One row for
// the Class accordion, the Course "Lessons" panel, and the Lesson sidebar.
//
//   state "resume"    -> current, started      -> RESUME pill + neutral highlight
//   state "start"     -> current, not started  -> START pill  (no row highlight)
//   state "completed" -> done                  -> teal check circle
//   state "todo"      -> not reached yet        -> muted play circle
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { Press } from "./Press";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

export type LessonRowState = "resume" | "start" | "completed" | "todo";

export function LessonRow({
  lessonNumber,
  title,
  durationLabel,
  thumbnailUrl,
  state,
  onPress,
  first,
}: {
  lessonNumber?: number; // "Lesson N" label; omit to hide (sidebar variant)
  title: string;
  durationLabel?: string | null; // preformatted, e.g. "10:20"
  thumbnailUrl?: string | null;
  state: LessonRowState;
  onPress: () => void;
  first?: boolean; // suppresses the top divider on the first row of a group
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  // Only a STARTED-not-finished lesson gets the highlight; a not-started "start"
  // row (incl. the very first lesson when nothing's begun) is not highlighted.
  const current = state === "resume";

  return (
    <Press
      style={[
        styles.row,
        current ? styles.rowCurrent : !first && styles.rowDivided,
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      {lessonNumber != null ? (
        <Text style={styles.number}>Lesson {lessonNumber}</Text>
      ) : null}

      {thumbnailUrl ? (
        <Image source={{ uri: thumbnailUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Ionicons name="play" size={12} color={colors.textMuted} />
        </View>
      )}

      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {durationLabel ? (
          <Text style={styles.duration}>{durationLabel}</Text>
        ) : null}
      </View>

      {state === "resume" ? (
        <LinearGradient
          colors={[colors.ctaStart, colors.ctaEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.2 }}
          style={styles.pill}
        >
          <Text style={styles.pillText}>RESUME</Text>
        </LinearGradient>
      ) : state === "start" ? (
        <View style={styles.pillMuted}>
          <Text style={styles.pillMutedText}>START</Text>
        </View>
      ) : state === "completed" ? (
        <View style={[styles.stateCircle, styles.stateDone]}>
          <Ionicons name="checkmark" size={15} color={colors.success} />
        </View>
      ) : (
        <View style={[styles.stateCircle, styles.stateTodo]}>
          <Ionicons name="play" size={11} color={colors.textMuted} />
        </View>
      )}
    </Press>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm + 3,
      paddingVertical: spacing.sm + 3,
    },
    rowDivided: {
      borderTopWidth: 1,
      borderTopColor: colors.borderSoft,
    },
    rowCurrent: {
      // Subtle neutral wash — lighter/distinct from the mint (successBg) course
      // head; the teal left border carries the "current" affordance.
      backgroundColor: colors.surfaceMuted,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      borderRadius: 8,
      marginHorizontal: -spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    number: {
      minWidth: 52,
      color: colors.textMuted,
      fontSize: 11.5,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    thumb: {
      width: 50,
      height: 36,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
    },
    thumbEmpty: { alignItems: "center", justifyContent: "center" },
    main: { flex: 1, minWidth: 0 },
    title: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "600",
      lineHeight: 17,
      fontFamily: fonts.semibold,
    },
    duration: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
      fontFamily: fonts.regular,
    },
    pill: {
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 13,
    },
    pillText: {
      color: colors.onCta,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.4,
      fontFamily: fonts.bold,
    },
    pillMuted: {
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 13,
      backgroundColor: colors.surfaceMuted,
    },
    pillMutedText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.4,
      fontFamily: fonts.bold,
    },
    stateCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    stateDone: { backgroundColor: colors.successBg },
    stateTodo: { backgroundColor: colors.surfaceMuted },
  });
