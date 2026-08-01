// Lesson player — Ink Hero (design frame 2m): light page, rounded ink video
// block, lesson title + duration/status line, downloads, the teal MARK AS
// COMPLETE gradient button, certificate claim, and an "Up next" list built
// from the lesson's course (best-effort fetch). All completion/certificate
// logic is unchanged.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Ionicons } from "@expo/vector-icons";
import type { LessonDTO, LessonNoteDTO } from "@lms/types";

import { api, ApiError, getToken, noteDownloadUrl } from "../api";
import { API_BASE_URL, WEB_ACCOUNT_URL, scopedKey } from "../config";
import { Loading, ErrorState, Centered } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { Press } from "../components/Press";
import { CtaButton } from "../components/CtaButton";
import { LockedPanel } from "../components/LockedPanel";
import { PopupHost } from "../components/PopupHost";
import CertificateClaim from "../components/CertificateClaim";
import { VideoPlayerView } from "../components/VideoPlayerView";
import { vimeoEmbed } from "../format";
import { lessonSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import { spacing } from "../theme";
import type { Theme } from "../theme";
import { useStyles, useTheme } from "../theme-provider";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// "10:15" — lesson duration clock.
function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LessonScreen({ route, navigation }: ScreenProps<"Lesson">) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  // `seed` is the row the member tapped (see navigation.ts): title, thumbnail
  // and duration — never the video URL, body, notes or certificate state, and
  // never anything that implies access. It paints the loading frame only.
  const { lessonId, seed } = route.params;
  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [siblings, setSiblings] = useState<LessonDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const loadedOnce = useRef(false);

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // `silent` keeps the rendered lesson on screen while refetching — a
  // pull-to-refresh must never swap the player for the full-screen spinner.
  // `loadedOnce` extends that to every other path (house pattern — see
  // DashboardScreen): once the lesson is on screen nothing blanks it, and a
  // refetch that FAILS keeps the player instead of replacing it with an error.
  const load = useCallback(async (silent = false) => {
    const first = !loadedOnce.current;
    if (!silent && first) {
      setLoading(true);
      setSiblings(null);
    }
    setError(null);
    try {
      const data = await api.lesson(lessonId);
      setLesson(data);
      // Access is the server's call, so `locked` is only cleared by a response
      // that actually granted the lesson — never optimistically up front.
      setLocked(false);
      loadedOnce.current = true;
      // Course siblings drive the "Lesson x of y" line and the Up-next rows —
      // decorative, so a failure never blocks the player.
      api
        .courseLessons(data.courseId)
        .then((ls) => setSiblings([...ls].sort((a, b) => a.order - b.order)))
        .catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        // Entitlement can be revoked mid-session — a 403 always wins, whether
        // or not we already had content rendered.
        setLocked(true);
      } else if (first) {
        setError(e instanceof Error ? e.message : "Could not load this lesson.");
      }
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  async function onComplete() {
    setCompleting(true);
    setCompleteError(null);
    try {
      const res = await api.completeLesson(lessonId);
      // Completing the final lesson of a class returns fresh certificate
      // state — surface the "Get certificate" button without a refetch.
      setLesson((prev) =>
        prev
          ? {
              ...prev,
              completed: true,
              certificates: res?.certificates ?? prev.certificates,
            }
          : prev,
      );
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
    // Must be stamped before the platform branch — the non-Android path returns
    // early, so setting it further down left that row's `disabled` guard inert.
    setSavingNoteId(note.id);

    if (Platform.OS !== "android") {
      try {
        await Linking.openURL(await noteDownloadUrl(note));
      } catch (e) {
        setNoteError(e instanceof Error ? e.message : "Could not open the file.");
      } finally {
        setSavingNoteId(null);
      }
      return;
    }

    const SAF_DIR_KEY = scopedKey("lms.saf.dir");
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

  // First paint. With a seed we keep showing the row the member just tapped —
  // its still thumbnail, title and duration — instead of a cold spinner. The
  // player, completion button, notes and certificates stay out until the
  // server has granted the lesson.
  if (loading) {
    if (!seed) return <Loading />;
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {seed.thumbnailUrl ? (
          <Image
            style={styles.video}
            source={{ uri: seed.thumbnailUrl }}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.video} />
        )}
        <Text style={styles.title}>{seed.title}</Text>
        {seed.durationSeconds ? (
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              Duration {fmtClock(seed.durationSeconds)}
            </Text>
          </View>
        ) : null}
        <Skeleton height={46} radius={12} style={styles.seedSkeleton} />
        <Skeleton height={96} radius={12} style={styles.seedSkeleton} />
      </ScrollView>
    );
  }

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
  // expo-video player.
  const vimeo = vimeoEmbed(lesson.videoUrl);
  const videoUri = vimeo ? null : lesson.videoUrl ?? null;
  const notes = lesson.notes ?? [];

  const idx = siblings?.findIndex((l) => l.id === lesson.id) ?? -1;
  const metaBits = [
    lesson.durationSeconds ? `Duration ${fmtClock(lesson.durationSeconds)}` : null,
    siblings && idx >= 0 ? `Lesson ${idx + 1} of ${siblings.length}` : null,
  ].filter(Boolean);
  const upNext = siblings
    ? siblings.filter((l) => l.order > lesson.order).slice(0, 3)
    : [];

  return (
    <>
      <PopupHost context={{ type: "lessons" }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
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

        <Text style={styles.title}>{lesson.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {metaBits.join(" · ")}
          </Text>
          <View style={styles.statusWrap}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: completed ? colors.success : colors.primary },
              ]}
            />
            <Text style={styles.statusText}>
              {completed ? "Completed" : "In progress"}
            </Text>
          </View>
        </View>

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
                {savingNoteId === n.id ? (
                  <Text style={styles.noteIcon}>…</Text>
                ) : (
                  <Ionicons
                    name="download-outline"
                    size={17}
                    color={colors.primarySoft}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {completeError ? <Text style={styles.error}>{completeError}</Text> : null}

        {completed ? (
          <View style={styles.doneBanner}>
            <Text style={styles.doneBannerText}>✓ COMPLETED</Text>
          </View>
        ) : (
          <CtaButton
            style={styles.completeBtn}
            radius={12}
            busy={completing}
            label="MARK AS COMPLETE"
            textStyle={styles.completeText}
            onPress={onComplete}
          />
        )}

        {(lesson.certificates ?? [])
          .filter((c) => c.eligible || c.claimed)
          .map((c) => (
            <CertificateClaim key={c.levelId} status={c} />
          ))}

        {lesson.content ? (
          <Text style={[styles.body, styles.bodyBelow]}>{lesson.content}</Text>
        ) : (
          <Text style={[styles.bodyMuted, styles.bodyBelow]}>
            No written content for this lesson.
          </Text>
        )}

        {upNext.length > 0 ? (
          <>
            <Text style={styles.upNextTitle}>Up next</Text>
            {upNext.map((l) => (
              <Press
                key={l.id}
                style={styles.upNextRow}
                onPress={() =>
                  navigation.push("Lesson", {
                    lessonId: l.id,
                    title: l.title,
                    seed: lessonSeed(l),
                  })
                }
              >
                {l.thumbnailUrl ? (
                  <Image
                    source={{ uri: l.thumbnailUrl }}
                    style={styles.upNextThumb}
                  />
                ) : (
                  <View style={[styles.upNextThumb, styles.upNextThumbEmpty]}>
                    <Text style={styles.upNextGlyph}>▶</Text>
                  </View>
                )}
                <View style={styles.upNextInfo}>
                  <Text style={styles.upNextName} numberOfLines={1}>
                    {l.title}
                  </Text>
                  <Text style={styles.upNextMeta} numberOfLines={1}>
                    {l.durationSeconds
                      ? fmtClock(l.durationSeconds)
                      : l.completed
                        ? "Completed"
                        : "Lesson"}
                  </Text>
                </View>
                <View style={styles.upNextPlay}>
                  <Text style={styles.upNextPlayGlyph}>▶</Text>
                </View>
              </Press>
            ))}
          </>
        ) : null}

        <View style={styles.spacer} />
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, fonts }: Theme) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  video: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 16,
    backgroundColor: colors.inkCard,
    overflow: "hidden",
  },
  title: {
    color: colors.text,
    fontSize: 16.5,
    fontFamily: fonts.semibold,
    lineHeight: 22,
    marginTop: spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: 7,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11.5,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  statusWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: {
    color: colors.primarySoft,
    fontSize: 11.5,
    fontFamily: fonts.semibold,
  },
  seedSkeleton: { marginTop: spacing.lg },
  body: { color: colors.text, fontSize: 15, lineHeight: 23, fontFamily: fonts.regular },
  bodyMuted: { color: colors.textMuted, fontSize: 14, fontStyle: "italic", fontFamily: fonts.regular },
  bodyBelow: { marginTop: spacing.lg },
  error: { color: colors.danger, marginTop: spacing.md, fontFamily: fonts.regular },
  savedMsg: { color: colors.success, marginBottom: spacing.sm, fontSize: 13.5, fontFamily: fonts.regular },
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
    fontSize: 14,
    fontFamily: fonts.semibold,
    marginBottom: spacing.sm,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceMuted,
  },
  noteName: { flex: 1, color: colors.text, fontSize: 13.5, fontFamily: fonts.medium },
  noteSize: { color: colors.textMuted, fontSize: 12, marginHorizontal: spacing.sm, fontFamily: fonts.regular },
  noteIcon: { color: colors.primarySoft, fontSize: 16, fontFamily: fonts.bold },
  completeBtn: { marginTop: spacing.lg },
  completeText: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  doneBanner: {
    marginTop: spacing.lg,
    backgroundColor: colors.successBg,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  doneBannerText: {
    color: colors.success,
    fontSize: 12.5,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  upNextTitle: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.semibold,
    marginTop: spacing.lg,
    marginBottom: 9,
    marginHorizontal: 4,
  },
  upNextRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 9,
  },
  upNextThumb: {
    width: 56,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  upNextThumbEmpty: { alignItems: "center", justifyContent: "center" },
  upNextGlyph: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.regular },
  upNextInfo: { flex: 1, gap: 1 },
  upNextName: { color: colors.text, fontSize: 12, fontFamily: fonts.semibold },
  upNextMeta: { color: colors.textMuted, fontSize: 10.5, fontFamily: fonts.regular },
  upNextPlay: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  upNextPlayGlyph: { color: colors.textMuted, fontSize: 9, fontFamily: fonts.regular },
  spacer: { height: spacing.lg },
});
