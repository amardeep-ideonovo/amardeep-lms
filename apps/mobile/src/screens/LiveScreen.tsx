// Live tab — the member's upcoming + in-progress live sessions (same
// entitlement-filtered /live/current feed as the Home strip) as ink cards
// with computed LIVE / countdown chips, per the Ink Hero design. Joining goes
// through the existing LiveSessionScreen flow (two-tier credential release).
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import type { LiveSessionBarDTO } from "@lms/types";

import { api } from "../api";
import { CtaButton } from "../components/CtaButton";
import { fmtSessionWhen, phaseOf } from "../components/LiveSessionBar";
import { Press } from "../components/Press";
import { ErrorState } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { fmtDate } from "../format";
import type { TabScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

const pad = (n: number) => String(n).padStart(2, "0");

// Chip copy per design ("LIVE IN 2 DAYS" computed from the session datetime).
function chipLabel(s: LiveSessionBarDTO, now: number): string {
  const ph = phaseOf(s, now);
  if (ph === "live") return "LIVE NOW";
  if (ph === "joinable") return "DOORS OPEN";
  const ms = Date.parse(s.startsAt) - now;
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / (60 * 24));
  if (days >= 2) return `LIVE IN ${days} DAYS`;
  const h = Math.floor(mins / 60);
  if (h >= 1) return `LIVE IN ${h}H ${pad(mins % 60)}M`;
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `LIVE IN ${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
}

export function LiveScreen({ navigation }: TabScreenProps<"Live">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const [sessions, setSessions] = useState<LiveSessionBarDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.liveCurrent();
      if (list.length) {
        offsetRef.current = Date.parse(list[0].serverNow) - Date.now();
      }
      setSessions(list);
      loadedOnce.current = true;
    } catch {
      if (!loadedOnce.current) setError("Could not load live sessions.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Tick the server-offset clock so LIVE flips and countdowns run.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  if (!sessions) {
    return (
      <View style={styles.skeletonWrap}>
        <Skeleton height={140} radius={16} />
        <Skeleton height={140} radius={16} />
      </View>
    );
  }

  const visible = sessions.filter((s) => phaseOf(s, now) !== "ended");

  const open = (s: LiveSessionBarDTO) =>
    navigation.navigate("LiveSession", { sessionId: s.id, title: s.title });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {visible.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Ionicons name="videocam-outline" size={22} color={colors.primarySoft} />
          </View>
          <Text style={styles.emptyTitle}>No live sessions right now</Text>
          <Text style={styles.emptyBody}>
            When an instructor schedules a session for your classes, it shows
            up here with a join button.
          </Text>
        </View>
      ) : (
        visible.map((s) => {
          const ph = phaseOf(s, now);
          const isLive = ph === "live";
          const joinable = isLive || ph === "joinable";
          return (
            <Press key={s.id} style={styles.card} onPress={() => open(s)}>
              <View style={styles.topRow}>
                <View style={[styles.chip, isLive ? styles.chipLive : styles.chipSoon]}>
                  {isLive ? <View style={styles.liveDot} /> : null}
                  <Text
                    style={[
                      styles.chipText,
                      isLive ? styles.chipTextLive : styles.chipTextSoon,
                    ]}
                  >
                    {chipLabel(s, now)}
                  </Text>
                </View>
                <Text style={styles.when} numberOfLines={1}>
                  {fmtDate(s.startsAt)} · {fmtSessionWhen(s.startsAt)}
                </Text>
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {s.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {s.audienceLabel}
              </Text>
              {s.description ? (
                <Text style={styles.desc} numberOfLines={2}>
                  {s.description}
                </Text>
              ) : null}
              <CtaButton
                style={styles.join}
                label={joinable ? "Join session" : "View details"}
                onPress={() => open(s)}
              />
            </Press>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: 12 },
    skeletonWrap: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: spacing.md,
      gap: spacing.sm,
    },

    card: {
      backgroundColor: colors.inkCard,
      borderRadius: 16,
      padding: 16,
      gap: 4,
    },
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginBottom: 6,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    chipLive: { backgroundColor: "rgba(234,79,79,0.2)" },
    chipSoon: { backgroundColor: `${colors.primary}33` },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
    chipText: { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.8 },
    chipTextLive: { color: "#ff9d9d" },
    chipTextSoon: { color: colors.primaryOnDark },
    when: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 10.5,
      fontFamily: fonts.regular,
      flexShrink: 1,
    },
    title: { color: "#ffffff", fontSize: 15, fontFamily: fonts.bold, lineHeight: 20 },
    meta: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 11.5,
      fontFamily: fonts.regular,
    },
    desc: {
      color: "rgba(255,255,255,0.75)",
      fontSize: 12,
      lineHeight: 17,
      fontFamily: fonts.regular,
      marginTop: 2,
    },
    join: { marginTop: 12 },

    emptyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 16,
      padding: spacing.lg,
      alignItems: "center",
      gap: 6,
      marginTop: spacing.md,
    },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.successBg,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
    emptyBody: {
      color: colors.textMuted,
      fontSize: 12.5,
      lineHeight: 18,
      textAlign: "center",
      fontFamily: fonts.regular,
    },
  });
