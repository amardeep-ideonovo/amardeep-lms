// Lesson player — Ink Hero, web-parity layout: a full-bleed navy hero band
// (breadcrumb + title + "Lesson N of M" pill) with the CONTAINED video card
// overlapping up into it, then a white actions card (status + Duration/Course +
// MARK AS COMPLETE), downloads, description, prev/next, the full "lessons in
// this course" card, and a navy "Up next" card. All completion / certificate /
// note-download / media-routing logic is unchanged from before.
import React, { useCallback, useMemo, useState } from "react";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { LessonDTO, LessonNoteDTO } from "@lms/types";

import { api, ApiError, getToken, noteDownloadUrl } from "../api";
import { API_BASE_URL, scopedKey } from "../config";
import { Loading, ErrorState, Centered } from "../components/Screen";
import { Skeleton } from "../components/Skeleton";
import { Press } from "../components/Press";
import { CtaButton } from "../components/CtaButton";
import { LockedPanel } from "../components/LockedPanel";
import { PopupHost } from "../components/PopupHost";
import CertificateClaim from "../components/CertificateClaim";
import { VideoPlayerView } from "../components/VideoPlayerView";
import { AudioPlayerView } from "../components/AudioPlayerView";
import { HtmlView } from "../components/HtmlView";
import { HeroScaffold, HERO_OVERLAP } from "../components/HeroScaffold";
import { HeroBackButton } from "../components/HeroBackButton";
import { LessonRow } from "../components/LessonRow";
import type { LessonRowState } from "../components/LessonRow";
import { vimeoEmbed, youtubeEmbed, isProviderVideoUrl } from "../format";
import { lessonSeed } from "../navigation";
import type { ScreenProps } from "../navigation";
import {
  propagateLessonComplete,
  qk,
  useCourseLessons,
  useCourses,
  useLesson,
} from "../queries";
import { contentColumn, formColumn, useContentLayout } from "../responsive";
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
  const { contentWidth } = useContentLayout();
  const queryClient = useQueryClient();
  // `seed` is the row the member tapped (see navigation.ts): title, thumbnail
  // and duration — never the video URL, body, notes or certificate state, and
  // never anything that implies access. It paints the loading frame only.
  const { lessonId, seed } = route.params;

  // The lesson lives in the shared query cache — THE single source for the
  // `completed` flag (the old local copy duplicated what the course-lessons
  // entry already held). react-query keeps it across refetches, so a
  // pull-to-refresh never swaps the player for the full-screen spinner and a
  // refetch that FAILS keeps the player instead of replacing it with an error.
  const lessonQuery = useLesson(lessonId);
  const lesson = lessonQuery.data ?? null;

  // Course siblings drive the "Lesson x of y" line, the lessons-in-course card,
  // prev/next and the Up-next card — decorative, so a failure never blocks the
  // player. Same cache entry the Course screen reads (and the completion
  // write-back below ticks), sorted for display; the cache holds it unsorted.
  const siblingsQuery = useCourseLessons(lesson?.courseId);
  const siblings = useMemo(
    () =>
      siblingsQuery.data
        ? [...siblingsQuery.data].sort((a, b) => a.order - b.order)
        : null,
    [siblingsQuery.data],
  );
  // Course title for the breadcrumb + lessons-card head — best-effort, cached
  // (the Course screen reads the same entry); a miss just drops that crumb.
  const coursesQuery = useCourses();
  const courseTitle =
    coursesQuery.data?.find((c) => c.id === lesson?.courseId)?.title ?? null;

  // Access is the server's call. A 403 from the lesson fetch always wins,
  // whether or not content was already rendered (entitlement can be revoked
  // mid-session), and only a later successful refetch clears it. A 403 from
  // the completion mutation locks via this flag — reset on remount, exactly
  // like the old screen-local `locked` state.
  const [completeLocked, setCompleteLocked] = useState(false);
  const locked =
    completeLocked ||
    (lessonQuery.error instanceof ApiError && lessonQuery.error.status === 403);

  const [completeError, setCompleteError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const jobs: Promise<unknown>[] = [lessonQuery.refetch()];
      // `enabled` doesn't gate refetch() in v5 — only ask for siblings once the
      // courseId is known (see the useMyClassCourses warning in queries.ts).
      if (lesson?.courseId) jobs.push(siblingsQuery.refetch());
      await Promise.all(jobs);
    } finally {
      setRefreshing(false);
    }
  }, [lessonQuery, siblingsQuery, lesson?.courseId]);

  // Optimistic. /complete does a lesson+course join, two access queries, a
  // progress lookup, an upsert and a certificate-status query — the app's
  // core emotional beat shouldn't sit under a spinner for all of that. The
  // ✓ COMPLETED banner, the status pill and the meta line flip NOW, before
  // the request. Only `completed` is touched: `certificates` is a GRANT and
  // is left strictly as the server last reported it (see the render below).
  //
  // The CTA is replaced by the banner on that flip, so a second same-scope run
  // is unreachable from the UI — which is what makes the plain `onMutate`
  // snapshot here safe (see docs/coding-standards.md D4: `onMutate` runs at
  // mutate() time, before any scope-queue turn, so it must never capture
  // mid-flight state; there is none to capture). The snapshot is restored
  // VERBATIM, never re-derived.
  const completeMutation = useMutation({
    scope: { id: `lesson:${lessonId}` },
    mutationFn: () => api.completeLesson(lessonId),
    onMutate: () => {
      setCompleteError(null);
      const snapshot =
        queryClient.getQueryData<LessonDTO>(qk.lesson(lessonId)) ?? null;
      queryClient.setQueryData<LessonDTO>(qk.lesson(lessonId), (prev) =>
        prev ? { ...prev, completed: true } : prev,
      );
      return snapshot;
    },
    onSuccess: (res) => {
      // Completing the final lesson of a class returns fresh certificate
      // state — surface the "Get certificate" button without a refetch. This
      // is the ONLY place certificate state is written: never optimistically.
      queryClient.setQueryData<LessonDTO>(qk.lesson(lessonId), (prev) =>
        prev
          ? {
              ...prev,
              completed: true,
              certificates: res?.certificates ?? prev.certificates,
            }
          : prev,
      );
      // Reflect the confirmed completion across the shared query cache so the
      // Course / Class / Home screens the member navigates back to are already
      // right: the course's lesson list ticks THIS lesson instantly, and
      // progress counts + certificate grants revalidate server-truthed in the
      // background. Only on the 200 — never on the optimistic paint above.
      const courseId = queryClient.getQueryData<LessonDTO>(
        qk.lesson(lessonId),
      )?.courseId;
      if (courseId) propagateLessonComplete(queryClient, courseId, lessonId);
    },
    onError: (e, _vars, snapshot) => {
      // Put the exact pre-tap lesson back BEFORE anything else, so a 403 can't
      // leave a phantom "completed" behind: a later successful refetch clears
      // `locked`, and the reverted slice is what it lands on.
      if (snapshot) queryClient.setQueryData(qk.lesson(lessonId), snapshot);
      if (e instanceof ApiError && e.status === 403) {
        setCompleteError("You no longer have access to this lesson.");
        setCompleteLocked(true);
      } else {
        setCompleteError(
          e instanceof Error ? e.message : "Could not mark complete.",
        );
      }
    },
  });
  // The button is already gone (replaced by the banner), so `completing` no
  // longer gates it — it marks the in-flight window for the neutral
  // "Checking certificate…" row.
  const completing = completeMutation.isPending;

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
        setNoteError(
          e instanceof Error ? e.message : "Could not open the file.",
        );
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
      const base =
        dot > 0 ? note.originalName.slice(0, dot) : note.originalName;

      // 1) Download to the app cache (auth via header). Non-2xx throws.
      const tmp = new File(Paths.cache, `note-${note.id}${ext}`);
      const dl = await File.downloadFileAsync(
        `${API_BASE_URL}${note.downloadUrl}`,
        tmp,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          idempotent: true,
        },
      );
      const bytes = await dl.bytes();

      // 2) Write into a user-chosen folder. The picker persists the SAF grant
      //    natively, so the remembered folder stays writable across restarts.
      const writeInto = (dirUri: string) => {
        const dest = new Directory(dirUri).createFile(
          base,
          note.mimeType || "application/octet-stream",
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

  const goBack = () => navigation.goBack();

  // ---- First paint (seed): hero + the tapped row's still, then skeletons. ----
  if (!lesson && !locked && !(lessonQuery.isError && !lessonQuery.isFetching)) {
    if (!seed) {
      return (
        <>
          <HeroBackButton onPress={goBack} tone="onLight" />
          <Loading />
        </>
      );
    }
    return (
      <>
        <HeroBackButton onPress={goBack} />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <HeroScaffold variant="ink" overlapReserve={68}>
            <Text style={styles.crumbs} numberOfLines={1}>
              Dashboard
            </Text>
            <Text style={styles.heroTitle}>{seed.title}</Text>
          </HeroScaffold>
          <View style={styles.body}>
            {seed.thumbnailUrl ? (
              <Image
                style={styles.video}
                source={{ uri: seed.thumbnailUrl }}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.video} />
            )}
            <Skeleton height={92} radius={16} />
            <Skeleton height={64} radius={16} />
          </View>
        </ScrollView>
      </>
    );
  }

  if (locked) {
    return (
      <>
        <HeroBackButton onPress={goBack} tone="onLight" />
        <Centered>
          <View style={styles.lockedWrap}>
            {/* No purchase/account link here: steering members to buy or manage
                a plan outside the app violates Google Play payments policy and
                Apple 3.1.1 (outside the US). The note stays as neutral guidance
                (plain text, no link/price) — the LockedPanel pattern. */}
            <LockedPanel
              title="This lesson is locked"
              message="Your current membership doesn't include this lesson."
              note="You can manage your plan from your account on the web."
            />
          </View>
        </Centered>
      </>
    );
  }

  if (lessonQuery.isError && !lesson)
    return (
      <>
        <HeroBackButton onPress={goBack} tone="onLight" />
        <ErrorState
          message={
            lessonQuery.error instanceof Error
              ? lessonQuery.error.message
              : "Could not load this lesson."
          }
          onRetry={() => lessonQuery.refetch()}
        />
      </>
    );
  if (!lesson)
    return (
      <>
        <HeroBackButton onPress={goBack} tone="onLight" />
        <ErrorState
          message="Lesson not found."
          onRetry={() => lessonQuery.refetch()}
        />
      </>
    );

  const completed = lesson.completed === true;
  // Media type is derived from the URLs: audioUrl -> audio player; otherwise
  // Vimeo/YouTube play in a WebView and a direct MP4/HLS URL plays in the
  // native expo-video player. lastPositionSeconds resumes the YouTube embed.
  const vimeo = vimeoEmbed(lesson.videoUrl);
  const youtube = youtubeEmbed(
    lesson.videoUrl,
    lesson.lastPositionSeconds ?? 0,
  );
  const audioUrl = lesson.audioUrl ?? null;
  // A provider link we couldn't parse must NOT reach the native player (dead
  // box); only a genuine direct file URL plays there.
  const videoUri =
    vimeo || youtube || isProviderVideoUrl(lesson.videoUrl)
      ? null
      : (lesson.videoUrl ?? null);
  const notes = lesson.notes ?? [];

  const idx = siblings?.findIndex((l) => l.id === lesson.id) ?? -1;
  const total = siblings?.length ?? 0;
  const lessonPill =
    siblings && idx >= 0 ? `Lesson ${idx + 1} of ${total}` : null;
  const crumbs = [
    "Dashboard",
    courseTitle,
    idx >= 0 ? `Lesson ${idx + 1}` : null,
  ]
    .filter(Boolean)
    .join("  ›  ");
  const metaLine = [
    lesson.durationSeconds
      ? `Duration ${fmtClock(lesson.durationSeconds)}`
      : null,
    courseTitle ? `Course: ${courseTitle}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const prevLesson = siblings && idx > 0 ? siblings[idx - 1] : null;
  const nextLesson =
    siblings && idx >= 0 && idx < total - 1 ? siblings[idx + 1] : null;
  const doneCount = siblings?.filter((l) => l.completed).length ?? 0;

  const rowState = (l: LessonDTO): LessonRowState =>
    l.completed ? "completed" : l.id === lesson.id ? "resume" : "todo";

  const openLesson = (l: LessonDTO) =>
    navigation.push("Lesson", {
      lessonId: l.id,
      title: l.title,
      seed: lessonSeed(l),
    });

  return (
    <>
      <PopupHost context={{ type: "lessons" }} />
      <HeroBackButton onPress={goBack} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <HeroScaffold variant="ink" overlapReserve={68}>
          <Text style={styles.crumbs} numberOfLines={1}>
            {crumbs}
          </Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroTitle}>{lesson.title}</Text>
            {lessonPill ? (
              <Text style={styles.heroPill}>{lessonPill}</Text>
            ) : null}
          </View>
        </HeroScaffold>

        <View style={styles.body}>
          {/* ---- media block (contained, overlaps the band) ---- */}
          <View style={styles.media}>
            {audioUrl ? (
              <View>
                {lesson.thumbnailUrl ? (
                  <Image
                    style={styles.video}
                    source={{ uri: lesson.thumbnailUrl }}
                    resizeMode="cover"
                  />
                ) : null}
                <AudioPlayerView
                  uri={audioUrl}
                  style={lesson.thumbnailUrl ? styles.audioBelow : undefined}
                />
              </View>
            ) : vimeo ? (
              <WebView
                style={styles.video}
                source={{ uri: vimeo }}
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                javaScriptEnabled
                domStorageEnabled
              />
            ) : youtube ? (
              // YouTube's embed rejects a WebView that loads the embed URL directly
              // (no page origin) with "Error 153". Wrapping the iframe in an HTML
              // doc served under a youtube-nocookie baseUrl gives it the same-origin
              // context the embed requires. (Vimeo, above, has no such requirement.)
              <WebView
                style={styles.video}
                originWhitelist={["*"]}
                source={{
                  html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"></head><body style="margin:0;background:#000;overflow:hidden"><iframe src="${youtube}" width="100%" height="100%" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`,
                  baseUrl: "https://www.youtube-nocookie.com",
                }}
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
            ) : (
              <View style={styles.video} />
            )}
          </View>

          {/* ---- actions card: status + meta + mark complete + certificate ---- */}
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: completed
                      ? colors.success
                      : colors.primary,
                  },
                ]}
              />
              <Text style={styles.statusText}>
                {completed ? "Completed" : "In progress"}
              </Text>
              {metaLine ? (
                <Text style={styles.metaText} numberOfLines={2}>
                  {metaLine}
                </Text>
              ) : null}
            </View>

            {completeError ? (
              <Text style={styles.error}>{completeError}</Text>
            ) : null}

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
                onPress={() => completeMutation.mutate()}
              />
            )}

            {/* A certificate is a GRANT, not a toggle, so nothing here is ever
                optimistic: the completion flip above deliberately leaves
                `lesson.certificates` alone, which makes this list server truth at
                all times (including mid-flight). Any certificate already earned
                keeps rendering while the request runs. */}
            {(lesson.certificates ?? [])
              .filter((c) => c.eligible || c.claimed)
              .map((c) => (
                <View key={c.levelId} style={styles.certWrap}>
                  <CertificateClaim status={c} />
                </View>
              ))}

            {/* The server only sends `certificates` for a class's TERMINAL lesson
                (see LessonDTO), so a non-empty array is the exact signal that
                this completion may earn one. While the request is in flight we
                show a neutral "checking" row rather than pre-rendering a CTA we
                have no right to promise — the real state arrives with the
                response. */}
            {completing && (lesson.certificates ?? []).length > 0 ? (
              <View style={styles.certChecking}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={styles.certCheckingText}>
                  Checking certificate…
                </Text>
              </View>
            ) : null}
          </View>

          {/* ---- downloads ---- */}
          {notes.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Downloads</Text>
              {noteError ? <Text style={styles.error}>{noteError}</Text> : null}
              {savedMsg ? (
                <Text style={styles.savedMsg}>{savedMsg}</Text>
              ) : null}
              {notes.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={styles.noteRow}
                  activeOpacity={0.8}
                  accessibilityRole="button"
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

          {/* ---- description ---- */}
          {lesson.content ? (
            <View style={styles.card}>
              <HtmlView
                html={lesson.content}
                contentWidth={contentWidth - spacing.md * 4}
                baseStyle={styles.descText}
              />
            </View>
          ) : null}

          {/* ---- prev / next ---- */}
          {siblings && total > 1 ? (
            <View style={styles.navRow}>
              <Press
                style={[styles.navBtn, !prevLesson && styles.navBtnOff]}
                disabled={!prevLesson}
                accessibilityRole="button"
                onPress={() => prevLesson && openLesson(prevLesson)}
              >
                <Text style={styles.navBtnText}>← Previous lesson</Text>
              </Press>
              <Press
                style={[styles.navBtn, !nextLesson && styles.navBtnOff]}
                disabled={!nextLesson}
                accessibilityRole="button"
                onPress={() => nextLesson && openLesson(nextLesson)}
              >
                <Text style={styles.navBtnText}>Next lesson →</Text>
              </Press>
            </View>
          ) : null}

          {/* ---- lessons in this course ---- */}
          {siblings && total > 0 ? (
            <View style={styles.card}>
              <View style={styles.lcHead}>
                <Text style={styles.lcTitle} numberOfLines={1}>
                  {courseTitle ?? "This course"}
                </Text>
                <Text style={styles.lcNote}>
                  {doneCount} of {total} done
                </Text>
              </View>
              {siblings.map((l, i) => (
                <LessonRow
                  key={l.id}
                  first={i === 0}
                  title={l.title}
                  durationLabel={
                    l.durationSeconds ? fmtClock(l.durationSeconds) : null
                  }
                  thumbnailUrl={l.thumbnailUrl}
                  state={rowState(l)}
                  onPress={() => {
                    if (l.id !== lesson.id) openLesson(l);
                  }}
                />
              ))}
            </View>
          ) : null}

          {/* ---- up next (navy teaser) ---- */}
          {nextLesson ? (
            <Press
              style={styles.upNext}
              accessibilityRole="button"
              onPress={() => openLesson(nextLesson)}
            >
              {nextLesson.thumbnailUrl ? (
                <Image
                  source={{ uri: nextLesson.thumbnailUrl }}
                  style={styles.upNextThumb}
                />
              ) : (
                <View style={[styles.upNextThumb, styles.upNextThumbEmpty]}>
                  <Text style={styles.upNextGlyph}>▶</Text>
                </View>
              )}
              <View style={styles.upNextInfo}>
                <Text style={styles.upNextLabel}>UP NEXT</Text>
                <Text style={styles.upNextName} numberOfLines={1}>
                  {nextLesson.title}
                </Text>
              </View>
              <Text style={styles.upNextArrow}>→</Text>
            </Press>
          ) : null}

          <View style={styles.spacer} />
        </View>
      </ScrollView>
    </>
  );
}

