// Cinematic hero band — the continue-learning hero, class-page hero, and
// featured-blog hero (web parity: .md-continue / .cc-hero). Layers: cover
// image with a dark scrim, OR a deterministic letter-gradient (gradientSeed),
// OR the brand gradient derived from the admin primary. Text over an image or
// seeded gradient is always light; over the brand gradient it follows the mode
// (the light-mode brand gradient is a pale tint).
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ImageStyle, StyleProp, ViewStyle } from "react-native";
import { Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { letterGradient } from "../theme";
import type { Theme } from "../theme";
import { useScopedStyles, useScopedTheme } from "./PageScope";
import { Press } from "./Press";
import { Chip } from "./Chip";

export function HeroBand({
  eyebrow,
  title,
  imageUrl,
  gradientSeed,
  chips,
  progress,
  buttonLabel,
  onButtonPress,
  minHeight = 280,
  style,
  children,
}: {
  eyebrow?: string;
  title: string;
  imageUrl?: string | null;
  gradientSeed?: string;
  chips?: string[];
  progress?: { done: number; total: number } | null;
  buttonLabel?: string;
  onButtonPress?: () => void;
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const styles = useScopedStyles(makeStyles);
  const theme = useScopedTheme();
  const { colors } = theme;

  const onDarkSurface = !!imageUrl || !!gradientSeed || theme.mode === "dark";
  const titleColor = onDarkSurface ? colors.heroText : colors.text;
  const softColor = onDarkSurface ? colors.heroTextSoft : colors.textMuted;

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;

  return (
    <View style={[styles.band, { minHeight }, style]}>
      {imageUrl ? (
        <>
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill as StyleProp<ImageStyle>}
            resizeMode="cover"
          />
          <LinearGradient
            colors={[colors.overlayFaint, colors.overlayMid, colors.overlayStrong]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <LinearGradient
          colors={
            gradientSeed
              ? letterGradient(gradientSeed)
              : [colors.gradientStart, colors.gradientEnd]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={styles.inner}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={[styles.title, { color: titleColor }]}>{title}</Text>
        {chips && chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((c) => (
              <Chip key={c} label={c} onHero={onDarkSurface} />
            ))}
          </View>
        ) : null}
        {children}
        {pct !== null && progress ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressLabels}>
              <Text style={[styles.progressLabel, { color: softColor }]}>
                {pct}% complete
              </Text>
              <Text style={[styles.progressLabel, { color: softColor }]}>
                {progress.done} / {progress.total} lessons
              </Text>
            </View>
            <View
              style={[
                styles.track,
                !onDarkSurface && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>
          </View>
        ) : null}
        {buttonLabel && onButtonPress ? (
          <Press style={styles.button} onPress={onButtonPress}>
            <Text style={styles.buttonText}>▶ {buttonLabel}</Text>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = ({ colors, spacing, fonts }: Theme) =>
  StyleSheet.create({
    band: {
      borderRadius: 20,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.borderSoft,
      justifyContent: "flex-end",
    },
    inner: { padding: spacing.lg, gap: spacing.sm },
    eyebrow: {
      color: colors.primarySoft,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 1.6,
    },
    title: { fontSize: 28, fontWeight: "800", fontFamily: fonts.display, lineHeight: 34 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    progressWrap: { gap: 6, marginTop: spacing.xs },
    progressLabels: { flexDirection: "row", justifyContent: "space-between" },
    progressLabel: { fontSize: 12, fontWeight: "600", fontFamily: fonts.semibold },
    track: {
      height: 6,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.18)",
      overflow: "hidden",
    },
    fill: { height: "100%", backgroundColor: colors.primary, borderRadius: 999 },
    button: {
      alignSelf: "flex-start",
      marginTop: spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: 11,
      paddingVertical: 11,
      paddingHorizontal: 18,
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
  });
