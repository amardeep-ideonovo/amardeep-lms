// Thin wrapper over expo-video for plain remote MP4/HLS playback (replaces
// the removed expo-av <Video>). Parity with the old usage: native controls,
// contain fit, no looping, no autoplay.
import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

// iOS only exposes HLS video tracks when the uri ends in .m3u8 or the source
// carries an explicit contentType hint.
function sourceFor(uri: string) {
  return /\.m3u8(\?|$)/i.test(uri)
    ? { uri, contentType: "hls" as const }
    : { uri };
}

export function VideoPlayerView({
  uri,
  style,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
}) {
  // Remount the player when the uri changes: useVideoPlayer reads its source
  // on mount only (swapping needs player.replace, which would double-load on
  // first render).
  return <PlayerInner key={uri} uri={uri} style={style} />;
}

function PlayerInner({
  uri,
  style,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(sourceFor(uri), (p) => {
    p.loop = false;
  });
  // The wrapper View owns the layout style and clips the Android SurfaceView
  // so a borderRadius on the caller's style is honored.
  return (
    <View style={[style, styles.clip]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
});
