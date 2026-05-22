import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ResizeMode, Video } from "expo-av";
import { WebView } from "react-native-webview";
import type { LessonDTO, LessonNoteDTO } from "@lms/types";

import { api, ApiError, noteDownloadUrl } from "../api";
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

// Parse a Vimeo URL into its player embed URL (or null if not a Vimeo link).
function vimeoEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
  if (!id) return null;
  const h =
    url.match(/[?&]h=([0-9A-Za-z]+)/)?.[1] ??
    url.match(/vimeo\.com\/\d+\/([0-9A-Za-z]+)/)?.[1];
  const params = [h ? `h=${h}` : "", "title=0", "byline=0", "portrait=0"]
    .filter(Boolean)
    .join("&");
  return `https://player.vimeo.com/video/${id}?${params}`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function LessonScreen({ route }: ScreenProps<"Lesson">) {
  const { lessonId } = route.params;
  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

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

  // Open a note in the device browser, which downloads it. The download route
  // is access-checked and accepts the member's token via ?token= (built in
  // noteDownloadUrl) so no native file modules are needed.
  async function openNote(note: LessonNoteDTO) {
    setNoteError(null);
    try {
      const url = await noteDownloadUrl(note);
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error("Couldn't open the download link.");
      await Linking.openURL(url);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "Could not open the file.");
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
  // Vimeo (production) plays in a WebView; a direct MP4/HLS or Mux stream
  // plays in the native expo-av player.
  const vimeo = vimeoEmbed(lesson.videoUrl);
  const videoUri = vimeo
    ? null
    : lesson.videoUrl ??
      (lesson.muxPlaybackToken ? playbackUrl(lesson.muxPlaybackToken) : null);
  const notes = lesson.notes ?? [];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{lesson.title}</Text>

      {vimeo ? (
        <WebView
          style={styles.video}
          source={{ uri: vimeo }}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          javaScriptEnabled
          domStorageEnabled
        />
      ) : videoUri ? (
        <Video
          style={styles.video}
          source={{ uri: videoUri }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          isLooping={false}
        />
      ) : lesson.thumbnailUrl ? (
        <Image
          style={styles.video}
          source={{ uri: lesson.thumbnailUrl }}
          resizeMode="cover"
        />
      ) : null}

      {notes.length > 0 ? (
        <View style={styles.notes}>
          <Text style={styles.notesTitle}>Downloads</Text>
          {noteError ? <Text style={styles.error}>{noteError}</Text> : null}
          {notes.map((n) => (
            <TouchableOpacity
              key={n.id}
              style={styles.noteRow}
              activeOpacity={0.8}
              onPress={() => openNote(n)}
            >
              <Text style={styles.noteName} numberOfLines={1}>
                {n.originalName}
              </Text>
              <Text style={styles.noteSize}>{fmtSize(n.size)}</Text>
              <Text style={styles.noteIcon}>⬇</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

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

      {lesson.content ? (
        <Text style={[styles.body, styles.bodyBelow]}>{lesson.content}</Text>
      ) : (
        <Text style={[styles.bodyMuted, styles.bodyBelow]}>
          No written content for this lesson.
        </Text>
      )}

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
  bodyBelow: { marginTop: spacing.lg },
  error: { color: colors.danger, marginTop: spacing.md },
  notes: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  notesTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  noteName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "500" },
  noteSize: { color: colors.textMuted, fontSize: 13, marginHorizontal: spacing.sm },
  noteIcon: { color: colors.primary, fontSize: 18, fontWeight: "700" },
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
