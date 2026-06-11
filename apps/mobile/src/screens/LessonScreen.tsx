import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import type { LessonDTO, LessonNoteDTO } from "@lms/types";

import { api, ApiError, getToken, noteDownloadUrl } from "../api";
import { API_BASE_URL, WEB_ACCOUNT_URL } from "../config";
import { Loading, ErrorState, Centered } from "../components/Screen";
import { LockedPanel } from "../components/LockedPanel";
import { PopupHost } from "../components/PopupHost";
import { VideoPlayerView } from "../components/VideoPlayerView";
import { vimeoEmbed } from "../format";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function LessonScreen({ route }: ScreenProps<"Lesson">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { lessonId } = route.params;
  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

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

  // Download a note to the device. On Android we fetch the file (access-checked
  // endpoint; auth via the Authorization header) and save it to a user-chosen
  // folder via the Storage Access Framework — the folder is remembered so it's
  // only asked once. On other platforms we fall back to opening the URL.
  async function saveNote(note: LessonNoteDTO) {
    setNoteError(null);
    setSavedMsg(null);

    if (Platform.OS !== "android") {
      try {
        await Linking.openURL(await noteDownloadUrl(note));
      } catch (e) {
        setNoteError(e instanceof Error ? e.message : "Could not open the file.");
      }
      return;
    }

    const SAF_DIR_KEY = "lms.saf.dir";
    setSavingNoteId(note.id);
    try {
      const token = await getToken();
      const dot = note.originalName.lastIndexOf(".");
      const ext = dot > 0 ? note.originalName.slice(dot) : "";
      const base = dot > 0 ? note.originalName.slice(0, dot) : note.originalName;

      // 1) Download to the app cache (auth via header). Non-2xx throws.
      const tmp = new File(Paths.cache, `note-${note.id}${ext}`);
      const dl = await File.downloadFileAsync(
        `${API_BASE_URL}${note.downloadUrl}`,
        tmp,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          idempotent: true,
        }
      );
      const bytes = await dl.bytes();

      // 2) Write into a user-chosen folder. The picker persists the SAF grant
      //    natively, so the remembered folder stays writable across restarts.
      const writeInto = (dirUri: string) => {
        const dest = new Directory(dirUri).createFile(
          base,
          note.mimeType || "application/octet-stream"
        );
        dest.write(bytes);
      };

      const savedDir = await SecureStore.getItemAsync(SAF_DIR_KEY);
      try {
        if (!savedDir) throw new Error("no-saved-dir");
        writeInto(savedDir); // a stale/revoked grant throws -> re-pick below
      } catch {
        let dir: Directory;
        try {
          dir = await Directory.pickDirectoryAsync();
        } catch {
          setSavingNoteId(null);
          return; // user cancelled the folder picker
        }
        await SecureStore.setItemAsync(SAF_DIR_KEY, dir.uri);
        writeInto(dir.uri);
      }
      try {
        tmp.delete();
      } catch {
        // best-effort cache cleanup
      }

      setSavedMsg(`Saved “${note.originalName}” to your chosen folder.`);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "Could not save the file.");
    } finally {
      setSavingNoteId(null);
    }
  }

  if (loading) return <Loading />;

  if (locked) {
    return (
      <Centered>
        <View style={styles.lockedWrap}>
          <LockedPanel
            title="This lesson is locked"
            message="Your current membership doesn't include this lesson."
            note="Manage your plan on the web."
            ctaLabel="Open my account"
            onPress={() => Linking.openURL(WEB_ACCOUNT_URL)}
          />
        </View>
      </Centered>
    );
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!lesson) return <ErrorState message="Lesson not found." onRetry={load} />;

  const completed = lesson.completed === true;
  // Vimeo plays in a WebView; a direct MP4/HLS URL plays in the native
  // expo-av player.
  const vimeo = vimeoEmbed(lesson.videoUrl);
  const videoUri = vimeo ? null : lesson.videoUrl ?? null;
  const notes = lesson.notes ?? [];

  return (
    <>
      <PopupHost context={{ type: "lessons" }} />
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
          <VideoPlayerView style={styles.video} uri={videoUri} />
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
            {savedMsg ? <Text style={styles.savedMsg}>{savedMsg}</Text> : null}
            {notes.map((n) => (
              <TouchableOpacity
                key={n.id}
                style={styles.noteRow}
                activeOpacity={0.8}
                onPress={() => saveNote(n)}
                disabled={savingNoteId === n.id}
              >
                <Text style={styles.noteName} numberOfLines={1}>
                  {n.originalName}
                </Text>
                <Text style={styles.noteSize}>{fmtSize(n.size)}</Text>
                <Text style={styles.noteIcon}>
                  {savingNoteId === n.id ? "…" : "⬇"}
                </Text>
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
            <Text style={[styles.buttonText, completed && styles.buttonTextDone]}>
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
    </>
  );
}

const makeStyles = ({ colors }: Theme) => StyleSheet.create({
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
  savedMsg: { color: colors.success, marginBottom: spacing.sm, fontSize: 14 },
  lockedWrap: { alignSelf: "stretch" },
  notes: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
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
  buttonDone: { backgroundColor: colors.successBg },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  // The done state sits on the success tint, so the label goes success too.
  buttonTextDone: { color: colors.success },
  spacer: { height: spacing.lg },
});
