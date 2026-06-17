// All membership plans — native mirror of the web's /pricing/all: the
// member's current plans first, then every other published PAID plan.
// Store rules: tapping an available plan opens its IN-APP class landing
// (marketing + neutral note) — no checkout links, payments stay on the web.
import React, { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { LevelDTO, PriceDTO, SubscriptionDetailDTO } from "@lms/types";

import { api } from "../api";
import { money } from "../format";
import { Chip } from "../components/Chip";
import { Press } from "../components/Press";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import type { ScreenProps } from "../navigation";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

function lowestPrice(prices: PriceDTO[]): PriceDTO | null {
  if (prices.length === 0) return null;
  return prices.reduce((min, p) => (p.amount < min.amount ? p : min), prices[0]);
}

export function PlansScreen({ navigation }: ScreenProps<"Plans">) {
  const styles = useStyles(makeStyles);
  const [levels, setLevels] = useState<LevelDTO[] | null>(null);
  const [subs, setSubs] = useState<SubscriptionDetailDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([
        api.levels(),
        api.mySubscriptionDetails().catch(() => [] as SubscriptionDetailDTO[]),
      ]);
      setLevels(l);
      setSubs(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plans.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!levels) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={96} radius={14} />
        <Skeleton height={96} radius={14} />
        <Skeleton height={96} radius={14} />
      </View>
    );
  }

  // Same split as the web: PAID levels only; "current" = an active sub exists.
  const paid = levels.filter((l) => l.type === "PAID");
  const currentIds = new Set(subs.map((s) => s.levelId));
  const current = paid.filter((l) => currentIds.has(l.id));
  const available = paid.filter((l) => !currentIds.has(l.id));

  const openLanding = (l: LevelDTO) =>
    navigation.navigate("Class", { slugOrId: l.slug ?? l.id, title: l.name });

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>All membership plans</Text>
      <Text style={styles.sub}>Plans unlock more classes and courses.</Text>

      {current.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Your plans</Text>
          {current.map((l) => {
            const sub = subs.find((s) => s.levelId === l.id);
            return (
              <View key={l.id} style={[styles.card, styles.cardCurrent]}>
                <View style={styles.cardHead}>
                  <Text style={styles.name}>{l.name}</Text>
                  <Chip label="Current plan" tone="success" />
                </View>
                {sub ? (
                  <Text style={styles.meta}>
                    {money(sub.amount, sub.currency)} / {sub.interval}
                    {sub.cancelAtPeriodEnd ? " · cancels at period end" : ""}
                  </Text>
                ) : null}
                <TouchableOpacity
                  onPress={() => navigation.navigate("Main", { screen: "Account" })}
                >
                  <Text style={styles.link}>Manage subscription →</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </>
      ) : null}

      {available.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Available plans</Text>
          {available.map((l) => {
            const low = lowestPrice(l.prices);
            return (
              <Press
                key={l.id}
                style={styles.card}
                disabled={!l.published}
                onPress={() => openLanding(l)}
              >
                <Text style={styles.name}>{l.name}</Text>
                <Text style={styles.meta}>
                  {low
                    ? `From ${money(low.amount, low.currency)} / ${low.interval}`
                    : "Pricing coming soon"}
                </Text>
                {l.published ? (
                  <Text style={styles.link}>View details →</Text>
                ) : null}
              </Press>
            );
          })}
        </>
      ) : null}

      <Text style={styles.note}>
        Plan changes and payments are completed on our website.
      </Text>
    </ScrollView>
  );
}

const makeStyles = ({ colors, spacing, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.sm },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    h1: { color: colors.text, fontSize: 24, fontWeight: "800", fontFamily: fonts.display },
    sub: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.sm, fontFamily: fonts.regular },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "800",
      marginTop: spacing.sm,
      fontFamily: fonts.extrabold,
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      gap: 6,
    },
    cardCurrent: { borderColor: colors.primary },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    name: { color: colors.text, fontSize: 16, fontWeight: "700", fontFamily: fonts.bold },
    meta: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
    link: { color: colors.primarySoft, fontSize: 14, fontWeight: "700", fontFamily: fonts.bold },
    note: {
      color: colors.textMuted,
      fontSize: 12.5,
      textAlign: "center",
      marginTop: spacing.md,
      fontFamily: fonts.regular,
    },
  });
