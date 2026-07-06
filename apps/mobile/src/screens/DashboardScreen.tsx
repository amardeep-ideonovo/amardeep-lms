// Member Home — Ink Hero (design frame 1f): ink chrome band (brand row,
// greeting, streak line, full-width teal Resume CTA), the white "My Learning
// Overview" card overlapping the band (progress ring + per-class colored
// dots), the live-session ink strip, continue-learning rows, and the My
// Classes photo-tint carousel, with a neutral Explore grid below. All numbers
// come from the real API (my-classes progress, certificates, live/current).
import React, { useCallback, useRef, useState } from "react";
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import type {
  AuthUser,
  ClassTileDTO,
  LiveSessionBarDTO,
  MyCertificateDTO,
} from "@lms/types";

import { api } from "../api";
import { ACCENT_TINT_LOCATIONS, accentIndexMap, accentTint, classAccent } from "../class-colors";
import { BrandHeaderTitle } from "../components/BrandHeaderTitle";
import { ClassTile } from "../components/ClassTile";
import { CtaButton } from "../components/CtaButton";
import { LiveSessionBar } from "../components/LiveSessionBar";
import { PopupHost } from "../components/PopupHost";
import { ProgressRing } from "../components/ProgressRing";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { Press } from "../components/Press";
import type { TabScreenProps } from "../navigation";
import { letterGradient, spacing } from "../theme";
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

