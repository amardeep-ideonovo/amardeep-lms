// Class landing page — native mirror of the web's /classes/[slug]
// (hero + buy card + skills + trailer + owned course list + closing CTA).
// Web parity by request: unowned classes show "Get Class" with the starting
// price exactly like the website; the button hands off to the WEB checkout in
// the browser — no purchase ever happens in-app.
import React, { useEffect, useRef } from "react";
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { LinearGradient } from "expo-linear-gradient";
import type { ClassCertificateStatusDTO, CourseCard } from "@lms/types";

import { useClassPage, useMyClassCourses } from "../queries";
import { WEB_BASE_URL } from "../config";
import { fmtTotalDuration, money, vimeoEmbed, stripHtml } from "../format";
import { CourseRow } from "../components/CourseRow";
import { ErrorState } from "../components/Screen";
import { Press } from "../components/Press";
import { PopupHost } from "../components/PopupHost";
import { Badge, Chip } from "../components/Chip";
import { Skeleton } from "../components/Skeleton";
import { VideoPlayerView } from "../components/VideoPlayerView";
import CertificateClaim from "../components/CertificateClaim";
import { courseSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import { contentColumn, useContentLayout } from "../responsive";
import { letterGradient } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

type Ownership = {
  owned: boolean;
  courses: CourseCard[];
  certificate?: ClassCertificateStatusDTO | null;
};

export function ClassScreen({ route, navigation }: ScreenProps<"Class">) {
  const styles = useStyles(makeStyles);
  // isWide flips the stacked class hero to a side-by-side card (tablets).
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

  // Set the header title once the class name is known.
  useEffect(() => {
    if (pageQuery.data) navigation.setOptions({ title: pageQuery.data.name });
  }, [pageQuery.data, navigation]);

  if (pageQuery.isError && !cls)
    return (
      <ErrorState
        message="Class not found."
        onRetry={() => pageQuery.refetch()}
      />
    );

  if (!cls || !ownership) {
    return (
      // Scrollable: the seeded hero uses the real hero's tall 5:7 frame, which
      // on its own is most of the viewport.
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.skeletonWrap}
      >
        {seed ? (
          // Carry the tapped card's cover + title straight through, so the
          // hero is continuous instead of flashing an empty block. Everything
          // ownership-dependent (buy card, badge, course list) stays a
          // skeleton until the server answers.
          <View style={[styles.seedHero, isWide && styles.seedHeroWide]}>
            {seed.imageUrl ? (
              <Image
                source={{ uri: seed.imageUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : null}
            <LinearGradient
              colors={["transparent", "rgba(8,8,10,0.9)"]}
              style={styles.heroImageScrim}
            />
            <View style={styles.heroImageContent}>
              <Text style={styles.heroTitle}>{seed.name}</Text>
            </View>
          </View>
        ) : (
          <Skeleton height={300} radius={20} />
        )}
        <Skeleton height={22} width="55%" />
        <View style={styles.skeletonRow}>
          <Skeleton height={160} width="48%" radius={14} />
          <Skeleton height={160} width="48%" radius={14} />
        </View>
      </ScrollView>
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
  const trailerHeight = ((contentWidth - 32) * 9) / 16;

  // Cheapest price drives the "Starting at" label (web priceLabel parity).
  const cheapest =
    cls.prices.length > 0
      ? cls.prices.reduce((a, b) => (a.amount <= b.amount ? a : b))
      : null;
  const priceLabel = cheapest
    ? `${money(cheapest.amount, cheapest.currency)}/${cheapest.interval}`
    : null;
  // Checkout is a WEB handoff — the button opens the site; nothing is sold
  // in-app.
  const openCheckout = () =>
    Linking.openURL(`${WEB_BASE_URL}/checkout/${slugOrId}`).catch(() => {});
  const scrollToTrailer = () =>
    scrollRef.current?.scrollTo({ y: trailerY.current, animated: true });

  // Owners see skills BELOW their course library; guests see them up top
  // (marketing order) — mirrors the web class page.
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
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <View style={[styles.classHero, isWide && styles.classHeroWide]}>
          {/* Image-prominent cover (~70%): the class image stays clear; only a
              soft bottom scrim carries the overlaid category + title. */}
          <View style={[styles.heroImage, isWide && styles.heroImageWide]}>
            {cls.imageUrl ? (
              <Image
                source={{ uri: cls.imageUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : (
              <LinearGradient
                colors={letterGradient(cls.id)}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
            <LinearGradient
              colors={["transparent", "rgba(8,8,10,0.9)"]}
              style={styles.heroImageScrim}
            />
            <View style={styles.heroImageContent}>
              {cls.categories.length > 0 ? (
                <View style={styles.heroChips}>
                  {cls.categories.map((c) => (
                    <Chip key={c.id} label={c.name} onHero />
                  ))}
                </View>
              ) : null}
              <Text style={styles.heroTitle}>{cls.name}</Text>
            </View>
          </View>

          {/* Details panel (~30%) below the image; beside it when wide. */}
          <View style={[styles.heroContent, isWide && styles.heroContentWide]}>
            {owned ? (
              <View style={styles.ownedBadge}>
                <Badge label="You own this class" />
              </View>
            ) : null}
            {owned &&
            ownership.certificate &&
            (ownership.certificate.eligible ||
              ownership.certificate.claimed) ? (
              <CertificateClaim status={ownership.certificate} />
            ) : null}
            {cls.description ? (
              <Text style={styles.heroDesc} numberOfLines={4}>
                {stripHtml(cls.description)}
              </Text>
            ) : null}
            {meta ? <Text style={styles.heroMeta}>{meta}</Text> : null}
            {owned && progress && progress.total > 0 ? (
              <View style={styles.heroProgress}>
                <View style={styles.heroProgressLabels}>
                  <Text style={styles.heroProgressLabel}>
                    {Math.round((progress.done / progress.total) * 100)}%
                    complete
                  </Text>
                  <Text style={styles.heroProgressLabel}>
                    {progress.done} / {progress.total} lessons
                  </Text>
                </View>
                <View style={styles.heroTrack}>
                  <View
                    style={[
                      styles.heroFill,
                      {
                        width: `${Math.round((progress.done / progress.total) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ) : null}
            {!owned ? (
              <View style={styles.buyCard}>
                <Press style={styles.buyBtn} onPress={openCheckout}>
                  <Text style={styles.buyBtnText}>Get Class</Text>
                </Press>
                <Text style={styles.buySub}>
                  {priceLabel ? (
                    <>
                      Starting at{" "}
                      <Text style={styles.buyStrong}>{priceLabel}</Text>.
                    </>
                  ) : (
                    "Full lifetime access."
                  )}
                </Text>
                {cls.trailerUrl ? (
                  <Text style={styles.buyLink} onPress={scrollToTrailer}>
                    Watch the trailer ↓
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {owned ? (
          <>
            <View style={styles.section}>
              <Text style={styles.eyebrow}>Your library</Text>
              <Text style={styles.sectionTitle}>Your Courses</Text>
              <Text style={styles.sectionSub}>
                Continue where you left off.
              </Text>
              <View style={styles.courseList}>
                {courses.length === 0 ? (
                  <Text style={styles.empty}>
                    No courses in this class yet.
                  </Text>
                ) : (
                  courses.map((c) => (
                    <CourseRow
                      key={c.id}
                      course={c}
                      onPress={() =>
                        navigation.navigate("Course", {
                          courseId: c.id,
                          title: c.title,
                          seed: courseSeed(c),
                        })
                      }
                    />
                  ))
                )}
              </View>
            </View>
            {skillsSection}
          </>
        ) : (
          <>
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
            <View style={styles.closing}>
              <Text style={styles.closingEyebrow}>Start today</Text>
              <Text style={styles.closingTitle}>Begin {cls.name}</Text>
              <Press
                style={[styles.buyBtn, styles.closingBtn]}
                onPress={openCheckout}
              >
                <Text style={styles.buyBtnText}>Get Class</Text>
              </Press>
              {priceLabel ? (
                <Text style={styles.closingPrice}>
                  Starting at {priceLabel}
                </Text>
              ) : null}
            </View>
          </>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, spacing, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.lg, ...contentColumn },
    // Used as a scroll content container (flex/background live on styles.scroll).
    skeletonWrap: { padding: spacing.md, gap: spacing.md, ...contentColumn },
    skeletonRow: { flexDirection: "row", justifyContent: "space-between" },
    // Same frame as the real hero image so the seeded cover doesn't jump when
    // the fetched class replaces it.
    seedHero: {
      width: "100%",
      aspectRatio: 5 / 7,
      borderRadius: 20,
      overflow: "hidden",
      justifyContent: "flex-end",
      backgroundColor: colors.surfaceMuted,
    },
    // Matches heroImageWide so the seeded cover sits where the real hero's
    // image lands once the fetch resolves.
    seedHeroWide: { width: "45%" },
    ownedBadge: { flexDirection: "row" },
    // Image-prominent class hero: a clear cover on top with the category + title
    // overlaid at its base (per request, ~70% image), then a details panel below.
    classHero: {
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.borderSoft,
      backgroundColor: colors.surface,
    },
    // Wide layout: cover on the left, details beside it — a stacked 5:7 cover
    // at tablet width would be most of the viewport tall.
    classHeroWide: { flexDirection: "row", alignItems: "stretch" },
    heroImage: {
      width: "100%",
      aspectRatio: 5 / 7,
      justifyContent: "flex-end",
      backgroundColor: colors.surfaceMuted,
    },
    heroImageWide: { width: "45%" },
    heroImageScrim: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: "48%",
    },
    heroImageContent: { padding: spacing.md, gap: spacing.sm },
    heroChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    heroTitle: {
      color: colors.heroText,
      fontSize: 26,
      fontWeight: "800",
      fontFamily: fonts.display,
      lineHeight: 32,
    },
    heroContent: { padding: spacing.md, gap: spacing.sm },
    heroContentWide: { flex: 1, justifyContent: "center", padding: spacing.lg },
    heroProgress: { gap: 6, marginTop: spacing.xs },
    heroProgressLabels: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    heroProgressLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    heroTrack: {
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    heroFill: {
      height: "100%",
      backgroundColor: colors.primary,
      borderRadius: 999,
    },
    heroDesc: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      fontFamily: fonts.regular,
    },
    heroMeta: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    section: { gap: spacing.xs },
    eyebrow: {
      color: colors.primarySoft,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 1.6,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "800",
      fontFamily: fonts.display,
    },
    sectionSub: {
      color: colors.textMuted,
      fontSize: 14,
      marginBottom: spacing.xs,
      fontFamily: fonts.regular,
    },
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
    // 2-up cards turn into slabs on the wide column — go 3-up there.
    skillCardWide: { width: "31%" },
    skillNum: {
      margin: spacing.sm,
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
      padding: spacing.sm,
      backgroundColor: colors.overlayMid,
    },
    skillTitle: {
      color: colors.heroText,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    courseList: { gap: spacing.sm, marginTop: spacing.xs },
    empty: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
    // Buy card on the hero (web .cc-buy parity) — sits on the scrim, so its
    // text uses the hero tokens.
    buyCard: {
      marginTop: spacing.sm,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
      alignItems: "center",
    },
    buyBtn: {
      alignSelf: "stretch",
      backgroundColor: colors.primary,
      borderRadius: 11,
      paddingVertical: 12,
      alignItems: "center",
    },
    buyBtnText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    buySub: {
      color: colors.textMuted,
      fontSize: 13,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
    buyStrong: {
      color: colors.text,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    buyLink: {
      color: colors.primarySoft,
      fontSize: 13,
      textDecorationLine: "underline",
      fontFamily: fonts.regular,
    },
    closing: {
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    closingEyebrow: {
      color: colors.primarySoft,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 1.6,
    },
    closingTitle: {
      color: colors.text,
      fontSize: 24,
      fontWeight: "800",
      fontFamily: fonts.display,
      textAlign: "center",
    },
    closingBtn: { alignSelf: "center", paddingHorizontal: 28 },
    closingPrice: {
      color: colors.textMuted,
      fontSize: 13,
      fontFamily: fonts.regular,
    },
    trailer: {
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: "#000",
      marginTop: spacing.xs,
    },
    bottomSpacer: { height: spacing.lg },
  });
