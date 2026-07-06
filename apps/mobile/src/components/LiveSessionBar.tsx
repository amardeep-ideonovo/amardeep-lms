// Live-session ink strip (design frame 1f): an ink card per session with the
// red dot + "LIVE · TUE 7:00 PM" eyebrow, session title, and a teal pill on
// the right. The server only returns sessions the member is entitled to, so
// this just renders them; nothing shows when the list is empty. The countdown
// tracks the SERVER clock via an offset derived from serverNow.
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
export function phaseOf(s: LiveSessionBarDTO, now: number): Phase {
  const starts = Date.parse(s.startsAt);
  const joins = Date.parse(s.joinsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= ends) return "ended";
  if (now >= starts) return "live";
  if (now >= joins) return "joinable";
  return "upcoming";
}

// "TUE 7:00 PM" — the design's eyebrow datetime.
export function fmtSessionWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d
      .toLocaleDateString(undefined, { weekday: "short" })
      .toUpperCase();
    const time = d
      .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      .toUpperCase()
      .replace(/\s+/g, " ");
    return `${day} ${time}`;
  } catch {
    return "";
  }
}

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
    <View style={styles.wrap}>
      {visible.map((s) => {
        const ph = phaseOf(s, now);
        const joinable = ph === "joinable" || ph === "live";
        const startsIn = Date.parse(s.startsAt) - now;
        const eyebrow =
          ph === "live"
            ? "LIVE · NOW"
            : startsIn < 3_600_000
              ? `LIVE · IN ${countdown(startsIn)}`
              : `LIVE · ${fmtSessionWhen(s.startsAt)}`;
        return (
          <Press key={s.id} style={styles.card} onPress={() => onOpen(s)}>
            <View style={styles.info}>
              <View style={styles.eyebrowRow}>
                <View style={styles.dot} />
                <Text style={styles.eyebrow} numberOfLines={1}>
                  {eyebrow}
                </Text>
              </View>
              <Text style={styles.title} numberOfLines={1}>
                {s.title}
              </Text>
            </View>
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {joinable ? "Join" : "Details"}
              </Text>
            </View>
          </Press>
        );
      })}
    </View>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    wrap: { gap: spacing.sm },
    card: {
      backgroundColor: colors.inkCard,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    info: { flex: 1, minWidth: 0, gap: 1 },
    eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
    eyebrow: {
      color: "rgba(255,255,255,0.6)",
      fontSize: 9.5,
      fontFamily: fonts.bold,
      letterSpacing: 0.8,
    },
    title: { color: "#ffffff", fontSize: 12.5, fontFamily: fonts.semibold },
    pill: {
      backgroundColor: `${colors.primary}33`,
      borderRadius: 999,
      paddingVertical: 7,
      paddingHorizontal: 13,
    },
    pillText: {
      color: colors.primaryOnDark,
      fontSize: 11,
      fontFamily: fonts.bold,
    },
  });
