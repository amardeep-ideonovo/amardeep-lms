// Shared auth-screen brand lockup: the admin-uploaded logo, else the brand mark
// + the configured title, with an optional tagline underneath. LoginScreen and
// SignupScreen rendered byte-identical copies of this (differing only in the
// mark/title size), so it now lives in one place. `size` drives both the mark
// and the title font (26 on sign-in, 24 on sign-up).
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useAppConfig } from "../config-provider";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";
import { BrandMark } from "./BrandMark";

export function AuthBrand({ size = 24 }: { size?: number }) {
  const { config } = useAppConfig();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.brandBlock}>
      {config.logoUrl ? (
        <Image
          source={{ uri: config.logoUrl }}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={config.title}
        />
      ) : (
        <View style={styles.brandRow}>
          <BrandMark size={size} />
          <Text style={[styles.brand, { fontSize: size }]}>{config.title}</Text>
        </View>
      )}
      {config.tagline ? (
        <Text style={styles.tagline}>{config.tagline}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    brandBlock: { alignItems: "center", marginBottom: spacing.lg },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    brand: {
      color: colors.heroText,
      fontFamily: fonts.bold,
      textAlign: "center",
    },
    logo: {
      height: 56,
      width: 220,
      alignSelf: "center",
    },
    tagline: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 13,
      textAlign: "center",
      marginTop: spacing.sm,
      fontFamily: fonts.regular,
    },
  });
