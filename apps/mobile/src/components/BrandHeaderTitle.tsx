// Brand mark: the configured logo, else the spotlight glyph + title text —
// the same logo-or-title fallback the admin live-preview shows. Re-renders
// live when the admin saves (ConfigProvider polls while the app is active).
// `onChrome` renders the text white for the Home band / ink surfaces.
import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { resolveBrandTitle, useAppConfig } from "../config-provider";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";
import { BrandMark } from "./BrandMark";

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi);

// A brand logo can be a SQUARE app-icon tile or a WIDE wordmark, and we don't
// know which until it loads. Fixed w×h boxes broke the square case: a square
// logo stranded (contained + centered) inside a wide box read as a tiny mark
// with a big gap before the title. Measure the real aspect ratio so the logo
// is sized by HEIGHT with a proportional width instead. Defaults to 1 (square,
// the common app-icon case) and stays there if the size can't be read.
function useLogoAspect(url: string | null | undefined): number {
  const [ar, setAr] = useState(1);
  useEffect(() => {
    if (!url) {
      setAr(1);
      return;
    }
    let active = true;
    Image.getSize(
      url,
      (w, h) => {
        if (active && w > 0 && h > 0) setAr(w / h);
      },
      () => {}, // keep the square default when the size can't be fetched
    );
    return () => {
      active = false;
    };
  }, [url]);
  return ar;
}

export function BrandHeaderTitle({ onChrome }: { onChrome?: boolean }) {
  const { config } = useAppConfig();
  const styles = useStyles(makeStyles);
  const brand = resolveBrandTitle(config);
  const ar = useLogoAspect(config.logoUrl);
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
    // Logo + title: the logo is a compact, aspect-correct mark beside the name
    // (a square logo becomes a tidy square chip, not a mark lost in a wide box).
    // Logo only: it fills the brand slot (admin opted out of the title).
    // Logo only gets a bigger fixed height and a wider cap so it reads as the
    // full brand mark (a square logo fills that height; a wide wordmark spans).
    const h = showTitle ? 28 : 34;
    const maxW = showTitle ? 108 : 200;
    return (
      <View style={showTitle ? styles.row : undefined}>
        <Image
          source={{ uri: config.logoUrl }}
          style={[
            styles.logo,
            { height: h, width: clamp(Math.round(h * ar), h, maxW) },
          ]}
          resizeMode="contain"
          accessibilityLabel={brand}
        />
        {showTitle ? titleEl : null}
      </View>
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
    // Rounded so a square, opaque app-icon logo reads as a tidy chip on the ink
    // header band instead of a raw square; harmless on a transparent wordmark.
    // Width is set inline from the logo's real aspect ratio.
    logo: { borderRadius: 7 },
    title: {
      color: colors.text,
      fontSize: 13.5,
      fontFamily: fonts.semibold,
      // Wide enough for the full brand; iOS truncated it at the larger font.
      maxWidth: 240,
    },
    titleOnChrome: { color: colors.onChrome },
  });
