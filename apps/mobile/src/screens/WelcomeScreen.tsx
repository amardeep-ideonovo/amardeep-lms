import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formColumn } from "../responsive";
import { DEFAULT_APP_CONFIG, paletteFrom, fonts, spacing } from "../theme";

// Landing screen of the SHARED app — the first thing an unbound install shows,
// after the animated boot splash and before the Connect screen. The splash
// already carries the logo lockup, so this screen leads with a learning
// headline instead (owner's review call: no logo here) + a single "Start
// here" CTA that hands over to ConnectScreen. White-label / locked builds
// never see this (InstanceGate passes them straight through), and an explicit
// "Switch academy" unbind skips it too — that lands directly on Connect.
export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const colors = useMemo(
    () => paletteFrom(DEFAULT_APP_CONFIG.dark, "dark"),
    [],
  );
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {/* Small spark accent — brand cue without repeating the splash logo */}
        <View style={styles.sparkRow}>
          <View style={[styles.spark, { backgroundColor: colors.primary }]} />
          <View style={[styles.sparkSmall, { backgroundColor: colors.primaryOnDark }]} />
        </View>
        <Text style={styles.headline}>
          Experience the best{"\n"}of learning.
        </Text>
        <Text style={styles.tagline}>
          Courses &amp; memberships from your academy — wherever you are.
        </Text>
      </View>
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
      >
        <Pressable onPress={onStart} style={styles.button}>
          <Text style={styles.buttonText}>Start here</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Colors = ReturnType<typeof paletteFrom>;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    body: { flex: 1, alignItems: "center", justifyContent: "center" },
    sparkRow: {
      width: 44,
      height: 34,
      marginBottom: 26,
    },
    spark: {
      position: "absolute",
      left: 4,
      top: 8,
      width: 22,
      height: 22,
      borderRadius: 5,
      transform: [{ rotate: "45deg" }],
    },
    sparkSmall: {
      position: "absolute",
      right: 2,
      top: 0,
      width: 12,
      height: 12,
      borderRadius: 3,
      transform: [{ rotate: "45deg" }],
    },
    headline: {
      color: colors.text,
      fontFamily: fonts.display,
      fontSize: 34,
      lineHeight: 42,
      textAlign: "center",
      letterSpacing: -0.5,
    },
    tagline: {
      color: colors.textMuted,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
      marginTop: 16,
      paddingHorizontal: 44,
    },
    footer: { paddingHorizontal: spacing.lg, ...formColumn },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: "center",
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 16.5,
      fontFamily: fonts.bold,
    },
  });