const makeStyles = ({ colors, fonts }: Theme) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg },
    scrollContent: { paddingBottom: 0 },
    // Body pulls up so the video card overlaps the bottom of the ink band; caps
    // to the reading column on tablets. Vertical rhythm comes from each child's
    // marginBottom (not `gap`) to match the rest of the app's screens.
    body: {
      paddingHorizontal: spacing.md,
      marginTop: -HERO_OVERLAP,
      ...contentColumn,
    },
    // Description rich-text base style (a TEXT style — must NOT be the `body`
    // container above, whose negative marginTop would pull the copy up).
    descText: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 23,
      fontFamily: fonts.regular,
    },
    // ---- hero band content ----
    crumbs: {
      color: "rgba(255,255,255,0.5)",
      fontSize: 11.5,
      fontFamily: fonts.regular,
    },
    heroRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.sm + 4,
      marginTop: spacing.sm + 2,
    },
    heroTitle: {
      flex: 1,
      color: colors.heroText,
      fontSize: 23,
      fontWeight: "800",
      lineHeight: 29,
      fontFamily: fonts.display,
    },
    heroPill: {
      color: "rgba(255,255,255,0.78)",
      backgroundColor: "rgba(255,255,255,0.1)",
      fontSize: 11,
      fontWeight: "600",
      fontFamily: fonts.semibold,
      overflow: "hidden",
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 13,
      marginTop: 3,
    },
    // ---- media ----
    media: { marginBottom: spacing.md },
    video: {
      width: "100%",
      aspectRatio: 16 / 9,
      borderRadius: 16,
      backgroundColor: colors.inkCard,
      overflow: "hidden",
    },
    audioBelow: { marginTop: 10 },
    // ---- generic card ----
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 14,
      fontFamily: fonts.semibold,
      marginBottom: spacing.sm,
    },
    // ---- actions card ----
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 7,
    },
    statusDot: { width: 7, height: 7, borderRadius: 3.5 },
    statusText: {
      color: colors.primarySoft,
      fontSize: 12,
      fontFamily: fonts.semibold,
    },
    metaText: {
      flex: 1,
      minWidth: 140,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: fonts.regular,
    },
    completeBtn: { marginTop: spacing.md },
    completeText: {
      fontSize: 12.5,
      fontFamily: fonts.bold,
      letterSpacing: 0.6,
    },
    doneBanner: {
      marginTop: spacing.md,
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
    certWrap: { marginTop: spacing.md },
    // Neutral in-flight row for a terminal lesson's certificate — deliberately
    // NOT the teal CTA, so it can't read as "your certificate is ready".
    certChecking: {
      marginTop: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      paddingVertical: 13,
      borderRadius: 11,
      backgroundColor: colors.surfaceMuted,
    },
    certCheckingText: {
      color: colors.textMuted,
      fontSize: 14,
      fontFamily: fonts.medium,
    },
    // ---- downloads ----
    noteRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceMuted,
    },
    noteName: {
      flex: 1,
      color: colors.text,
      fontSize: 13.5,
      fontFamily: fonts.medium,
    },
    noteSize: {
      color: colors.textMuted,
      fontSize: 12,
      marginHorizontal: spacing.sm,
      fontFamily: fonts.regular,
    },
    noteIcon: {
      color: colors.primarySoft,
      fontSize: 16,
      fontFamily: fonts.bold,
    },
    error: {
      color: colors.danger,
      marginTop: spacing.sm,
      fontFamily: fonts.regular,
    },
    savedMsg: {
      color: colors.success,
      marginBottom: spacing.sm,
      fontSize: 13.5,
      fontFamily: fonts.regular,
    },
    lockedWrap: { ...formColumn },
    // ---- prev / next ----
    navRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    navBtn: {
      flex: 1,
      alignItems: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSoft,
      borderRadius: 12,
      paddingVertical: 13,
    },
    navBtnOff: { opacity: 0.4 },
    navBtnText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "600",
      fontFamily: fonts.semibold,
    },
    // ---- lessons in course ----
    lcHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    lcTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 14.5,
      fontWeight: "700",
      fontFamily: fonts.bold,
    },
    lcNote: {
      color: colors.textMuted,
      fontSize: 11.5,
      fontFamily: fonts.regular,
    },
    // ---- up next ----
    upNext: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm + 4,
      backgroundColor: colors.inkCard,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.md,
    },
    upNextThumb: {
      width: 56,
      height: 38,
      borderRadius: 8,
      backgroundColor: "rgba(255,255,255,0.1)",
    },
    upNextThumbEmpty: { alignItems: "center", justifyContent: "center" },
    upNextGlyph: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
    upNextInfo: { flex: 1, minWidth: 0 },
    upNextLabel: {
      color: "rgba(255,255,255,0.5)",
      fontSize: 10.5,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
      fontFamily: fonts.bold,
    },
    upNextName: {
      color: "#ffffff",
      fontSize: 13,
      fontWeight: "600",
      marginTop: 2,
      fontFamily: fonts.semibold,
    },
    upNextArrow: {
      color: colors.primaryOnDark,
      fontSize: 18,
      fontFamily: fonts.regular,
    },
    spacer: { height: spacing.lg },
  });
