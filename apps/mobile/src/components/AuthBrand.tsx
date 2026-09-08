// Shared auth-screen brand lockup: the admin-uploaded logo, else the brand mark
// + the configured title, with an optional tagline underneath. LoginScreen and
// SignupScreen rendered byte-identical copies of this (differing only in the
// mark/title size), so it now lives in one place. `size` drives both the mark
// and the title font (26 on sign-in, 24 on sign-up).
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { resolveBrandTitle, useAppConfig } from "../config-provider";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";
import { BrandMark } from "./BrandMark";

export function AuthBrand({ size = 24 }: { size?: number }) {
  const { config } = useAppConfig();
  const styles = useStyles(makeStyles);
  // The academy's real name (custom title, else the bound academy's name from
  // the connect code, else a neutral generic) — never the operator's default.
  const brand = resolveBrandTitle(config);
  return (
    <View style={styles.brandBlock}>
      {config.logoUrl ? (
        <Image
          source={{ uri: config.logoUrl }}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={brand}
        />
      ) : (
        <View style={styles.brandRow}>
          <BrandMark size={size} />
          <Text style={[styles.brand, { fontSize: size }]}>{brand}</Text>
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
      // On the auth chrome canvas — derive from the (overridable) band color so
      // the title stays legible even on a light Header band.
      color: colors.onChrome,
      fontFamily: fonts.bold,
      textAlign: "center",
    },
    logo: {
      height: 56,
      width: 220,
      alignSelf: "center",
    },
    tagline: {
      color: colors.onChromeSoft,
      fontSize: 13,
      textAlign: "center",
      marginTop: spacing.sm,
      fontFamily: fonts.regular,
    },
  });
