// All membership plans — native mirror of the web's /pricing/all: the
// member's current plans first, then every other published PAID plan.
// Store rules: tapping an available plan opens its IN-APP class landing
// (marketing + neutral note) — no checkout links, payments stay on the web.
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { LevelDTO } from "@lms/types";

import {
  useLevels,
  useMyClasses,
  useMySubscriptionDetails,
  useRefreshOnFocus,
} from "../queries";
import { money } from "../format";
import { Chip } from "../components/Chip";
import { Press } from "../components/Press";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import type { ScreenProps } from "../navigation";
import { contentColumn } from "../responsive";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

export function PlansScreen({ navigation }: ScreenProps<"Plans">) {
  const styles = useStyles(makeStyles);
  // Subscriptions are a shared cache entry with Account (best-effort there and
  // here — the hook resolves [] on a billing hiccup instead of erroring).
  const levelsQuery = useLevels();
  const subsQuery = useMySubscriptionDetails();
  // my-classes carries the authoritative per-class `owned` flag — the API's
  // access.activeLevelIds (a UserLevel row that is ACTIVE and unexpired), which
  // covers EVERY way a member holds a class: a paid subscription AND an admin
  // grant / free / lifetime enrollment. Subscriptions alone miss admin grants,
  // so we use this to keep an already-held class out of "Available plans".
  const myClassesQuery = useMyClasses();
  const levels = levelsQuery.data ?? null;
  const subs = subsQuery.data ?? [];
  const myClasses = myClassesQuery.data ?? null;

  // Refetch on focus so a plan bought/canceled/granted elsewhere shows up.
  useRefreshOnFocus(() => {
    void levelsQuery.refetch();
    void subsQuery.refetch();
    void myClassesQuery.refetch();
  });

  // Same error surface as before the cache: a levels failure shows the error
  // page even after content has rendered (only the subs read is best-effort).
  if (levelsQuery.isError && !levelsQuery.isFetching)
    return (
      <ErrorState
        message={
          levelsQuery.error instanceof Error
            ? levelsQuery.error.message
            : "Failed to load plans."
        }
        onRetry={() => {
          void levelsQuery.refetch();
          void subsQuery.refetch();
        }}
      />
    );

  if (!levels || !myClasses || subsQuery.isLoading) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={96} radius={14} />
        <Skeleton height={96} radius={14} />
        <Skeleton height={96} radius={14} />
      </View>
    );
  }

  // PAID levels only. "current" = a live paid subscription (shown with price +
  // manage). "available" = classes the member holds NO active access to by ANY
  // means — a paid sub OR an admin grant / free / lifetime enrollment — so a
  // class the member already has is never offered as purchasable. A subscribed
  // class is owned too, so ownedIds excludes it from `available`; a granted-but-
  // unsubscribed class shows in neither section (it's already on the dashboard).
  const paid = levels.filter((l) => l.type === "PAID");
  const ownedIds = new Set(myClasses.filter((c) => c.owned).map((c) => c.id));
  const subIds = new Set(subs.map((s) => s.levelId));
  const current = paid.filter((l) => subIds.has(l.id));
  const available = paid.filter((l) => !ownedIds.has(l.id));

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
                  accessibilityRole="button"
                  onPress={() =>
                    navigation.navigate("Main", { screen: "Profile" })
                  }
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
          {/* Store rules (Apple 3.1.1 / Play payments): no prices and no
              purchase-steering copy for plans not owned — names + the in-app
              landing only. */}
          {available.map((l) => (
            <Press
              key={l.id}
              style={styles.card}
              disabled={!l.published}
              accessibilityRole="button"
              onPress={() => openLanding(l)}
            >
              <Text style={styles.name}>{l.name}</Text>
              {l.published ? (
                <Text style={styles.link}>View details →</Text>
              ) : null}
            </Press>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = ({ colors, spacing, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.sm, ...contentColumn },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    h1: {
      color: colors.text,
      fontSize: 24,
      fontWeight: "800",
      fontFamily: fonts.display,
    },
    sub: {
      color: colors.textMuted,
      fontSize: 14,
      marginBottom: spacing.sm,
      fontFamily: fonts.regular,
    },
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
    name: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    meta: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
    link: {
      color: colors.primarySoft,
      fontSize: 14,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
  });
