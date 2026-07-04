import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LiveSessionBarDTO } from "@lms/types";

import { Press } from "./Press";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles } from "../theme-provider";

const pad = (n: number) => String(n).padStart(2, "0");
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

type Phase = "upcoming" | "joinable" | "live" | "ended";
function phaseOf(s: LiveSessionBarDTO, now: number): Phase {
  const starts = Date.parse(s.startsAt);
  const joins = Date.parse(s.joinsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= ends) return "ended";
  if (now >= starts) return "live";
  if (now >= joins) return "joinable";
  return "upcoming";
}

// Dashboard live-session bar. The server only returns sessions the member is
// entitled to, so this just renders them; nothing shows when the list is empty.
// The countdown tracks the SERVER clock via an offset derived from serverNow.
export function LiveSessionBar({
  sessions,
  onOpen,
}: {
  sessions: LiveSessionBarDTO[];
  onOpen: (s: LiveSessionBarDTO) => void;
}) {
  const styles = useStyles(makeStyles);
  const offsetRef = useRef(
    sessions.length ? Date.parse(sessions[0].serverNow) - Date.now() : 0,
  );
  const [now, setNow] = useState(() => Date.now() + offsetRef.current);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  const visible = sessions.filter((s) => phaseOf(s, now) !== "ended");
  if (visible.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.eyebrowRow}>
        <View style={styles.dot} />
        <Text style={styles.eyebrow}>LIVE SESSION</Text>
      </View>
      {visible.map((s) => {
        const ph = phaseOf(s, now);
        const joinable = ph === "joinable" || ph === "live";
        return (
          <Press key={s.id} style={styles.row} onPress={() => onOpen(s)}>
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={1}>
                {s.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {s.audienceLabel}
              </Text>
            </View>
            <View style={styles.right}>
              {ph === "live" ? (
                <Text style={styles.liveBadge}>● Live</Text>
              ) : (
                <Text style={styles.count}>
                  in {countdown(Date.parse(s.startsAt) - now)}
                </Text>
              )}
              <View style={[styles.cta, joinable && styles.ctaOn]}>
                <Text style={[styles.ctaText, joinable && styles.ctaTextOn]}>
                  {joinable ? "Join" : "Details"}
                </Text>
              </View>
            </View>
          </Press>
        );
      })}
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.sm,
    },
    eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
    eyebrow: {
      color: colors.textMuted,
      fontSize: 11.5,
      fontFamily: fonts.bold,
      letterSpacing: 1,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      backgroundColor: colors.chipBg,
      borderRadius: 12,
      padding: spacing.sm,
    },
    info: { flex: 1, minWidth: 0 },
    title: { color: colors.text, fontSize: 14.5, fontFamily: fonts.bold },
    meta: {
      color: colors.textMuted,
      fontSize: 12,
      fontFamily: fonts.regular,
      marginTop: 1,
    },
    right: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    count: { color: colors.text, fontSize: 13, fontFamily: fonts.bold },
    liveBadge: { color: colors.success, fontSize: 12.5, fontFamily: fonts.extrabold },
    cta: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.borderSoft,
    },
    ctaOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    ctaText: { color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.bold },
    ctaTextOn: { color: colors.onPrimary },
  });
