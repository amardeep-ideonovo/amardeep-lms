// Classes tab — Ink Hero (design frames 1g/2l): the active class as an ink
// card, its courses as class-colored photo rows with white progress rings, a
// certificate row that leads to the Certificates screen, then the member's
// other classes and a neutral Explore section (no prices on mobile — store
// rules). Real data: /levels/my-classes + /levels/:id/my-courses.
import React, { useCallback, useRef, useState } from "react";
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { ClassTileDTO, CourseCard, MyClassCoursesDTO } from "@lms/types";

import { api } from "../api";
import { accentIndexMap, classAccent } from "../class-colors";
import { ClassTile } from "../components/ClassTile";
import { Press } from "../components/Press";
import { ProgressRing } from "../components/ProgressRing";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import type { TabScreenProps } from "../navigation";
import { letterGradient, spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

const pctOf = (p: ClassTileDTO["progress"]): number =>
  p && p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;

const coursePct = (c: CourseCard): number =>
  c.lessonCount > 0 ? Math.round((c.completedCount / c.lessonCount) * 100) : 0;

export function MyClassesScreen({ navigation }: TabScreenProps<"Classes">) {
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();

  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [activeCourses, setActiveCourses] = useState<MyClassCoursesDTO | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const cls = await api.myClasses();
      setClasses(cls);
      const owned = cls.filter((c) => c.owned);
      const incomplete = (p: ClassTileDTO["progress"]) =>
        !!p && p.total > 0 && p.completed < p.total;
      const active = owned.find((c) => incomplete(c.progress)) ?? owned[0];
      if (active) {
        // Course list for the active class — best effort, the class card
        // stands alone if it fails.
        const courses = await api
          .myClassCourses(active.slug ?? active.id)
          .catch(() => null);
        setActiveCourses(courses);
      } else {
        setActiveCourses(null);
      }
      loadedOnce.current = true;
    } catch {
      if (!loadedOnce.current) setError("Could not load your classes.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!classes) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={84} radius={16} />
        <Skeleton height={76} radius={14} />
        <Skeleton height={76} radius={14} />
        <Skeleton height={76} radius={14} />
      </View>
    );
  }

  const owned = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);
  const accentIndex = accentIndexMap(classes);
  const incomplete = (p: ClassTileDTO["progress"]) =>
    !!p && p.total > 0 && p.completed < p.total;
  const active = owned.find((c) => incomplete(c.progress)) ?? owned[0] ?? null;
  const others = owned.filter((c) => c.id !== active?.id);
  const activeIdx = active ? accentIndex.get(active.id) ?? 0 : 0;
  const tileWidth = (width - spacing.md * 2 - spacing.sm) / 2;

  const openClass = (c: ClassTileDTO) =>
    navigation.navigate("Class", { slugOrId: c.slug ?? c.id, title: c.name });

  const courses = activeCourses?.owned ? activeCourses.courses : [];
  const lessonsTotal = courses.reduce((n, c) => n + c.lessonCount, 0);
  const cert = activeCourses?.certificate ?? null;
  const certSub = cert?.claimed
    ? "Earned — view your certificate"
    : cert?.eligible
      ? "Ready to claim"
      : "Complete all courses to unlock";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {active ? (
        <>
          {/* ---------- active class ink card ---------- */}
          <Press style={styles.activeCard} onPress={() => openClass(active)}>
            {active.imageUrl ? (
              <Image
                source={{ uri: active.imageUrl }}
                style={styles.activeThumb}
              />
            ) : (
              <LinearGradient
                colors={letterGradient(active.id)}
                style={[styles.activeThumb, styles.letterBox]}
              >
                <Text style={styles.letter}>
                  {active.name.slice(0, 1).toUpperCase()}
                </Text>
              </LinearGradient>
            )}
            <View style={styles.activeInfo}>
              <Text style={styles.activeEyebrow}>ACTIVE CLASS</Text>
              <Text style={styles.activeName} numberOfLines={2}>
                {active.name}
              </Text>
            </View>
            <Text style={styles.activePct}>{pctOf(active.progress)}%</Text>
          </Press>

          {/* ---------- class courses ---------- */}
          {courses.length > 0 ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Class Courses</Text>
                <Text style={styles.sectionMeta}>
                  {courses.length} course{courses.length === 1 ? "" : "s"} ·{" "}
                  {lessonsTotal} lesson{lessonsTotal === 1 ? "" : "s"}
                </Text>
              </View>
              {courses.map((c, i) => {
                // Colored course rows cycle from the class's own accent + 1 —
                // reproduces the mock (green/red/blue/sea for class #2).
                const accent = classAccent(activeIdx + 1 + i);
                const thumb = c.thumbnailUrl ?? c.coverImageUrl;
                return (
                  <Press
                    key={c.id}
                    style={[
                      styles.courseRow,
                      { backgroundColor: accent.color },
                      c.locked && styles.courseLocked,
                    ]}
                    disabled={c.locked}
                    onPress={() =>
                      navigation.navigate("Course", {
                        courseId: c.id,
                        title: c.title,
                      })
                    }
                  >
                    {thumb ? (
                      <Image source={{ uri: thumb }} style={styles.courseThumb} />
                    ) : (
                      <View style={[styles.courseThumb, styles.courseThumbEmpty]}>
                        <Text style={styles.courseThumbLetter}>
                          {c.title.slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.courseInfo}>
                      <Text style={styles.courseTitle} numberOfLines={2}>
                        {c.title}
                      </Text>
                      <Text style={styles.courseSub} numberOfLines={1}>
                        {c.locked
                          ? "Locked"
                          : `${c.lessonCount} lesson${c.lessonCount === 1 ? "" : "s"}`}
                      </Text>
                    </View>
                    <ProgressRing
                      size={46}
                      stroke={4}
                      pct={coursePct(c)}
                      color="#ffffff"
                      trackColor="rgba(255,255,255,0.3)"
                      labelColor="#ffffff"
                      labelSize={10.5}
                    />
                  </Press>
                );
              })}

              {/* ---------- certificate row ---------- */}
              <Press
                style={[
                  styles.courseRow,
                  {
                    backgroundColor: classAccent(activeIdx + 1 + courses.length)
                      .color,
                  },
                ]}
                onPress={() => navigation.navigate("Certificates")}
              >
                <View style={[styles.courseThumb, styles.courseThumbEmpty]}>
                  <Ionicons name="ribbon-outline" size={20} color="#ffffff" />
                </View>
                <View style={styles.courseInfo}>
                  <Text style={styles.courseTitle}>Class Certificate</Text>
                  <Text style={styles.courseSub} numberOfLines={1}>
                    {certSub}
                  </Text>
                </View>
                <ProgressRing
                  size={46}
                  stroke={4}
                  pct={cert?.claimed ? 100 : pctOf(active.progress)}
                  color="#ffffff"
                  trackColor="rgba(255,255,255,0.3)"
                  labelColor="#ffffff"
                  labelSize={10.5}
                />
              </Press>
            </>
          ) : null}
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No classes yet</Text>
          <Text style={styles.emptyBody}>
            When a membership unlocks a class it appears here with your
            progress. Explore what's available below.
          </Text>
        </View>
      )}

      {/* ---------- other enrolled classes ---------- */}
      {others.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Also enrolled</Text>
            <Text style={styles.sectionMeta}>{others.length}</Text>
          </View>
          {others.map((c) => {
            const accent = classAccent(accentIndex.get(c.id) ?? 0);
            const pct = pctOf(c.progress);
            return (
              <Press
                key={c.id}
                style={styles.otherRow}
                onPress={() => openClass(c)}
              >
                {c.imageUrl ? (
                  <Image source={{ uri: c.imageUrl }} style={styles.otherThumb} />
                ) : (
                  <LinearGradient
                    colors={letterGradient(c.id)}
                    style={[styles.otherThumb, styles.letterBox]}
                  >
                    <Text style={styles.letterSmall}>
                      {c.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </LinearGradient>
                )}
                <View style={styles.otherInfo}>
                  <Text style={styles.otherName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <View style={styles.otherTrack}>
                    <View
                      style={[
                        styles.otherFill,
                        { width: `${pct}%`, backgroundColor: accent.color },
                      ]}
                    />
                  </View>
                </View>
                <Text style={[styles.otherPct, { color: accent.text }]}>
                  {pct}%
                </Text>
              </Press>
            );
          })}
        </>
      ) : null}

      {/* ---------- explore (neutral, no prices) ---------- */}
      {available.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Explore more classes</Text>
            <Text style={styles.sectionMeta}>{available.length}</Text>
          </View>
          <View style={styles.grid}>
            {available.map((c) => (
              <ClassTile
                key={c.id}
                cls={c}
                style={{ width: tileWidth }}
                onPress={() => openClass(c)}
              />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: 12 },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },

    activeCard: {
      backgroundColor: colors.chrome,
      borderRadius: 16,
      paddingVertical: 14,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    activeThumb: {
      width: 56,
      height: 56,
      borderRadius: 14,
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    letterBox: { alignItems: "center", justifyContent: "center" },
    letter: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 20,
      fontFamily: fonts.extrabold,
    },
    letterSmall: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 15,
      fontFamily: fonts.extrabold,
    },
    activeInfo: { flex: 1 },
    activeEyebrow: {
      color: "rgba(255,255,255,0.5)",
      fontSize: 10.5,
      fontFamily: fonts.semibold,
      letterSpacing: 0.8,
    },
    activeName: {
      color: "#ffffff",
      fontSize: 16,
      fontFamily: fonts.semibold,
      marginTop: 3,
      lineHeight: 21,
    },
    activePct: {
      color: colors.primaryOnDark,
      fontSize: 12,
      fontFamily: fonts.bold,
    },

    sectionRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginHorizontal: 4,
      marginTop: 8,
      marginBottom: 0,
    },
    sectionTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
    sectionMeta: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.regular },

    courseRow: {
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    courseLocked: { opacity: 0.55 },
    courseThumb: {
      width: 48,
      height: 48,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.22)",
    },
    courseThumbEmpty: {
      alignItems: "center",
      justifyContent: "center",
    },
    courseThumbLetter: {
      color: "#ffffff",
      fontSize: 17,
      fontFamily: fonts.extrabold,
    },
    courseInfo: { flex: 1, gap: 1 },
    courseTitle: { color: "#ffffff", fontSize: 14, fontFamily: fonts.bold },
    courseSub: {
      color: "rgba(255,255,255,0.8)",
      fontSize: 11,
      fontFamily: fonts.regular,
    },

    otherRow: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    otherThumb: {
      width: 56,
      height: 40,
      borderRadius: 9,
      backgroundColor: colors.surfaceMuted,
    },
    otherInfo: { flex: 1, gap: 6 },
    otherName: { color: colors.text, fontSize: 12.5, fontFamily: fonts.semibold },
    otherTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    otherFill: { height: 4, borderRadius: 2 },
    otherPct: { fontSize: 11, fontFamily: fonts.bold },

    emptyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 16,
      padding: spacing.lg,
      gap: 6,
    },
    emptyTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
    emptyBody: {
      color: colors.textMuted,
      fontSize: 12.5,
      lineHeight: 18,
      fontFamily: fonts.regular,
    },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  });
