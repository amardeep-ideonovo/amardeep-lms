// Dashboard class tile (web parity: .md-card) — 16:10 media (cover image or
// deterministic letter-gradient), "✓ Enrolled" badge for owned classes, up to
// two category chips, and a quiet CTA line.
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { ClassTileDTO } from "@lms/types";

import { letterGradient } from "../theme";
import type { Theme } from "../theme";
import { useScopedStyles, useScopedTheme } from "./PageScope";
import { Badge, Chip } from "./Chip";

export function ClassTile({
  cls,
  onPress,
  style,
}: {
  cls: ClassTileDTO;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useScopedStyles(makeStyles);
  const { colors } = useScopedTheme();
  return (
    <TouchableOpacity
      style={[styles.tile, style]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={styles.media}>
        {cls.imageUrl ? (
          <Image
            source={{ uri: cls.imageUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={letterGradient(cls.id)}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={[StyleSheet.absoluteFill, styles.letterWrap]}
          >
            <Text style={styles.letter}>{cls.name.slice(0, 1).toUpperCase()}</Text>
          </LinearGradient>
        )}
        {cls.owned ? (
          <View style={styles.badge}>
            <Badge label="Enrolled" />
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {cls.name}
        </Text>
        {cls.categories.length > 0 ? (
          <View style={styles.chips}>
            {cls.categories.slice(0, 2).map((c) => (
              <Chip key={c.id} label={c.name} />
            ))}
          </View>
        ) : null}
        <Text
          style={[styles.cta, cls.owned && { color: colors.primarySoft }]}
          numberOfLines={1}
        >
          {cls.owned ? "Continue →" : "View class →"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = ({ colors, spacing, fonts }: Theme) =>
  StyleSheet.create({
    tile: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      overflow: "hidden",
    },
    media: { aspectRatio: 16 / 10, backgroundColor: colors.surfaceMuted },
    letterWrap: { alignItems: "center", justifyContent: "center" },
    letter: {
      color: "#ffffff",
      fontSize: 44,
      fontWeight: "800",
      fontFamily: fonts.extrabold,
    },
    badge: { position: "absolute", top: spacing.sm, left: spacing.sm },
    body: { padding: spacing.sm + 4, gap: 6 },
    name: { color: colors.text, fontSize: 16, fontWeight: "700", fontFamily: fonts.bold },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    cta: { color: colors.textMuted, fontSize: 13, fontWeight: "700", fontFamily: fonts.bold },
  });
