// Course page — Ink Hero, web-parity layout: a full-bleed photo hero (breadcrumb
// + title + "N lessons · M of video" + progress ring) with the mint "Lessons"
// panel overlapping up into it, web-style lesson rows (duration + RESUME/START/
// play + current-lesson highlight), and a navy "Your progress" card. Data /
// query / seed logic is unchanged from the previous screen.
import React, { useMemo } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LessonDTO } from "@lms/types";

import { useCourseLessons, useCourses, useRefreshOnFocus } from "../queries";
import { Loading, ErrorState, EmptyState } from "../components/Screen";
import { PopupHost } from "../components/PopupHost";
import { Skeleton } from "../components/Skeleton";
import { ProgressRing } from "../components/ProgressRing";
import { HeroScaffold, HERO_OVERLAP } from "../components/HeroScaffold";
import { HeroBackButton } from "../components/HeroBackButton";
import { LessonRow } from "../components/LessonRow";
import type { LessonRowState } from "../components/LessonRow";
import { Press } from "../components/Press";
import { fmtTotalDuration } from "../format";
import { lessonSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

// "10:20" — per-lesson duration clock.
function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const totalSeconds = lessons
    ? lessons.reduce((a, l) => a + (l.durationSeconds ?? 0), 0)
    : 0;
  const durationLabel = fmtTotalDuration(totalSeconds);
  const heroMeta = [
    total > 0 ? `${total} lesson${total === 1 ? "" : "s"}` : null,
    durationLabel ? `${durationLabel} of video` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hero = (
    <HeroScaffold
      variant="photo"
      imageUrl={coverImageUrl}
      gradientSeed={courseId}
      overlapReserve={66}
    >
      <Text style={styles.crumbs} numberOfLines={1}>
        Dashboard{heroTitle ? `  ›  ${heroTitle}` : ""}
      </Text>
      <View style={styles.heroRow}>
        <View style={styles.heroGrow}>
          <Text style={styles.heroTitle}>{heroTitle}</Text>
          {heroMeta ? <Text style={styles.heroMeta}>{heroMeta}</Text> : null}
        </View>
        {total > 0 ? (
          <ProgressRing
            size={64}
            stroke={7}
            pct={pct}
            color={colors.primary}
            trackColor="rgba(255,255,255,0.15)"
            label={`${pct}%`}
            labelColor={colors.heroText}
            labelSize={15}
          />
        ) : null}
      </View>
    </HeroScaffold>
  );

  const goBack = () => navigation.goBack();

  if (lessonsQuery.isError && !lessons)
    return (
      <>
        <HeroBackButton onPress={goBack} tone="onLight" />
        <ErrorState
          message={
            lessonsQuery.error instanceof Error
              ? lessonsQuery.error.message
              : "Could not load lessons."
          }
          onRetry={() => lessonsQuery.refetch()}
        />
      </>
    );

  // Nothing fetched yet. With a seed the member keeps looking at the cover and
  // progress they just tapped while the lesson rows fill in.
  if (!lessons) {
    if (!seed) {
      return (
        <>
          <HeroBackButton onPress={goBack} tone="onLight" />
          <Loading />
        </>
      );
    }
    return (
      <>
        <HeroBackButton onPress={goBack} />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          {hero}
          <View style={styles.body}>
            <View style={styles.card}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  height={44}
                  radius={10}
                  style={{ marginBottom: spacing.sm }}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      </>
    );
  }

  if (lessons.length === 0) {
    return (
      <>
        <HeroBackButton onPress={goBack} />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          {hero}
          <View style={styles.body}>
            <View style={styles.card}>
              <EmptyState message="This course has no lessons yet." />
            </View>
          </View>
        </ScrollView>
      </>
    );
  }

  const firstIncomplete = lessons.findIndex((l) => !l.completed);
  const allDone = completed === total && total > 0;
  const anyStarted = lessons.some((l) => l.completed || l.started);
  const statusLabel = allDone
    ? "Completed"
    : anyStarted
      ? "In progress"
      : "Not started";
  const currentLesson =
    firstIncomplete >= 0 ? lessons[firstIncomplete] : lessons[0];
  const resumeLabel = allDone
    ? "Review lessons"
    : anyStarted
      ? "Resume course"
      : "Start course";

  const rowState = (l: LessonDTO, i: number): LessonRowState =>
    l.completed
      ? "completed"
      : i === firstIncomplete
        ? l.started
          ? "resume"
          : "start"
        : "todo";

  const openLesson = (l: LessonDTO) =>
    navigation.navigate("Lesson", {
      lessonId: l.id,
      title: l.title,
      seed: lessonSeed(l),
    });

  return (
    <>
      <PopupHost context={{ type: "courses" }} />
      <HeroBackButton onPress={goBack} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {hero}

        <View style={styles.body}>
          {/* ---- "Lessons" panel (mint header + web-style rows) ---- */}
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              {coverImageUrl ? (
                <Image
                  source={{ uri: coverImageUrl }}
                  style={styles.panelThumb}
                />
              ) : (
                <View style={[styles.panelThumb, styles.panelThumbEmpty]} />
              )}
              <View style={styles.panelHeadMain}>
                <Text style={styles.panelTitle}>Lessons</Text>
                {heroMeta ? (
                  <Text style={styles.panelMeta}>{heroMeta}</Text>
                ) : null}
              </View>
              <Text
                style={[
                  styles.statusPill,
                  statusLabel === "Not started" && styles.statusPillMuted,
                ]}
              >
                {statusLabel}
              </Text>
            </View>

            <View style={styles.lessonList}>
              {lessons.map((l, i) => (
                <LessonRow
                  key={l.id}
                  first={i === 0}
                  lessonNumber={i + 1}
                  title={l.title}
                  durationLabel={
                    l.durationSeconds ? fmtClock(l.durationSeconds) : null
                  }
                  thumbnailUrl={l.thumbnailUrl}
                  state={rowState(l, i)}
                  onPress={() => openLesson(l)}
                />
              ))}
            </View>
          </View>

          {/* ---- "Your progress" navy card ---- */}
          <View style={styles.progress}>
            <View style={styles.progressTop}>
              <ProgressRing
                size={60}
                stroke={7}
                pct={pct}
                color={colors.primary}
                trackColor="rgba(255,255,255,0.14)"
                label={`${pct}%`}
                labelColor="#ffffff"
                labelSize={14}
              />
              <View style={styles.progressInfo}>
                <Text style={styles.progressTitle}>Your progress</Text>
                <Text style={styles.progressText}>
                  {allDone
                    ? `All ${total} lessons complete — nicely done.`
                    : `${completed} of ${total} lessons complete.`}
                </Text>
              </View>
            </View>
            <Press
              style={styles.progressBtn}
              accessibilityRole="button"
              onPress={() => openLesson(currentLesson)}
            >
              <Text style={styles.progressBtnText}>{resumeLabel}</Text>
            </Press>
          </View>

          <View style={styles.spacer} />
        </View>
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: 0 },
    body: {
      paddingHorizontal: spacing.md,
      marginTop: -HERO_OVERLAP,
      ...contentColumn,
    },
    // Generic surface card (loading skeleton / empty states).
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    // ---- hero band content ----
    crumbs: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 12,
      fontFamily: fonts.regular,
    },
    heroRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: spacing.md,
      marginTop: spacing.sm + 2,
    },
    heroGrow: { flex: 1 },
    heroTitle: {
      color: colors.heroText,
      fontSize: 26,
      fontWeight: "800",
      lineHeight: 31,
      fontFamily: fonts.display,
    },
    heroMeta: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 13.5,
      marginTop: 6,
      fontFamily: fonts.medium,
    },
    // ---- lessons panel ----
    panel: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: spacing.md,
    },
    // Mint header strip (web's pale-teal course head).
    panelHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm + 4,
      padding: spacing.md,
      backgroundColor: colors.successBg,
    },
    panelThumb: {
      width: 54,
      height: 42,
      borderRadius: 9,
      backgroundColor: colors.surfaceMuted,
    },
    panelThumbEmpty: {},
    panelHeadMain: { flex: 1, minWidth: 0 },
    panelTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    panelMeta: {
      color: colors.primarySoft,
      fontSize: 12,
      marginTop: 2,
      fontFamily: fonts.regular,
    },
    statusPill: {
      color: colors.text,
      backgroundColor: colors.surface,
      fontSize: 11,
      fontWeight: "700",
      fontFamily: fonts.bold,
      overflow: "hidden",
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 12,
    },
    statusPillMuted: { color: colors.textMuted },
    lessonList: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
    // ---- progress card (compact: ring beside the copy) ----
    progress: {
      backgroundColor: colors.inkCard,
      borderRadius: 16,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    progressTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    progressInfo: { flex: 1, minWidth: 0 },
    progressTitle: {
      color: "#ffffff",
      fontSize: 15,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    progressText: {
      color: "rgba(255,255,255,0.56)",
      fontSize: 12.5,
      lineHeight: 18,
      marginTop: 3,
      fontFamily: fonts.regular,
    },
    progressBtn: {
      alignSelf: "stretch",
      alignItems: "center",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.25)",
      borderRadius: 10,
      paddingVertical: 12,
      marginTop: spacing.md,
    },
    progressBtnText: {
      color: "#ffffff",
      fontSize: 13,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    spacer: { height: spacing.lg },
  });
