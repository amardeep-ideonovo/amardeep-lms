import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as SecureStore from "expo-secure-store";

import { DEFAULT_APP_CONFIG, paletteFrom, fonts } from "../theme";
import {
  APP_CONFIG_CACHE_BASE,
  IS_LOCKED_BUILD,
  loadInstanceBinding,
  scopedKey,
  storageScopeFor,
} from "../config";
import { splashBrand, type SplashBrand } from "../splash-brand";

// Animated boot splash (~2s): brand tile + wordmark settle in over the ink
// canvas while the app loads underneath, then the whole overlay fades out.
// Rendered as a top-level overlay in App.tsx — OUTSIDE ConfigProvider — the
// moment fonts are ready. The NATIVE splash auto-hides exactly when the first
// RN frame draws, and that first frame IS this overlay, so cold start reads as
// one continuous splash that comes alive. (Deliberately NO
// preventAutoHideAsync: holding the splash window breaks cold starts in the
// expo-dev-client, and auto-hide already hands over seamlessly.)
//
// BRANDING: the tile initial + wordmark resolve from storage at mount — the
// bound instance's cached AppConfig title (else the connect-time instance
// name), the product-default lockup only on an UNBOUND shared install, and the
// bare mark while no brand is known (e.g. a locked build's very first run).
// Hardcoding the product wordmark here was a white-label bug: every client's
// members saw it on every cold start. CANVAS COLORS stay the default dark
// palette on purpose — the native splash beneath uses the binary's baked
// assets, so recoloring the JS overlay would flash at the native→JS handover.
const ENTER_TILE_MS = 450;
const ENTER_WORD_MS = 500;
const SPARK_MS = 350;
const HOLD_MS = 700;
const FADE_OUT_MS = 350;

async function readCachedTitle(key: string): Promise<string | null> {
  const raw =
    Platform.OS === "web"
      ? typeof localStorage !== "undefined"
        ? localStorage.getItem(key)
        : null
      : await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { title?: unknown };
  return typeof parsed.title === "string" && parsed.title.trim()
    ? parsed.title.trim()
    : null;
}

// Decide the splash brand from storage alone: this component renders before
// ConfigProvider exists, so the provider's state is not available yet.
async function resolveBootBrand(): Promise<SplashBrand> {
  try {
    if (IS_LOCKED_BUILD) {
      // Locked builds keep un-namespaced keys (see scopedKey) and are always
      // bound to one client — an empty cache means "brand unknown", never the
      // product default (the native splash beneath already carries the
      // client's baked branding).
      const title = await readCachedTitle(scopedKey(APP_CONFIG_CACHE_BASE));
      return splashBrand(title, DEFAULT_APP_CONFIG.title);
    }
    const binding = await loadInstanceBinding();
    if (!binding) {
      // Unbound shared install: the connect flow is next, so the product's
      // own identity is the correct brand.
      return splashBrand(DEFAULT_APP_CONFIG.title, DEFAULT_APP_CONFIG.title);
    }
    // Bound shared install. The live scope isn't applied this early in boot
    // (InstanceGate does that), so derive the cache key from the STORED
    // binding rather than scopedKey().
    const title = await readCachedTitle(
      `${APP_CONFIG_CACHE_BASE}.${storageScopeFor(binding.apiUrl)}`,
    );
    return splashBrand(title ?? binding.name ?? null, DEFAULT_APP_CONFIG.title);
  } catch {
    // On any read/parse failure: showing no brand beats showing a wrong one.
    return { kind: "mark" };
  }
}

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const colors = paletteFrom(DEFAULT_APP_CONFIG.dark, "dark");
  const [brand, setBrand] = useState<SplashBrand | null>(null);
  const tile = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const spark = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Storage reads settle in a few ms — well inside the tile's 450ms
    // fade-in — so the text lands before the wordmark animation is visible.
    let alive = true;
    void resolveBootBrand().then((b) => {
      if (alive) setBrand(b);
    });
    return () => {
      alive = false;
    };
  }, []);

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
        {brand && brand.kind !== "mark" ? (
          <Text style={[styles.tileS, { color: colors.onPrimary }]}>
            {brand.initial}
          </Text>
        ) : null}
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
        style={[
          styles.word,
          {
            opacity: word,
            transform: [
              {
                translateY: word.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, 0],
                }),
              },
            ],
          },
        ]}
      >
        {brand?.kind === "lockup" ? (
          <>
            <Text style={[styles.wordmark, { color: colors.text }]}>
              {brand.word}
            </Text>
            {brand.sub ? (
              <Text style={[styles.wordmarkSub, { color: colors.textMuted }]}>
                {brand.sub}
              </Text>
            ) : null}
          </>
        ) : brand?.kind === "title" ? (
          <Text
            style={[
              styles.wordmark,
              styles.wordmarkTitle,
              { color: colors.text },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {brand.title}
          </Text>
        ) : null}
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
  word: { alignItems: "center", maxWidth: "84%" },
  wordmark: { fontFamily: fonts.bold, fontSize: 36, letterSpacing: -0.5 },
  wordmarkTitle: { textAlign: "center" },
  // letterSpacing trails each glyph; pad left one step to keep it centered.
  wordmarkSub: {
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: 6,
    paddingLeft: 6,
    marginTop: 6,
  },
});
