// Brand mark for the app header: the configured logo, else the title text —
// the same logo-or-title fallback the admin live-preview shows. Re-renders
// live when the admin saves (ConfigProvider polls while the app is active).
import React from "react";
import { Image, StyleSheet, Text } from "react-native";

import { useAppConfig } from "../config-provider";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

export function BrandHeaderTitle() {
  const { config } = useAppConfig();
  const styles = useStyles(makeStyles);
  return config.logoUrl ? (
    <Image
      source={{ uri: config.logoUrl }}
      style={styles.logo}
      resizeMode="contain"
    />
  ) : (
    <Text style={styles.title} numberOfLines={1}>
      {config.title}
    </Text>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    logo: { height: 26, width: 120 },
    title: { color: colors.text, fontSize: 17, fontWeight: "800", maxWidth: 220 },
  });
