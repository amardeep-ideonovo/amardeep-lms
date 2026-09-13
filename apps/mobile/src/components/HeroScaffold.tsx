// Shared full-bleed hero header — the "Ink Hero" band the redesign puts at the
// top of Class / Course / Lesson / Dashboard / Account. One structural container
// with three fills:
//   • "photo" — a cover image under the app's standard dark scrim (Class, Course)
//   • "chrome" — the admin brand-chrome fill (Home, Profile)
//   • "ink"   — the fixed navy ink surface (Lesson band)
// It bleeds edge-to-edge and up under the status bar (image/fill reach y=0), caps
// its OVERLAID content to the reading column on tablets (band vs bandInner, like
// DashboardScreen), and reserves bottom space (`overlapReserve`) so the screen's
// body can pull up `HERO_OVERLAP` and float over it. StatusBar + the ink/chrome
// overscroll bounce cover are handled here so every screen gets them for free.
import React from "react";
import { Image, StyleSheet, View } from "react-native";
import type { ImageStyle, StyleProp, ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";

import { letterGradient, spacing } from "../theme";
import type { Theme } from "../theme";
import { contentColumn } from "../responsive";
import { useStyles, useTheme } from "../theme-provider";

// How far the body pulls up into the hero (its marginTop is -HERO_OVERLAP). The
// hero's default overlapReserve is a little larger so a strip of the header still
// shows between its title and the overlapping card.
export const HERO_OVERLAP = 46;

type HeroVariant = "photo" | "chrome" | "ink";

export function HeroScaffold({
  variant = "photo",
  imageUrl,
  gradientSeed,
  minHeight,
  overlapReserve = 64,
  anchor,
  bounce = true,
  children,
  style,
}: {
  variant?: HeroVariant;
  imageUrl?: string | null; // "photo" variant cover
  gradientSeed?: string; // image-less fallback (deterministic brand gradient)
  minHeight?: number;
  overlapReserve?: number;
  // Where the overlaid content sits: photo heroes anchor their title to the
  // BOTTOM (over the image); chrome/ink bands flow from the TOP under the status
  // bar. Defaults follow the variant; pass to override.
  anchor?: "top" | "bottom";
  bounce?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  // Photo + ink sit on a fixed dark surface; chrome uses the admin brand band.
  const bandColor = variant === "chrome" ? colors.chrome : colors.inkCard;
  // Dark scrim/ink → light status icons; chrome follows its on-chrome contrast.
  const statusStyle =
    variant === "chrome"
      ? colors.onChrome === "#ffffff"
        ? "light"
        : "dark"
      : "light";
  const contentAnchor = anchor ?? (variant === "photo" ? "bottom" : "top");
  const defaultMinHeight = variant === "photo" ? 360 : undefined;

  return (
    <View
      style={[
        styles.band,
        {
          backgroundColor: bandColor,
          minHeight: minHeight ?? defaultMinHeight,
          paddingTop: insets.top + 8,
          justifyContent:
            contentAnchor === "bottom" ? "flex-end" : "flex-start",
        },
        style,
      ]}
    >
      {isFocused ? <StatusBar style={statusStyle} /> : null}

      {/* Keeps the iOS rubber-band overscroll the same dark/brand color instead
          of flashing the light page bg behind light status icons. */}
      {bounce ? (
        <View style={[styles.bounce, { backgroundColor: bandColor }]} />
      ) : null}

      {/* Photo variant: cover image + the app's standard 3-stop dark scrim (the
          same overlay tokens as HeroBand), or a deterministic brand gradient when
          there's no image. Chrome/ink paint the flat bandColor only. */}
      {variant === "photo" && imageUrl ? (
        <>
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill as StyleProp<ImageStyle>}
            resizeMode="cover"
          />
          <LinearGradient
            colors={[
              colors.overlayFaint,
              colors.overlayMid,
              colors.overlayStrong,
            ]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : variant === "photo" && gradientSeed ? (
        <LinearGradient
          colors={letterGradient(gradientSeed)}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {/* Overlaid content: full-bleed background, but the text column is capped
          and centered on tablets (mirrors band vs bandInner). */}
      <View style={[styles.inner, { paddingBottom: overlapReserve }]}>
        {children}
      </View>
    </View>
  );
}

const makeStyles = (_theme: Theme) =>
  StyleSheet.create({
    band: {
      width: "100%",
      position: "relative",
    },
    bounce: {
      position: "absolute",
      top: -600,
      left: 0,
      right: 0,
      height: 600,
    },
    inner: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      ...contentColumn,
    },
  });