function daypart(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const pctOf = (p: ClassTileDTO["progress"]): number | null =>
  p && p.total > 0 ? Math.round((p.completed / p.total) * 100) : null;

// Avatar fallback initials (same rule as the Profile screen).
function initialsOf(u: AuthUser): string {
  const src =
    [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "M") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function DashboardScreen({ navigation }: TabScreenProps<"Home">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [live, setLive] = useState<LiveSessionBarDTO[]>([]);
  const [certs, setCerts] = useState<MyCertificateDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    // Keep previous data on refocus (no spinner flash) — only the very first
    // load shows skeletons.
    const [cls, meRes, liveRes, certRes] = await Promise.allSettled([
      api.myClasses(),
      api.me(),
      api.liveCurrent(),
      api.myCertificates(),
    ]);
    if (cls.status === "fulfilled") {
      setClasses(cls.value);
    } else if (!loadedOnce.current) {
      setError("Could not load your dashboard.");
      return;
    }
    if (meRes.status === "fulfilled") setMe(meRes.value);
    if (liveRes.status === "fulfilled") setLive(liveRes.value);
    if (certRes.status === "fulfilled") setCerts(certRes.value);
    loadedOnce.current = true;
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
      <View style={styles.skeletonScreen}>
        {isFocused ? <StatusBar style="light" /> : null}
        <View style={[styles.band, { paddingTop: insets.top + 6 }]}>
          <Skeleton
            height={30}
            width="55%"
            radius={8}
            color="rgba(255,255,255,0.08)"
          />
          <Skeleton
            height={44}
            radius={10}
            color="rgba(255,255,255,0.08)"
            style={{ marginTop: spacing.md }}
          />
        </View>
        <View style={styles.overlapWrap}>
          <Skeleton height={110} radius={16} />
          <Skeleton height={64} radius={14} style={{ marginTop: spacing.md }} />
          <Skeleton height={64} radius={14} style={{ marginTop: spacing.sm }} />
        </View>
      </View>
    );
  }

  const owned = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);
  // Stable class → accent-cycle index over the FULL class list order, so a
  // class keeps the same color on every screen.
  const accentIndex = accentIndexMap(classes);

  const incomplete = (p: ClassTileDTO["progress"]) =>
    !!p && p.total > 0 && p.completed < p.total;
  const featured = owned.find((c) => incomplete(c.progress)) ?? owned[0] ?? null;
  const featuredComplete =
    !!featured?.progress &&
    featured.progress.total > 0 &&
    featured.progress.completed >= featured.progress.total;

  // Overall journey %: all lessons completed across owned classes.
  const totals = owned.reduce(
    (acc, c) => ({
      done: acc.done + (c.progress?.completed ?? 0),
      total: acc.total + (c.progress?.total ?? 0),
    }),
    { done: 0, total: 0 }
  );
  const overall =
    totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0;

  const name = greetingName(me);
  const inProgress = owned.filter((c) => incomplete(c.progress));
  const tileWidth = (width - spacing.md * 2 - spacing.sm) / 2;

  const openClass = (c: ClassTileDTO) =>
    navigation.navigate("Class", { slugOrId: c.slug ?? c.id, title: c.name });

  const streakLine =
    owned.length > 0
      ? totals.total > 0
        ? `You are ${overall}% through your learning journey — keep the streak going.`
        : `You're enrolled in ${owned.length} class${owned.length === 1 ? "" : "es"} — dive in below.`
      : classes.length > 0
        ? "Explore the classes below to get started."
        : "No classes are available yet.";

  const overviewMeta = [
    `${owned.length} active class${owned.length === 1 ? "" : "es"}`,
    certs && certs.length > 0
      ? `${certs.length} certificate${certs.length === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* The band is ink in both modes — light status icons while focused. */}
      {isFocused ? <StatusBar style="light" /> : null}
      <PopupHost context={{ type: "dashboard" }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#ffffff"
            colors={[colors.primary]}
          />
        }
      >
        {/* Bounce cover: keeps the iOS rubber-band area ink instead of
            flashing the light page bg behind the light status icons. */}
        <View style={styles.bounceCover} />

        {/* ---------- ink chrome band ---------- */}
        <View style={[styles.band, { paddingTop: insets.top + 6 }]}>
          <View style={styles.brandRow}>
            <BrandHeaderTitle onChrome />
            <View style={styles.brandSpacer} />
            {me?.avatarUrl ? (
              <Image source={{ uri: me.avatarUrl }} style={styles.avatar} />
            ) : me ? (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>{initialsOf(me)}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.greeting}>
            {name ? `${daypart()}, ${name}` : daypart()}
          </Text>
          <Text style={styles.streak}>{streakLine}</Text>

          {featured ? (
            <CtaButton
              style={styles.resume}
              icon={<Text style={styles.resumeGlyph}>▶</Text>}
              label={`${featuredComplete ? "Review" : "Resume"}: ${featured.name}`}
              onPress={() => openClass(featured)}
            />
          ) : null}
        </View>

        {/* ---------- overlap: My Learning Overview ---------- */}
        <View style={styles.overlapWrap}>
          <View style={styles.overviewCard}>
            <ProgressRing
              size={64}
              stroke={7}
              pct={overall}
              color={colors.primary}
              trackColor={colors.surfaceMuted}
              labelColor={colors.text}
              labelSize={14}
            />
            <View style={styles.overviewInfo}>
              <Text style={styles.overviewTitle}>My Learning Overview</Text>
              <Text style={styles.overviewMeta}>{overviewMeta}</Text>
              {owned.length > 0 ? (
                <View style={styles.dotRow}>
                  {owned.slice(0, 6).map((c) => {
                    const accent = classAccent(accentIndex.get(c.id) ?? 0);
                    const pct = pctOf(c.progress) ?? 0;
                    return (
                      <View key={c.id} style={styles.dotItem}>
                        <View
                          style={[styles.dot, { backgroundColor: accent.color }]}
                        />
                        <Text style={styles.dotLabel} numberOfLines={1}>
                          {c.name.split(" ")[0]} {pct}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </View>

          {/* ---------- live session ink strip (hidden when none) ---------- */}
          <LiveSessionBar
            sessions={live}
            onOpen={(s) =>
              navigation.navigate("LiveSession", {
                sessionId: s.id,
                title: s.title,
              })
            }
          />

          {/* ---------- continue learning ---------- */}
          {inProgress.length > 0 ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Continue learning</Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate("Classes")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sectionLink}>View all</Text>
                </TouchableOpacity>
              </View>
              {inProgress.slice(0, 3).map((c) => {
                const accent = classAccent(accentIndex.get(c.id) ?? 0);
                const pct = pctOf(c.progress) ?? 0;
                return (
                  <Press
                    key={c.id}
                    style={styles.continueRow}
                    onPress={() => openClass(c)}
                  >
                    {c.imageUrl ? (
                      <Image
                        source={{ uri: c.imageUrl }}
                        style={styles.continueThumb}
                      />
                    ) : (
                      <LinearGradient
                        colors={letterGradient(c.id)}
                        style={[styles.continueThumb, styles.thumbLetterBox]}
                      >
                        <Text style={styles.thumbLetter}>
                          {c.name.slice(0, 1).toUpperCase()}
                        </Text>
                      </LinearGradient>
                    )}
                    <View style={styles.continueInfo}>
                      <Text style={styles.continueTitle} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.continueSub} numberOfLines={1}>
                        {c.progress
                          ? `${c.progress.completed} of ${c.progress.total} lessons`
                          : "Not started yet"}
                      </Text>
                    </View>
                    <Text style={[styles.continuePct, { color: accent.text }]}>
                      {pct}%
                    </Text>
                  </Press>
                );
              })}
            </>
          ) : null}

          {/* ---------- my classes carousel ---------- */}
          {owned.length > 0 ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>My Classes</Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate("Classes")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sectionLink}>All {classes.length}</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carousel}
                style={styles.carouselWrap}
              >
                {owned.map((c) => {
                  const accent = classAccent(accentIndex.get(c.id) ?? 0);
                  const pct = pctOf(c.progress) ?? 0;
                  return (
                    // The photo-tint layers need a fixed-size inner box — the
                    // Press wrapper only shrink-wraps it.
                    <Press key={c.id} onPress={() => openClass(c)}>
                      <View style={styles.classCard}>
                        {c.imageUrl ? (
                          <Image
                            source={{ uri: c.imageUrl }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                          />
                        ) : (
                          <LinearGradient
                            colors={letterGradient(c.id)}
                            style={StyleSheet.absoluteFill}
                          />
                        )}
                        <LinearGradient
                          colors={accentTint(accent)}
                          locations={ACCENT_TINT_LOCATIONS}
                          style={StyleSheet.absoluteFill}
                        />
                        <Text style={styles.classCardTitle}>{c.name}</Text>
                        <View style={styles.grow} />
                        <Text style={styles.classCardPct}>{pct}%</Text>
                        <View style={styles.classCardTrack}>
                          <View
                            style={[styles.classCardFill, { width: `${pct}%` }]}
                          />
                        </View>
                      </View>
                    </Press>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {/* ---------- explore (neutral — no prices on mobile) ---------- */}
          {available.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, styles.exploreTitle]}>
                Explore More Classes
              </Text>
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

          <TouchableOpacity
            style={styles.browseAll}
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate("CourseList", {
                title: "All courses",
                all: true,
              })
            }
          >
            <Text style={styles.browseAllText}>Browse all courses ›</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: spacing.lg },
    skeletonScreen: { flex: 1, backgroundColor: colors.bg },

    bounceCover: {
      position: "absolute",
      top: -600,
      left: 0,
      right: 0,
      height: 600,
      backgroundColor: colors.chrome,
    },
    // Ink chrome band (design: padding-bottom 58, content overlaps -46).
    band: {
      backgroundColor: colors.chrome,
      paddingHorizontal: 18,
      paddingBottom: 58,
    },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
    brandSpacer: { flex: 1 },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: "rgba(255,255,255,0.14)",
    },
    avatarFallback: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: "rgba(255,255,255,0.14)",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitials: {
      color: "#ffffff",
      fontSize: 11,
      fontFamily: fonts.bold,
    },
    greeting: {
      color: "#ffffff",
      fontSize: 22,
      fontFamily: fonts.semibold,
      marginTop: 18,
    },
    streak: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 12,
      lineHeight: 18.5,
      marginTop: 5,
      fontFamily: fonts.regular,
    },
    resume: { marginTop: 15 },
    resumeGlyph: { color: "#ffffff", fontSize: 12, fontFamily: fonts.semibold },

    // Content column overlapping the band (phone gutter 16, overlap -46).
    overlapWrap: { paddingHorizontal: 16, marginTop: -46, gap: spacing.md },

    overviewCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingVertical: 14,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      shadowColor: "#140f2d",
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
      elevation: 8,
    },
    overviewInfo: { flex: 1, gap: 2 },
    overviewTitle: {
      color: colors.text,
      fontSize: 13.5,
      fontFamily: fonts.semibold,
    },
    overviewMeta: {
      color: colors.textMuted,
      fontSize: 10.5,
      fontFamily: fonts.regular,
    },
    dotRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: 10,
      rowGap: 4,
      marginTop: 5,
    },
    dotItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    dotLabel: {
      fontSize: 9.5,
      fontFamily: fonts.semibold,
      color: colors.textMuted,
      maxWidth: 110,
    },

    sectionRow: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginHorizontal: 4,
      marginBottom: -6,
      marginTop: 2,
    },
    sectionTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
    sectionLink: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.medium },
    exploreTitle: { marginHorizontal: 4, marginBottom: -6, marginTop: 2 },

    continueRow: {
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
    continueThumb: {
      width: 56,
      height: 40,
      borderRadius: 9,
      backgroundColor: colors.surfaceMuted,
    },
    thumbLetterBox: { alignItems: "center", justifyContent: "center" },
    thumbLetter: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 16,
      fontFamily: fonts.extrabold,
    },
    continueInfo: { flex: 1, gap: 2 },
    continueTitle: {
      color: colors.text,
      fontSize: 12.5,
      fontFamily: fonts.semibold,
    },
    continueSub: {
      color: colors.textMuted,
      fontSize: 10.5,
      fontFamily: fonts.regular,
    },
    continuePct: { fontSize: 11, fontFamily: fonts.bold },

    carouselWrap: { marginHorizontal: -16 },
    carousel: { paddingHorizontal: 16, gap: 12 },
    classCard: {
      width: 170,
      height: 172,
      borderRadius: 16,
      overflow: "hidden",
      padding: 13,
      backgroundColor: colors.surfaceMuted,
    },
    classCardTitle: {
      color: "#ffffff",
      fontSize: 13,
      fontFamily: fonts.bold,
      lineHeight: 17,
    },
    grow: { flex: 1 },
    classCardPct: {
      color: "#ffffff",
      fontSize: 11,
      fontFamily: fonts.semibold,
      marginBottom: 5,
    },
    classCardTrack: {
      height: 5,
      borderRadius: 3,
      backgroundColor: "rgba(255,255,255,0.35)",
      overflow: "hidden",
    },
    classCardFill: {
      height: 5,
      borderRadius: 3,
      backgroundColor: "#ffffff",
    },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    browseAll: { paddingVertical: spacing.sm },
    browseAllText: {
      color: colors.textMuted,
      fontSize: 13,
      fontFamily: fonts.semibold,
    },
  });
