// Audio lesson player. Reuses expo-video's player engine (already bundled for
// video) so audio needs no extra native dependency — just a custom, pure-JS
// control bar (play/pause, elapsed/total, tap-to-seek track). A tiny hidden
// VideoView keeps the native player attached to the view tree across platforms.
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { VideoView, useVideoPlayer } from "expo-video";

import { useTheme } from "../theme-provider";

// "3:07" clock. Guards NaN/negative (duration is NaN until metadata loads).
function fmt(t: number): string {
  const v = Number.isFinite(t) && t > 0 ? t : 0;
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayerView({
  uri,
  style,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
}) {
  // Remount on uri change: useVideoPlayer reads its source on mount only.
  return <PlayerInner key={uri} uri={uri} style={style} />;
}

function PlayerInner({
  uri,
  style,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
  });
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);

  // Poll the player's live properties (expo-video exposes currentTime/duration/
  // playing on the player object). 400ms is smooth enough for a progress bar and
  // cheap. Cleared on unmount.
  useEffect(() => {
    const iv = setInterval(() => {
      setCurrent(player.currentTime ?? 0);
      const d = player.duration;
      setDuration(Number.isFinite(d) ? d : 0);
      setPlaying(player.playing);
    }, 400);
    return () => clearInterval(iv);
  }, [player]);

  // Stop playback when the lesson screen loses focus (a tab switch or a modal
  // over it) so audio never keeps playing invisibly. On a real unmount (popping
  // the screen) useVideoPlayer has usually already released the native player,
  // so guard the call — pausing a released player throws, and the release has
  // stopped playback anyway.
  useFocusEffect(
    useCallback(() => {
      return () => {
        try {
          player.pause();
        } catch {
          // player already released on unmount — playback is stopped, no-op.
        }
      };
    }, [player]),
  );

  const toggle = () => {
    if (player.playing) {
      player.pause();
      setPlaying(false); // optimistic — don't wait for the next poll tick
    } else {
      player.play();
      setPlaying(true);
    }
  };

  const seekToRatio = (ratio: number) => {
    const d = player.duration;
    if (Number.isFinite(d) && d > 0) {
      const target = Math.max(0, Math.min(1, ratio)) * d;
      player.currentTime = target;
      setCurrent(target); // optimistic — reflect the seek immediately
    }
  };

  const pct = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surfaceMuted }, style]}>
      {/* Hidden — audio has no picture; this only anchors the native player. */}
      <VideoView
        player={player}
        style={styles.hidden}
        nativeControls={false}
        pointerEvents="none"
      />
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.85}
        style={[styles.playBtn, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause" : "Play"}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={22}
          color={colors.onPrimary}
        />
      </TouchableOpacity>
      <View style={styles.body}>
        <View
          style={[styles.track, { backgroundColor: colors.borderSoft }]}
          // Enlarge only the vertical touch region (the visible 6pt bar is hard
          // to hit); locationX stays measured against the bar's real width.
          hitSlop={{ top: 16, bottom: 16, left: 0, right: 0 }}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onResponderRelease={(e) => {
            if (trackWidth > 0) seekToRatio(e.nativeEvent.locationX / trackWidth);
          }}
        >
          <View
            style={[
              styles.trackFill,
              { width: `${pct * 100}%`, backgroundColor: colors.primary },
            ]}
          />
        </View>
        <View style={styles.timeRow}>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {fmt(current)}
          </Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {fmt(duration)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 14,
    padding: 14,
  },
  hidden: { width: 1, height: 1, opacity: 0, position: "absolute" },
  playBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  trackFill: { height: "100%", borderRadius: 3 },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  time: { fontSize: 12, fontVariant: ["tabular-nums"] },
});
