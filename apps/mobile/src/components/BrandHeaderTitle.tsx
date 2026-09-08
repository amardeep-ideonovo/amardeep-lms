// Brand mark: the configured logo, else the spotlight glyph + title text —
// the same logo-or-title fallback the admin live-preview shows. Re-renders
// live when the admin saves (ConfigProvider polls while the app is active).
// `onChrome` renders the text white for the Home band / ink surfaces.
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { resolveBrandTitle, useAppConfig } from "../config-provider";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";
import { BrandMark } from "./BrandMark";

export function BrandHeaderTitle({ onChrome }: { onChrome?: boolean }) {
  const { config } = useAppConfig();
  const styles = useStyles(makeStyles);
  const brand = resolveBrandTitle(config);
  // Show the title next to the logo (default), unless the admin turned it off.
  const showTitle = config.showTitleWithLogo !== false;
  const titleEl = (
    <Text
      style={[styles.title, onChrome && styles.titleOnChrome]}
      numberOfLines={1}
    >
      {brand}
    </Text>
  );
  if (config.logoUrl) {
    // Logo + title: the logo shrinks to a mark beside the name. Logo only: the
    // logo takes the full brand slot (admin opted out of the title).
    return showTitle ? (
      <View style={styles.row}>
        <Image
          source={{ uri: config.logoUrl }}
          style={styles.logoSmall}
          resizeMode="contain"
          accessibilityLabel={brand}
        />
        {titleEl}
      </View>
    ) : (
      <Image
        source={{ uri: config.logoUrl }}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel={brand}
      />
    );
  }
  return (
    <View style={styles.row}>
      <BrandMark size={20} />
      {titleEl}
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 9 },
    logo: { height: 26, width: 120 },
    // Compact mark when shown beside the title in the header row.
    logoSmall: { height: 24, width: 84 },
    title: {
      color: colors.text,
      fontSize: 13.5,
      fontFamily: fonts.semibold,
      // Wide enough for the full brand; iOS truncated it at the larger font.
      maxWidth: 240,
    },
    titleOnChrome: { color: colors.onChrome },
  });
