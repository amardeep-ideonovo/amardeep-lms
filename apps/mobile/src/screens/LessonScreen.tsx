import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ResizeMode, Video } from "expo-av";
import type { LessonDTO } from "@lms/types";

import { api, ApiError } from "../api";
import { Loading, ErrorState } from "../components/Screen";
import type { ScreenProps } from "../navigation";
import { colors, spacing } from "../theme";

// Placeholder HLS stream; in production the signed Mux playback URL is built from
// muxPlaybackToken (e.g. https://stream.mux.com/<playbackId>.m3u8?token=<jwt>).
const PLACEHOLDER_HLS =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

function playbackUrl(token: string): string {
  return `${PLACEHOLDER_HLS}?token=${encodeURIComponent(token)}`;
}

export function LessonScreen({ route }: ScreenProps<"Lesson">) {
  const { lessonId } = route.params;
  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLocked(false);
    try {
      const data = await api.lesson(lessonId);
      setLesson(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setLocked(true);
      } else {
        setError(e instanceof Error ? e.message : "Could not load this lesson.");
      }
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onComplete() {
    setCompleting(true);
    setCompleteError(null);
    try {
      await api.completeLesson(lessonId);
      setLesson((prev) => (prev ? { ...prev, completed: true } : prev));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setCompleteError("You no longer have access to this lesson.");
        setLocked(true);
      } else {
        setCompleteError(
          e instanceof Error ? e.message : "Could not mark complete."
        );
      }
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <Loading />;

  if (locked) {
    return (
      <ErrorState
        message={"🔒 This lesson is locked.\nUpgrade your membership on the web to unlock it."}
      />
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!lesson) return <ErrorState message="Lesson not found." onRetry={load} />;

  const completed = lesson.completed === true;
  // Prefer a direct video URL (sample/dev); fall back to the Mux signed stream.
  const videoUri =
    lesson.videoUrl ??
    (lesson.muxPlaybackToken ? playbackUrl(lesson.muxPlaybackToken) : null);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{lesson.title}</Text>

      {videoUri ? (
        <Video
          style={styles.video}
          source={{ uri: videoUri }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          isLooping={false}
        />
      ) : null}

      {lesson.content ? (
        <Text style={styles.body}>{lesson.content}</Text>
      ) : (
        <Text style={styles.bodyMuted}>No written content for this lesson.</Text>
      )}

      {completeError ? <Text style={styles.error}>{completeError}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (completed || completing) && styles.buttonDone]}
        onPress={onComplete}
        disabled={completed || completing}
        activeOpacity={0.8}
      >
        {completing ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>
            {completed ? "✓ Completed" : "Mark complete"}
          </Text>
        )}
      </TouchableOpacity>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: "#000",
    marginBottom: spacing.md,
  },
  body: { color: colors.text, fontSize: 16, lineHeight: 24 },
  bodyMuted: { color: colors.textMuted, fontSize: 15, fontStyle: "italic" },
  error: { color: colors.danger, marginTop: spacing.md },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  buttonDone: { backgroundColor: colors.surfaceMuted },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  spacer: { height: spacing.lg },
});
