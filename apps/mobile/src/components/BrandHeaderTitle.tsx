// Brand mark: the configured logo, else the spotlight glyph + title text —
// the same logo-or-title fallback the admin live-preview shows. Re-renders
// live when the admin saves (ConfigProvider polls while the app is active).
// `onChrome` renders the text white for the Home band / ink surfaces.
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useAppConfig } from "../config-provider";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";
import { SpotlightMark } from "./SpotlightMark";

export function BrandHeaderTitle({ onChrome }: { onChrome?: boolean }) {
  const { config } = useAppConfig();
  const styles = useStyles(makeStyles);
  return config.logoUrl ? (
    <Image
      source={{ uri: config.logoUrl }}
      style={styles.logo}
      resizeMode="contain"
      accessibilityLabel={config.title}
    />
  ) : (
    <View style={styles.row}>
      <SpotlightMark size={20} />
      <Text
        style={[styles.title, onChrome && styles.titleOnChrome]}
        numberOfLines={1}
      >
        {config.title}
      </Text>
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 9 },
    logo: { height: 26, width: 120 },
    title: {
      color: colors.text,
      fontSize: 13.5,
      fontFamily: fonts.semibold,
      // Wide enough for the full brand; iOS truncated it at the larger font.
      maxWidth: 240,
    },
    titleOnChrome: { color: "#ffffff" },
  });
