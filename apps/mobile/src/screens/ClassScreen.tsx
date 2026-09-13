// Class landing page — native mirror of the web's /classes/[slug]: full-bleed
// photo hero (breadcrumb + category + title + meta + progress ring), a course
// accordion (mint head + inline lesson rows), a compact navy progress card, and
// the skills grid. DELIBERATELY diverges from the web for non-owners: no "Get
// Class", no prices, no checkout handoff — store rules (Apple 3.1.1 / Google
// Play payments) forbid steering members to a web purchase, so unowned classes
// get the LockedPanel instead (same pattern as LessonScreen).
import React, { useRef } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type {
  ClassCertificateStatusDTO,
  ClassCourseDTO,
  ClassCourseLessonDTO,
} from "@lms/types";

import { useClassPage, useMyClassCourses } from "../queries";
import { fmtTotalDuration, vimeoEmbed, stripHtml } from "../format";
import { ErrorState } from "../components/Screen";
import { LockedPanel } from "../components/LockedPanel";
import { PopupHost } from "../components/PopupHost";
import { Chip } from "../components/Chip";
import { Skeleton } from "../components/Skeleton";
import { VideoPlayerView } from "../components/VideoPlayerView";
import CertificateClaim from "../components/CertificateClaim";
import { ProgressRing } from "../components/ProgressRing";
import { Press } from "../components/Press";
import { HeroScaffold, HERO_OVERLAP } from "../components/HeroScaffold";
import { HeroBackButton } from "../components/HeroBackButton";
import { LessonRow } from "../components/LessonRow";
import type { LessonRowState } from "../components/LessonRow";
import { courseSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import { contentColumn, useContentLayout } from "../responsive";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

type Ownership = {
  owned: boolean;
  courses: ClassCourseDTO[];
  certificate?: ClassCertificateStatusDTO | null;
};

// "10:20" — per-lesson duration clock.
function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ClassScreen({ route, navigation }: ScreenProps<"Class">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { contentWidth, isWide } = useContentLayout();
  // `seed` is the class card the member tapped (see navigation.ts): name +
  // artwork only. Ownership, prices and courses are never seeded — they decide
  // access, so they always come from the fetch below.
  const { slugOrId, seed } = route.params;

  const pageQuery = useClassPage(slugOrId);
  const ownQuery = useMyClassCourses(slugOrId);
  const cls = pageQuery.data ?? null;
  // Ownership is best-effort: a failure reads as "not owned" (marketing view),
  // but it stays NULL while still loading so the skeleton holds — the owner
  // branch must never flash the buy card before we know (same rule as the web's
  // ClassMemberArea). react-query keeps both across refetches, so a refocus or a
  // failed refresh never wipes rendered content either.
  const ownership: Ownership | null =
    ownQuery.data ?? (ownQuery.isError ? { owned: false, courses: [] } : null);

  const scrollRef = useRef<ScrollView>(null);
  const trailerY = useRef(0);

  const goBack = () => navigation.goBack();

  if (pageQuery.isError && !cls)
    return (
      <>
        <HeroBackButton onPress={goBack} tone="onLight" />
        <ErrorState
          message="Class not found."
          onRetry={() => pageQuery.refetch()}
        />
      </>
    );

  // First paint: carry the tapped card's cover + title through the hero so it's
  // continuous, and hold skeletons for the ownership-dependent body.
  if (!cls || !ownership) {
    return (
      <>
        <HeroBackButton onPress={goBack} />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <HeroScaffold
            variant="photo"
            imageUrl={seed?.imageUrl}
            gradientSeed={slugOrId}
            overlapReserve={66}
          >
            {seed?.name ? (
              <Text style={styles.heroTitle}>{seed.name}</Text>
            ) : (
              <Skeleton height={26} width="60%" radius={8} />
            )}
          </HeroScaffold>
          <View style={styles.body}>
            <Skeleton height={120} radius={16} />
            <Skeleton height={120} radius={16} />
          </View>
        </ScrollView>
      </>
    );
  }

  const { owned, courses } = ownership;
  const progress = owned
    ? courses.reduce(
        (acc, c) => ({
          done: acc.done + c.completedCount,
          total: acc.total + c.lessonCount,
        }),
        { done: 0, total: 0 },
      )
    : null;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  const duration = fmtTotalDuration(cls.totalDurationSeconds);
  const meta = [
    `${cls.lessonCount} lesson${cls.lessonCount === 1 ? "" : "s"}`,
    duration ? `${duration} of video` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const trailer = cls.trailerUrl ? vimeoEmbed(cls.trailerUrl) : null;
  const trailerHeight = ((contentWidth - 32) * 9) / 16;

  // The next lesson to resume across the class's courses (first incomplete),
  // for the "Your progress" card's Continue button. Falls back to the first
  // course when lesson rows aren't loaded yet.
  const allLessons = courses.flatMap((c) =>
    (c.lessons ?? []).map((l) => ({ lesson: l, courseId: c.id })),
  );
  const nextLesson =
    allLessons.find((x) => !x.lesson.completed) ?? allLessons[0] ?? null;
  const onContinue = () => {
    if (nextLesson) {
      const l = nextLesson.lesson;
      navigation.navigate("Lesson", {
        lessonId: l.id,
        title: l.title,
        seed: {
          title: l.title,
          thumbnailUrl: l.thumbnailUrl,
          durationSeconds: l.durationSeconds,
        },
      });
    } else if (courses[0]) {
      navigation.navigate("Course", {
        courseId: courses[0].id,
        title: courses[0].title,
        seed: courseSeed(courses[0]),
      });
    }
  };

  const scrollToTrailer = () =>
    scrollRef.current?.scrollTo({ y: trailerY.current, animated: true });

  const lessonState = (
    l: ClassCourseLessonDTO,
    i: number,
    firstIncomplete: number,
  ): LessonRowState =>
    l.completed
      ? "completed"
      : i === firstIncomplete
        ? l.started
          ? "resume"
          : "start"
        : "todo";

  const skillsSection =
    cls.skills.length > 0 ? (
      <View style={styles.section}>
        <Text style={styles.eyebrow}>Curriculum</Text>
        <Text style={styles.sectionTitle}>Skills You&rsquo;ll Learn</Text>
        <View style={styles.skillsGrid}>
          {cls.skills.map((skill, i) => (
            <View
              key={`${skill.title}-${i}`}
              style={[styles.skillCard, isWide && styles.skillCardWide]}
            >
              {skill.imageUrl ? (
                <Image
                  source={{ uri: skill.imageUrl }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : null}
              <View style={styles.skillNum}>
                <Text style={styles.skillNumText}>{i + 1}</Text>
              </View>
              <View style={styles.skillTitleWrap}>
                <Text style={styles.skillTitle} numberOfLines={2}>
                  {skill.title}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    ) : null;

  return (
    <>
      <PopupHost context={{ type: "classes" }} />
      <HeroBackButton onPress={goBack} />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <HeroScaffold
          variant="photo"
          imageUrl={cls.imageUrl}
          gradientSeed={cls.id}
          overlapReserve={66}
        >
          <Text style={styles.crumbs} numberOfLines={1}>
            My Classes <Text style={styles.crumbOn}>{`  ›  ${cls.name}`}</Text>
          </Text>
          {cls.categories.length > 0 ? (
            <View style={styles.heroChips}>
              {cls.categories.map((c) => (
                <Chip key={c.id} label={c.name} onHero />
              ))}
            </View>
          ) : null}
          <View style={styles.heroRow}>
            <View style={styles.heroGrow}>
              <Text style={styles.heroTitle}>{cls.name}</Text>
              {meta ? <Text style={styles.heroMeta}>{meta}</Text> : null}
            </View>
            {owned && progress && progress.total > 0 ? (
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

        <View style={styles.body}>
          {owned ? (
            <>
              {ownership.certificate &&
              (ownership.certificate.eligible ||
                ownership.certificate.claimed) ? (
                <CertificateClaim status={ownership.certificate} />
              ) : null}

              {courses.length === 0 ? (
                <Text style={styles.empty}>No courses in this class yet.</Text>
              ) : (
                courses.map((c, i) => {
                  const cLessons = c.lessons ?? [];
                  const firstIncomplete = cLessons.findIndex(
                    (l) => !l.completed,
                  );
                  const allDone =
                    c.lessonCount > 0 && c.completedCount >= c.lessonCount;
                  const started =
                    (c.startedCount ?? 0) > 0 || c.completedCount > 0;
                  const status = allDone
                    ? "Completed"
                    : started
                      ? "In progress"
                      : "Not started";
                  const cDuration = fmtTotalDuration(
                    cLessons.reduce((a, l) => a + (l.durationSeconds ?? 0), 0),
                  );
                  const cMeta = [
                    `${c.lessonCount} lesson${c.lessonCount === 1 ? "" : "s"}`,
                    cDuration,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const openCourse = () =>
                    navigation.navigate("Course", {
                      courseId: c.id,
                      title: c.title,
                      seed: courseSeed(c),
                    });
                  return (
                    <View key={c.id} style={styles.course}>
                      <View style={styles.chead}>
                        <View style={styles.ctop}>
                          <Text style={styles.cnum}>Course {i + 1}</Text>
                          <Text
                            style={[
                              styles.cpill,
                              status === "Not started" && styles.cpillMuted,
                            ]}
                          >
                            {status}
                          </Text>
                          <Text style={styles.cgo}>›</Text>
                        </View>
                        <Press
                          style={styles.cbtm}
                          onPress={openCourse}
                          accessibilityRole="button"
                        >
                          {c.thumbnailUrl ? (
                            <Image
                              source={{ uri: c.thumbnailUrl }}
                              style={styles.cthumb}
                            />
                          ) : (
                            <View style={[styles.cthumb, styles.cthumbEmpty]} />
                          )}
                          <View style={styles.cmain}>
                            <Text style={styles.cname} numberOfLines={2}>
                              {c.title}
                            </Text>
                            <Text style={styles.cmeta}>{cMeta}</Text>
                          </View>
                        </Press>
                      </View>
                      {cLessons.length > 0 ? (
                        <View style={styles.lessons}>
                          {cLessons.map((l, li) => (
                            <LessonRow
                              key={l.id}
                              first={li === 0}
                              lessonNumber={li + 1}
                              title={l.title}
                              durationLabel={
                                l.durationSeconds
                                  ? fmtClock(l.durationSeconds)
                                  : null
                              }
                              thumbnailUrl={l.thumbnailUrl}
                              state={lessonState(l, li, firstIncomplete)}
                              onPress={() =>
                                navigation.navigate("Lesson", {
                                  lessonId: l.id,
                                  title: l.title,
                                  seed: {
                                    title: l.title,
                                    thumbnailUrl: l.thumbnailUrl,
                                    durationSeconds: l.durationSeconds,
                                  },
                                })
                              }
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}

              {progress && progress.total > 0 ? (
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
                        {progress.done} of {progress.total} lessons complete.
                      </Text>
                    </View>
                  </View>
                  <Press
                    style={styles.progressBtn}
                    onPress={onContinue}
                    accessibilityRole="button"
                  >
                    <Text style={styles.progressBtnText}>
                      {progress.done > 0 ? "Continue" : "Start learning"}
                    </Text>
                  </Press>
                </View>
              ) : null}

              {skillsSection}
            </>
          ) : (
            <>
              {cls.description ? (
                <View style={styles.card}>
                  <Text style={styles.eyebrow}>About</Text>
                  <Text style={styles.aboutText}>
                    {stripHtml(cls.description)}
                  </Text>
                </View>
              ) : null}
              <View style={styles.card}>
                <LockedPanel
                  title="Not included in your membership"
                  message="Your current membership doesn't include this class."
                  note="You can manage your plan from your account settings."
                  ctaLabel={cls.trailerUrl ? "Watch the trailer" : undefined}
                  onPress={cls.trailerUrl ? scrollToTrailer : undefined}
                />
              </View>
              {skillsSection}
              {trailer || cls.trailerUrl ? (
                <View
                  style={styles.section}
                  onLayout={(e) => {
                    trailerY.current = e.nativeEvent.layout.y;
                  }}
                >
                  <Text style={styles.eyebrow}>Preview</Text>
                  <Text style={styles.sectionTitle}>Class Trailer</Text>
                  <View style={[styles.trailer, { height: trailerHeight }]}>
                    {trailer ? (
                      <WebView
                        style={StyleSheet.absoluteFill}
                        source={{ uri: trailer }}
                        allowsFullscreenVideo
                        allowsInlineMediaPlayback
                        javaScriptEnabled
                        domStorageEnabled
                      />
                    ) : (
                      <VideoPlayerView
                        style={StyleSheet.absoluteFill}
                        uri={cls.trailerUrl as string}
                      />
                    )}
                  </View>
                </View>
              ) : null}
            </>
          )}

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, spacing: sp, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: 0 },
    body: {
      paddingHorizontal: sp.md,
      marginTop: -HERO_OVERLAP,
      gap: sp.md,
      ...contentColumn,
    },
    // ---- hero content ----
    crumbs: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 12,
      fontFamily: fonts.regular,
    },
    crumbOn: { color: "rgba(255,255,255,0.82)" },
    heroChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: sp.xs,
      marginTop: sp.sm,
    },
    heroRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: sp.md,
      marginTop: sp.sm + 2,
    },
    heroGrow: { flex: 1 },
    heroTitle: {
      color: colors.heroText,
      fontSize: 28,
      fontWeight: "800",
      lineHeight: 33,
      fontFamily: fonts.display,
    },
    heroMeta: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 13.5,
      marginTop: 8,
      fontFamily: fonts.medium,
    },
    // ---- course accordion ----
    course: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: "hidden",
    },
    chead: {
      padding: sp.md,
      gap: sp.sm + 3,
      backgroundColor: colors.successBg,
    },
    ctop: { flexDirection: "row", alignItems: "center", gap: sp.sm },
    cnum: {
      fontSize: 11,
      fontWeight: "800",
      color: "#ffffff",
      backgroundColor: colors.inkCard,
      overflow: "hidden",
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 11,
      fontFamily: fonts.extrabold,
    },
    cpill: {
      marginLeft: "auto",
      fontSize: 11,
      fontWeight: "700",
      color: colors.text,
      backgroundColor: colors.surface,
      overflow: "hidden",
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 12,
      fontFamily: fonts.bold,
    },
    cpillMuted: { color: colors.textMuted },
    cgo: { color: "rgba(39,33,68,0.42)", fontSize: 20 },
    cbtm: { flexDirection: "row", alignItems: "center", gap: sp.sm + 4 },
    cthumb: {
      width: 54,
      height: 42,
      borderRadius: 9,
      backgroundColor: colors.surfaceMuted,
    },
    cthumbEmpty: {},
    cmain: { flex: 1, minWidth: 0 },
    cname: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
      lineHeight: 20,
      fontFamily: fonts.bold,
    },
    cmeta: {
      color: colors.primarySoft,
      fontSize: 12,
      marginTop: 3,
      fontFamily: fonts.regular,
    },
    lessons: { paddingHorizontal: sp.md, paddingBottom: sp.sm },
    empty: {
      color: colors.textMuted,
      fontSize: 14,
      fontFamily: fonts.regular,
    },
    // ---- compact navy progress card ----
    progress: {
      backgroundColor: colors.inkCard,
      borderRadius: 16,
      padding: sp.md,
    },
    progressTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: sp.md,
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
      marginTop: sp.md,
    },
    progressBtnText: {
      color: "#ffffff",
      fontSize: 13,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    // ---- guest / shared ----
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: sp.md,
    },
    aboutText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 23,
      marginTop: sp.xs,
      fontFamily: fonts.regular,
    },
    // ---- sections (skills, trailer) ----
    section: { gap: sp.xs },
    eyebrow: {
      color: colors.primarySoft,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 1.4,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "800",
      fontFamily: fonts.display,
    },
    skillsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: sp.sm,
      marginTop: sp.xs,
    },
    skillCard: {
      width: "48%",
      aspectRatio: 3 / 4,
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: colors.surface,
      justifyContent: "space-between",
    },
    skillCardWide: { width: "31%" },
    skillNum: {
      margin: sp.sm,
      width: 26,
      height: 26,
      borderRadius: 999,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    skillNumText: {
      color: colors.onPrimary,
      fontSize: 13,
      fontWeight: "800",
      fontFamily: fonts.extrabold,
    },
    skillTitleWrap: {
      padding: sp.sm,
      backgroundColor: colors.overlayMid,
    },
    skillTitle: {
      color: colors.heroText,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    trailer: {
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: "#000",
      marginTop: sp.xs,
    },
    bottomSpacer: { height: sp.lg },
  });
