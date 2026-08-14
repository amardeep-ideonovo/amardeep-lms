import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import * as SplashScreen from "expo-splash-screen";

import { DEFAULT_APP_CONFIG, paletteFrom, fonts } from "../theme";

// Animated boot splash (~2s): the Spark lockup — teal S-tile with the white
// spark, lowercase wordmark — settles in over the ink canvas while the app
// loads underneath, then the whole overlay fades out. Rendered as a top-level
// overlay in App.tsx the moment fonts are ready. The NATIVE splash (same
// lockup) auto-hides exactly when the first RN frame draws — and that first
// frame IS this overlay — so cold start reads as one continuous splash that
// comes alive. (Deliberately NO preventAutoHideAsync: holding the splash
// window breaks cold starts in the expo-dev-client, and auto-hide already
// hands over seamlessly.) Uses the default (unbranded) palette: this plays
// before any instance branding is known.
const ENTER_TILE_MS = 450;
const ENTER_WORD_MS = 500;
const SPARK_MS = 350;
const HOLD_MS = 700;
const FADE_OUT_MS = 350;

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const colors = paletteFrom(DEFAULT_APP_CONFIG.dark, "dark");
  const tile = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const spark = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Belt-and-braces: auto-hide has normally dismissed the native splash by
    // now; this is a no-op then, and covers any edge where it hasn't.
    SplashScreen.hideAsync().catch(() => {});
    Animated.sequence([
      Animated.parallel([
        Animated.timing(tile, {
          toValue: 1,
          duration: ENTER_TILE_MS,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        Animated.timing(word, {
          toValue: 1,
          duration: ENTER_WORD_MS,
          delay: 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(spark, {
        toValue: 1,
        duration: SPARK_MS,
        easing: Easing.out(Easing.back(2.2)),
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_MS),
      Animated.timing(out, {
        toValue: 1,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => onDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.overlay,
        { backgroundColor: colors.bg },
        {
          opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        },
      ]}
    >
      <Animated.View
        style={[
          styles.tile,
          { backgroundColor: colors.primary },
          {
            opacity: tile,
            transform: [
              {
                scale: tile.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.82, 1],
                }),
              },
            ],
          },
        ]}
      >
        <Text style={[styles.tileS, { color: colors.onPrimary }]}>S</Text>
        <Animated.View
          style={[
            styles.tileSpark,
            {
              opacity: spark,
              transform: [
                { rotate: "45deg" },
                {
                  scale: spark.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.2, 1],
                  }),
                },
              ],
            },
          ]}
        />
      </Animated.View>
      <Animated.View
        style={{
          opacity: word,
          transform: [
            {
              translateY: word.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
          alignItems: "center",
        }}
      >
        <Text style={[styles.wordmark, { color: colors.text }]}>spotlight</Text>
        <Text style={[styles.wordmarkSub, { color: colors.textMuted }]}>
          ACADEMY
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Literal inset keys on purpose: spreading StyleSheet.absoluteFillObject
  // here was dropped by the current RN/Fabric style pipeline (the overlay
  // rendered in flow, below the gate content). elevation backs up zIndex for
  // Android stacking.
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    elevation: 100,
  },
  tile: {
    width: 96,
    height: 96,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  tileS: { fontFamily: fonts.bold, fontSize: 52, lineHeight: 62 },
  tileSpark: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 15,
    height: 15,
    borderRadius: 3,
    backgroundColor: "#ffffff",
  },
  wordmark: { fontFamily: fonts.bold, fontSize: 36, letterSpacing: -0.5 },
  // letterSpacing trails each glyph; pad left one step to keep it centered.
  wordmarkSub: {
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: 6,
    paddingLeft: 6,
    marginTop: 6,
  },
});
