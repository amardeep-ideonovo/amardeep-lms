// Class landing page — native mirror of the web's /classes/[slug]
// (hero + skills + trailer + owned course list). Unowned classes show the
// FULL marketing page but a deliberately neutral closing panel: no prices,
// no purchase buttons (App Store rules) — membership changes happen on web.
import React, { useCallback, useEffect, useState } from "react";
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { WebView } from "react-native-webview";
import type { ClassPublicDTO, CourseCard } from "@lms/types";

import { api } from "../api";
import { WEB_ACCOUNT_URL } from "../config";
import { fmtTotalDuration, vimeoEmbed } from "../format";
import { CourseRow } from "../components/CourseRow";
import { ErrorState } from "../components/Screen";
import { HeroBand } from "../components/HeroBand";
import { Badge } from "../components/Chip";
import { LockedPanel } from "../components/LockedPanel";
import { Skeleton } from "../components/Skeleton";
import { VideoPlayerView } from "../components/VideoPlayerView";
import type { ScreenProps } from "../navigation";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

type Ownership = { owned: boolean; courses: CourseCard[] };

export function ClassScreen({ route, navigation }: ScreenProps<"Class">) {
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { slugOrId } = route.params;

  const [cls, setCls] = useState<ClassPublicDTO | null>(null);
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setCls(null);
    setOwnership(null);
    try {
      // Both must resolve before first paint so an owner never flashes the
      // marketing branch (same rule as the web's ClassMemberArea).
      const [page, own] = await Promise.all([
        api.classPage(slugOrId),
        api.myClassCourses(slugOrId).catch(() => ({ owned: false, courses: [] })),
      ]);
      setCls(page);
      setOwnership(own);
      navigation.setOptions({ title: page.name });
    } catch {
      setError("Class not found.");
    }
  }, [slugOrId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!cls || !ownership) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={300} radius={20} />
        <Skeleton height={22} width="55%" />
        <View style={styles.skeletonRow}>
          <Skeleton height={160} width="48%" radius={14} />
          <Skeleton height={160} width="48%" radius={14} />
        </View>
      </View>
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
  const duration = fmtTotalDuration(cls.totalDurationSeconds);
  const meta = [
    `${cls.lessonCount} lesson${cls.lessonCount === 1 ? "" : "s"}`,
    duration,
  ]
    .filter(Boolean)
    .join(" · ");
  const trailer = cls.trailerUrl ? vimeoEmbed(cls.trailerUrl) : null;
  const trailerHeight = ((width - 32) * 9) / 16;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <HeroBand
        title={cls.name}
        imageUrl={cls.imageUrl}
        gradientSeed={cls.id}
        chips={cls.categories.map((c) => c.name)}
        progress={progress && progress.total > 0 ? progress : null}
        minHeight={300}
      >
        {owned ? (
          <View style={styles.ownedBadge}>
            <Badge label="You own this class" />
          </View>
        ) : null}
        {cls.description ? (
          <Text style={styles.heroDesc} numberOfLines={3}>
            {cls.description}
          </Text>
        ) : null}
        {meta ? <Text style={styles.heroMeta}>{meta}</Text> : null}
      </HeroBand>

      {cls.skills.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Curriculum</Text>
          <Text style={styles.sectionTitle}>Skills You&rsquo;ll Learn</Text>
          <View style={styles.skillsGrid}>
            {cls.skills.map((skill, i) => (
              <View key={`${skill.title}-${i}`} style={styles.skillCard}>
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
      ) : null}

      {owned ? (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Your library</Text>
          <Text style={styles.sectionTitle}>Your Courses</Text>
          <Text style={styles.sectionSub}>Continue where you left off.</Text>
          <View style={styles.courseList}>
            {courses.length === 0 ? (
              <Text style={styles.empty}>No courses in this class yet.</Text>
            ) : (
              courses.map((c) => (
                <CourseRow
                  key={c.id}
                  course={c}
                  onPress={() =>
                    navigation.navigate("Course", {
                      courseId: c.id,
                      title: c.title,
                    })
                  }
                />
              ))
            )}
          </View>
        </View>
      ) : (
        <>
          {trailer || cls.trailerUrl ? (
            <View style={styles.section}>
              <Text style={styles.eyebrow}>Preview</Text>
              <Text style={styles.sectionTitle}>Class Trailer</Text>
              <Text style={styles.sectionSub}>A two-minute look inside.</Text>
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
          <View style={styles.section}>
            <LockedPanel
              title={`Begin ${cls.name}`}
              message="This class isn't part of your membership."
              note="Memberships are managed on our website — open your account in the browser to change your plan."
              ctaLabel="Manage your plan on the web"
              onPress={() => Linking.openURL(WEB_ACCOUNT_URL).catch(() => {})}
            />
          </View>
        </>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const makeStyles = ({ colors, spacing }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.lg },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.md,
    },
    skeletonRow: { flexDirection: "row", justifyContent: "space-between" },
    ownedBadge: { flexDirection: "row" },
    heroDesc: { color: colors.heroTextSoft, fontSize: 15, lineHeight: 22 },
    heroMeta: { color: colors.heroTextSoft, fontSize: 13, fontWeight: "600" },
    section: { gap: spacing.xs },
    eyebrow: {
      color: colors.primarySoft,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 1.6,
    },
    sectionTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
    sectionSub: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.xs },
    skillsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    skillCard: {
      width: "48%",
      aspectRatio: 3 / 4,
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      justifyContent: "space-between",
    },
    skillNum: {
      margin: spacing.sm,
      width: 26,
      height: 26,
      borderRadius: 999,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    skillNumText: { color: colors.onPrimary, fontSize: 13, fontWeight: "800" },
    skillTitleWrap: {
      padding: spacing.sm,
      backgroundColor: colors.overlayMid,
    },
    skillTitle: { color: colors.heroText, fontSize: 14, fontWeight: "700" },
    courseList: { gap: spacing.sm, marginTop: spacing.xs },
    empty: { color: colors.textMuted, fontSize: 14 },
    trailer: {
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: "#000",
      marginTop: spacing.xs,
    },
    bottomSpacer: { height: spacing.lg },
  });
