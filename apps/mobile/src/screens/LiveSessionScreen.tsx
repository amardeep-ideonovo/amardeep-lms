// Member live-session join screen. On mobile the reliable pattern is to open
// the meeting in the native Zoom / Google Meet app via Linking (no in-page embed
// — RN/Expo has no maintained native Zoom Meeting SDK, and a WebViewed meeting is
// blocked/forced to the app). Mirrors the web join page's states: locked / 404 /
// canceled / countdown-before-window / ready-to-join / ended.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LiveJoinCredentialsDTO, LiveSessionBarDTO } from "@lms/types";

import { ApiError, api } from "../api";
import { ErrorState, Loading } from "../components/Screen";
import { Press } from "../components/Press";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";
import type { ScreenProps } from "../navigation";

const pad = (n: number) => String(n).padStart(2, "0");
function bigCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${pad(m)}m ${pad(sec)}s`;
}
function providerName(p: LiveSessionBarDTO["provider"]): string {
  return p === "ZOOM" ? "Zoom" : "Google Meet";
}
function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)/i);
  return m ? m[1] : url;
}

type Status = "loading" | "locked" | "notfound" | "canceled" | "error" | "ok";

export function LiveSessionScreen({ route }: ScreenProps<"LiveSession">) {
  const { sessionId } = route.params;
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const [session, setSession] = useState<LiveSessionBarDTO | null>(null);
  const [creds, setCreds] = useState<LiveJoinCredentialsDTO | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const loadShell = useCallback(async () => {
    setStatus("loading");
    try {
      const s = await api.liveSession(sessionId);
      offsetRef.current = Date.parse(s.serverNow) - Date.now();
      setSession(s);
      setStatus("ok");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) return setStatus("locked");
        if (err.status === 410) return setStatus("canceled");
        if (err.status === 404) return setStatus("notfound");
      }
      setErrorMsg(err instanceof Error ? err.message : "Failed to load session.");
      setStatus("error");
    }
  }, [sessionId]);

  useEffect(() => {
    loadShell();
  }, [loadShell]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  const startsMs = session ? Date.parse(session.startsAt) : 0;
  const joinsMs = session ? Date.parse(session.joinsAt) : 0;
  const endsMs = session ? Date.parse(session.endsAt) : 0;
  const ended = !!session && now >= endsMs;
  const canJoin = !!session && now >= joinsMs && now < endsMs;

  // Fetch the join URL + passcode only once inside the window (never before).
  useEffect(() => {
    if (status !== "ok" || !canJoin || creds) return;
    let alive = true;
    api
      .liveCredentials(sessionId)
      .then((c) => {
        if (alive) setCreds(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status, canJoin, creds, sessionId]);

  if (status === "loading") return <Loading />;
  if (status === "locked")
    return <ErrorState message="You don’t have access to this live session." />;
  if (status === "notfound")
    return <ErrorState message="This live session doesn’t exist." />;
  if (status === "canceled")
    return <ErrorState message="This live session was canceled." />;
  if (status === "error")
    return <ErrorState message={errorMsg} onRetry={loadShell} />;
  if (!session) return null;

  const provider = providerName(session.provider);
  const join = async () => {
    if (!creds) return;
    try {
      await Linking.openURL(creds.joinUrl);
    } catch {
      // opening the native app failed — nothing else we can do safely here
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>{provider.toUpperCase()} LIVE SESSION</Text>
      <Text style={styles.title}>{session.title}</Text>
      <Text style={styles.meta}>{session.audienceLabel}</Text>
      {session.description ? (
        <Text style={styles.desc}>{session.description}</Text>
      ) : null}

      <View style={styles.panel}>
        {ended ? (
          <Text style={styles.status}>This session has ended.</Text>
        ) : !canJoin ? (
          <>
            <Text style={styles.eyebrow}>Starts in</Text>
            <Text style={styles.countdown}>{bigCountdown(startsMs - now)}</Text>
            <Text style={styles.hint}>
              The join button unlocks a few minutes before it starts.
            </Text>
            <View style={[styles.btn, styles.btnDisabled]}>
              <Text style={styles.btnText}>Join {provider}</Text>
            </View>
          </>
        ) : !creds ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={[styles.status, styles.statusGo]}>
              {now >= startsMs ? "● Live now" : "Ready to join"}
            </Text>
            <Text style={styles.hint}>
              Opens the {provider} app · {hostOf(creds.joinUrl)}
            </Text>
            <Press style={styles.btn} onPress={join}>
              <Text style={styles.btnText}>Join {provider} meeting</Text>
            </Press>
            {creds.password ? (
              <View style={styles.passRow}>
                <Text style={styles.passLabel}>PASSCODE</Text>
                <Text style={styles.passCode} selectable>
                  {creds.password}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.md, gap: spacing.xs },
    eyebrow: {
      color: colors.primarySoft,
      fontSize: 12,
      fontFamily: fonts.bold,
      letterSpacing: 1.2,
      marginTop: spacing.sm,
    },
    title: {
      color: colors.text,
      fontSize: 26,
      fontFamily: fonts.display,
      marginTop: 4,
    },
    meta: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.regular },
    desc: {
      color: colors.text,
      fontSize: 14,
      fontFamily: fonts.regular,
      marginTop: 4,
    },
    panel: {
      marginTop: spacing.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 16,
      padding: spacing.lg,
      gap: spacing.md,
      alignItems: "flex-start",
    },
    status: { color: colors.text, fontSize: 15, fontFamily: fonts.bold },
    statusGo: { color: colors.success },
    countdown: { color: colors.text, fontSize: 40, fontFamily: fonts.extrabold },
    hint: { color: colors.textMuted, fontSize: 13.5, fontFamily: fonts.regular },
    btn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      alignSelf: "flex-start",
    },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.onPrimary, fontSize: 15, fontFamily: fonts.bold },
    passRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    passLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontFamily: fonts.bold,
      letterSpacing: 1,
    },
    passCode: {
      color: colors.text,
      fontSize: 18,
      fontFamily: fonts.bold,
      backgroundColor: colors.chipBg,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
      overflow: "hidden",
    },
  });
