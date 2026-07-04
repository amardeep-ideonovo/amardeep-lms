// Member dashboard — classes-first, mirroring the web's /dashboard: welcome
// head, continue-learning hero (first owned class), My Classes / Explore More
// tile grids, plus search across classes, class categories, and course titles.
// The legacy all-courses list stays reachable via the quiet footer link.
import React, { useCallback, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type {
  AuthUser,
  ClassTileDTO,
  CourseCard,
  DashboardResponse,
  LiveSessionBarDTO,
} from "@lms/types";

import { api } from "../api";
import { ErrorState } from "../components/Screen";
import { ClassTile } from "../components/ClassTile";
import { LiveSessionBar } from "../components/LiveSessionBar";
import { CourseRow } from "../components/CourseRow";
import { HeroBand } from "../components/HeroBand";
import { PopupHost } from "../components/PopupHost";
import { Skeleton } from "../components/Skeleton";
import type { TabScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

// Member's display first name for the greeting: profile first name, else
// username, else the email local-part. Empty when we have no identity yet.
function greetingName(u: AuthUser | null): string {
  if (!u) return "";
  return (
    u.firstName?.trim() ||
    u.username?.trim() ||
    (u.email ? u.email.split("@")[0] : "")
  );
}

export function DashboardScreen({ navigation }: TabScreenProps<"Dashboard">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [dash, setDash] = useState<DashboardResponse | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [live, setLive] = useState<LiveSessionBarDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    // Keep previous data on refocus (no spinner flash) — only the very first
    // load shows skeletons.
    const [cls, d, meRes, liveRes] = await Promise.allSettled([
      api.myClasses(),
      api.dashboard(),
      api.me(),
      api.liveCurrent(),
    ]);
    if (cls.status === "fulfilled") {
      setClasses(cls.value);
    } else if (!loadedOnce.current) {
      setError("Could not load your dashboard.");
      return;
    }
    if (d.status === "fulfilled") setDash(d.value);
    if (meRes.status === "fulfilled") setMe(meRes.value);
    if (liveRes.status === "fulfilled") setLive(liveRes.value);
    loadedOnce.current = true;
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Featured class = the continue-learning hero. Prefer the first owned class
  // that's still INCOMPLETE (so members land on "what's next"); fall back to the
  // first owned class when everything is done. Progress now ships on the tile
  // (ClassTileDTO.progress), so no per-class fetch is needed.
  const owned = classes?.filter((c) => c.owned) ?? [];
  const incomplete = (p: ClassTileDTO["progress"]) =>
    !!p && p.total > 0 && p.completed < p.total;
  const featured =
    owned.find((c) => incomplete(c.progress)) ?? owned[0] ?? null;
  const featProgress =
    featured?.progress && featured.progress.total > 0
      ? { done: featured.progress.completed, total: featured.progress.total }
      : null;
  const featuredComplete =
    !!featured?.progress &&
    featured.progress.total > 0 &&
    featured.progress.completed >= featured.progress.total;

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!classes) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={24} width="50%" />
        <Skeleton height={240} radius={20} />
        <View style={styles.skeletonRow}>
          <Skeleton height={170} width="48%" radius={14} />
          <Skeleton height={170} width="48%" radius={14} />
        </View>
      </View>
    );
  }

  const enrolled = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);
  const name = greetingName(me);
  const allCourses = dash?.categories.flatMap((s) => s.courses) ?? [];
  const tileWidth = (width - spacing.md * 2 - spacing.sm) / 2;

  const openClass = (c: ClassTileDTO) =>
    navigation.navigate("Class", { slugOrId: c.slug ?? c.id, title: c.name });
  const openCourse = (c: CourseCard) =>
    navigation.navigate("Course", { courseId: c.id, title: c.title });

  const query = q.trim().toLowerCase();
  const matchClasses = query
    ? classes.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.categories.some((cat) => cat.name.toLowerCase().includes(query))
      )
    : [];
  const matchCourses = query
    ? allCourses.filter((c) => c.title.toLowerCase().includes(query))
    : [];

  const grid = (items: ClassTileDTO[]) => (
    <View style={styles.grid}>
      {items.map((c) => (
        <ClassTile
          key={c.id}
          cls={c}
          style={{ width: tileWidth }}
          onPress={() => openClass(c)}
        />
      ))}
    </View>
  );

  return (
    <>
      <PopupHost context={{ type: "dashboard" }} />
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <Text style={styles.h1}>
          {enrolled.length > 0
            ? name
              ? `Welcome back, ${name}.`
              : "Welcome back."
            : name
              ? `Welcome, ${name}.`
              : "Welcome."}
        </Text>
        <Text style={styles.sub}>
          {enrolled.length > 0
            ? `You're enrolled in ${enrolled.length} class${
                enrolled.length === 1 ? "" : "es"
              }.`
            : classes.length > 0
              ? "Explore the classes below to get started."
              : "No classes are available yet."}
        </Text>

        <LiveSessionBar
          sessions={live}
          onOpen={(s) =>
            navigation.navigate("LiveSession", {
              sessionId: s.id,
              title: s.title,
            })
          }
        />

        <TextInput
          style={styles.search}
          placeholder="Search classes or courses…"
          placeholderTextColor={colors.textMuted}
          value={q}
          onChangeText={setQ}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {query ? (
          matchClasses.length === 0 && matchCourses.length === 0 ? (
            <Text style={styles.empty}>Nothing matches “{q}”.</Text>
          ) : (
            <>
              {matchClasses.length > 0 ? (
                <Text style={styles.sectionHeader}>Classes</Text>
              ) : null}
              {grid(matchClasses)}
              {matchCourses.length > 0 ? (
                <Text style={styles.sectionHeader}>Courses</Text>
              ) : null}
              {matchCourses.map((c) => (
                <CourseRow key={c.id} course={c} onPress={() => openCourse(c)} />
              ))}
            </>
          )
        ) : (
          <>
            {featured ? (
              <HeroBand
                eyebrow={featuredComplete ? "Completed" : "Continue learning"}
                title={featured.name}
                imageUrl={featured.imageUrl}
                gradientSeed={featured.id}
                chips={featured.categories.slice(0, 2).map((c) => c.name)}
                progress={featProgress}
                buttonLabel={featuredComplete ? "Review class" : "Resume class"}
                onButtonPress={() => openClass(featured)}
                minHeight={240}
                style={styles.hero}
              />
            ) : null}

            {enrolled.length > 0 ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionTitle}>My Classes</Text>
                  <Text style={styles.sectionCount}>{enrolled.length}</Text>
                </View>
                {grid(enrolled)}
              </>
            ) : null}

            {available.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Explore More Classes</Text>
                {grid(available)}
              </>
            ) : null}

            {allCourses.length > 0 ? (
              <TouchableOpacity
                style={styles.browseAll}
                onPress={() =>
                  navigation.navigate("CourseList", {
                    title: "All courses",
                    all: true,
                  })
                }
              >
                <Text style={styles.browseAllText}>Browse all courses ›</Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.md },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.md,
    },
    skeletonRow: { flexDirection: "row", justifyContent: "space-between" },
    h1: { color: colors.text, fontSize: 26, fontWeight: "800", fontFamily: fonts.display },
    sub: {
      color: colors.textMuted,
      fontSize: 15,
      marginTop: -spacing.sm,
      fontFamily: fonts.regular,
    },
    search: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 10,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.regular,
    },
    hero: { marginTop: spacing.xs },
    sectionRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "800",
      fontFamily: fonts.extrabold,
      marginTop: spacing.sm,
    },
    sectionCount: { color: colors.textMuted, fontSize: 14, fontWeight: "700", fontFamily: fonts.bold },
    sectionHeader: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    empty: {
      color: colors.textMuted,
      fontSize: 15,
      textAlign: "center",
      marginTop: spacing.lg,
      fontFamily: fonts.regular,
    },
    browseAll: { paddingVertical: spacing.sm },
    browseAllText: { color: colors.textMuted, fontSize: 14, fontWeight: "600", fontFamily: fonts.semibold },
  });
