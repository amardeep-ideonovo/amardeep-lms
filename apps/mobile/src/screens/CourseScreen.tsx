import React, { useMemo } from "react";
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useCourseLessons, useCourses, useRefreshOnFocus } from "../queries";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { ProgressBar } from "../components/ProgressBar";
import { PopupHost } from "../components/PopupHost";
import { Skeleton } from "../components/Skeleton";
import { lessonSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

export function CourseScreen({ route, navigation }: ScreenProps<"Course">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  // `seed` is the row the member tapped (see navigation.ts) — cover + title +
  // progress counts, used ONLY to paint the header before the fetch lands. It
  // never enters `lessons`/`course`, so it can't stand in for real data.
  const { courseId, seed } = route.params;

  const lessonsQuery = useCourseLessons(courseId);
  // react-query keeps the last list across refetches, so backing out of a lesson
  // never drops it to a spinner and a failed refresh keeps good content. Sorted
  // for display; the shared cache holds it unsorted.
  const lessons = useMemo(
    () =>
      lessonsQuery.data
        ? [...lessonsQuery.data].sort((a, b) => a.order - b.order)
        : null,
    [lessonsQuery.data],
  );
  // Cover image / title are decorative — best-effort, never blocks lessons.
  const coursesQuery = useCourses();
  const course = coursesQuery.data?.find((c) => c.id === courseId) ?? null;

  // Refetch on focus so completing a lesson and returning updates progress. The
  // completion also writes this lesson's ✓ straight into the course-lessons
  // cache, so the row is already ticked on return — this reconciles counts.
  useRefreshOnFocus(() => {
    void lessonsQuery.refetch();
    void coursesQuery.refetch();
  });

  // Server data wins the moment it arrives; the seed only fills the gap.
  const coverImageUrl = course?.coverImageUrl ?? seed?.coverImageUrl ?? null;
  const heroTitle = course?.title ?? seed?.title ?? "";
  const completed = lessons
    ? lessons.filter((l) => l.completed).length
    : (seed?.completedCount ?? 0);
  const total = lessons ? lessons.length : (seed?.lessonCount ?? 0);

  const header = (
    <View>
      {coverImageUrl ? (
        // Cinematic hero: cover + bottom scrim + overlaid title. Without a
        // cover the nav header title carries the screen alone.
        <View style={styles.hero}>
          <Image
            source={{ uri: coverImageUrl }}
            style={styles.cover}
            resizeMode="cover"
          />
          <LinearGradient
            colors={[colors.overlayFaint, colors.overlayStrong]}
            style={StyleSheet.absoluteFill}
          />
          <Text style={styles.heroTitle} numberOfLines={2}>
            {heroTitle}
          </Text>
        </View>
      ) : null}
      <View style={styles.progressHeader}>
        <Text style={styles.progressTitle}>Course progress</Text>
        <ProgressBar completed={completed} total={total} />
      </View>
    </View>
  );

  if (lessonsQuery.isError && !lessons)
    return (
      <ErrorState
        message={
          lessonsQuery.error instanceof Error
            ? lessonsQuery.error.message
            : "Could not load lessons."
        }
        onRetry={() => lessonsQuery.refetch()}
      />
    );

  // Nothing fetched yet. With a seed the member keeps looking at the cover and
  // progress they just tapped while the lesson rows fill in.
  if (!lessons) {
    if (!seed) return <Loading />;
    return (
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        {header}
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            height={76}
            radius={12}
            style={styles.skeletonRow}
          />
        ))}
      </ScrollView>
    );
  }

  if (lessons.length === 0) {
    return <EmptyState message="This course has no lessons yet." />;
  }

  return (
    <>
      <PopupHost context={{ type: "courses" }} />
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={lessons}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.8}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate("Lesson", {
                lessonId: item.id,
                title: item.title,
                seed: lessonSeed(item),
              })
            }
          >
            <View style={styles.numberBadge}>
              <Text style={styles.numberText}>{index + 1}</Text>
            </View>
            {item.thumbnailUrl ? (
              <Image
                source={{ uri: item.thumbnailUrl }}
                style={styles.rowThumb}
              />
            ) : (
              <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
                <Text style={styles.rowThumbGlyph}>▶</Text>
              </View>
            )}
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {item.completed ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
        )}
      />
    </>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, ...contentColumn },
    skeletonRow: { marginBottom: spacing.sm },
    hero: {
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: spacing.sm,
    },
    cover: {
      width: "100%",
      aspectRatio: 16 / 9,
      backgroundColor: colors.surfaceMuted,
    },
    heroTitle: {
      position: "absolute",
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.md,
      color: colors.heroText,
      fontSize: 24,
      fontWeight: "800",
      fontFamily: fonts.display,
    },
    progressHeader: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    progressTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    numberBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.chipBg,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.sm,
    },
    numberText: {
      color: colors.text,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    rowThumb: {
      width: 44,
      height: 44,
      borderRadius: 8,
      marginRight: spacing.md,
      backgroundColor: colors.surfaceMuted,
    },
    rowThumbEmpty: { alignItems: "center", justifyContent: "center" },
    rowThumbGlyph: {
      color: colors.textMuted,
      fontSize: 16,
      fontFamily: fonts.regular,
    },
    rowTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      fontWeight: "500",
      fontFamily: fonts.medium,
    },
    check: {
      color: colors.success,
      fontSize: 18,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
  });
