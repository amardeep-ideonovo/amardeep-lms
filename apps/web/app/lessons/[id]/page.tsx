"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  ClassCertificateStatusDTO,
  CourseCard,
  LessonDTO,
  LessonNoteDTO,
} from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import { fmtDuration } from "@/lib/memberData";
import { useOptimisticAction } from "@/lib/useOptimisticAction";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import CertificateClaimButton from "@/components/CertificateClaimButton";

// Parse a Vimeo URL into its player embed URL (or null if not a Vimeo link).
// lesson.videoUrl holds a Vimeo link, a YouTube link, or a direct file URL.
function vimeoEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  // Grab the numeric id from any vimeo.com path shape — vimeo.com/<id>,
  // /video/<id>, player.vimeo.com/video/<id>, or /channels|groups|showcase/<id>
  // (kept in step with the mobile vimeoEmbed and admin parseVimeoId).
  const id = url.match(/vimeo\.com\/(?:[^/?#]+\/)*(\d+)/)?.[1];
  if (!id) return null;
  // Optional privacy hash: ?h=xxxx or vimeo.com/<id>/<hash>
  const h =
    url.match(/[?&]h=([0-9A-Za-z]+)/)?.[1] ??
    url.match(/vimeo\.com\/\d+\/([0-9A-Za-z]+)/)?.[1];
  const params = [h ? `h=${h}` : "", "title=0", "byline=0", "portrait=0"]
    .filter(Boolean)
    .join("&");
  return `https://player.vimeo.com/video/${id}?${params}`;
}

// YouTube 11-char video id from watch / youtu.be / shorts / embed / v / live
// links (kept in sync with apps/admin/lib/lessonMedia.ts parseYouTubeId and the
// mobile youtubeId). null when the URL isn't YouTube.
function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  return (
    url.match(
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
    )?.[1] ?? null
  );
}

// Privacy-domain YouTube embed with resume baked in via start=<seconds>, so the
// player resumes on load with no JS-API round-trip. enablejsapi=1 lets the
// best-effort heartbeat below read the live position.
function youtubeEmbedSrc(id: string, startSeconds: number): string {
  const start = startSeconds > 0 ? `&start=${Math.floor(startSeconds)}` : "";
  return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1${start}`;
}

// A Vimeo/YouTube link — even one whose id we FAILED to parse. Such a URL must
// never be handed to a raw <video src> (it would 404 / show a broken player);
// it falls back to the thumbnail instead. Direct file URLs (mp4/hls) are not
// provider links, so they still play in <video>.
function isProviderVideoUrl(url: string | null | undefined): boolean {
  return (
    !!url &&
    /(?:youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com)/i.test(url)
  );
}

const CheckIcon = ({ size = 13, color = "#2a9d8d" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M20 6 9 17l-5-5"
      stroke={color}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const PlayGlyph = ({ size = 11, fill = "#8b87a3" }: { size?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m8 5 12 7-12 7z" fill={fill} />
  </svg>
);
const DownloadIcon = ({ color = "#272144" }: { color?: string }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
      stroke={color}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function LessonInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lessonId = params.id;
  const runOptimistic = useOptimisticAction();

  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [siblings, setSiblings] = useState<LessonDTO[] | null>(null);
  const [course, setCourse] = useState<CourseCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Per-class certificate state — present only when this is the final lesson
  // of a class with certificates configured.
  const [certificates, setCertificates] = useState<ClassCertificateStatusDTO[]>([]);

  useEffect(() => {
    let active = true;
    api
      .lesson(lessonId)
      .then((l) => {
        if (!active) return;
        setLesson(l);
        setCompleted(!!l.completed);
        setCertificates(l.certificates ?? []);
        // Course rail: sibling lessons + the course card (title for the meta
        // line). Both best-effort — the player works without them.
        api
          .courseLessons(l.courseId)
          .then((ls) => active && setSiblings([...ls].sort((a, b) => a.order - b.order)))
          .catch(() => active && setSiblings([]));
        api
          .courses()
          .then((cs) => active && setCourse(cs.find((c) => c.id === l.courseId) ?? null))
          .catch(() => {});
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setLocked(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load lesson.");
      });
    return () => {
      active = false;
    };
  }, [lessonId, router]);

  // The tick, the status pill and the rail flip before the request: the endpoint
  // behind this joins lesson+course, runs two access queries, a progress lookup,
  // an upsert and a certificate check, and this is the most repeated action in
  // the product. Completion is a member-owned toggle, so it is safe to paint and
  // reverse. The CERTIFICATE is not — see `commit`.
  async function markComplete() {
    setCompleting(true);
    setError(null);
    await runOptimistic(`lesson:${lessonId}`, {
      snapshot: () => ({ completed, siblings }),
      apply: () => {
        setCompleted(true);
        setSiblings((ls) =>
          ls
            ? ls.map((l) => (l.id === lessonId ? { ...l, completed: true } : l))
            : ls,
        );
      },
      commit: async () => {
        const res = await api.completeLesson(lessonId);
        // A certificate is a GRANT, not a toggle — it is only ever rendered from
        // what the server returned, never inferred from the flip above.
        if (res?.certificates) setCertificates(res.certificates);
      },
      revert: (snap) => {
        setCompleted(snap.completed);
        setSiblings(snap.siblings);
      },
      onError: (err) => {
        // Access revoked mid-session: the flip is already reverted, and the
        // lesson locks as it did before.
        if (err instanceof ApiError && err.status === 403) {
          setLocked(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Could not mark complete.");
      },
    });
    setCompleting(false);
  }

  async function download(note: LessonNoteDTO) {
    setNoteError(null);
    setDownloadingId(note.id);
    try {
      await api.downloadNote(note);
    } catch (err) {
      setNoteError(
        err instanceof Error ? err.message : "Could not download the file."
      );
    } finally {
      setDownloadingId(null);
    }
  }

  const lessonPos = useMemo(() => {
    if (!siblings || siblings.length === 0) return null;
    const i = siblings.findIndex((l) => l.id === lessonId);
    return i >= 0 ? { n: i + 1, of: siblings.length } : null;
  }, [siblings, lessonId]);

  // "Up next": the next lesson after this one in the course order.
  const upNext = useMemo(() => {
    if (!siblings) return null;
    const i = siblings.findIndex((l) => l.id === lessonId);
    return i >= 0 && i + 1 < siblings.length ? siblings[i + 1] : null;
  }, [siblings, lessonId]);

  // ---- playback progress: mark started on open + save the resume point ----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastSaveRef = useRef(0);

  const saveProgress = useCallback(
    (pos: number) => {
      if (!Number.isFinite(pos) || pos < 0) return;
      api.recordLessonProgress(lessonId, Math.floor(pos)).catch(() => {});
    },
    [lessonId],
  );
  // Throttle the position heartbeat to at most once every 10s.
  const throttledSave = useCallback(
    (pos: number) => {
      const now = Date.now();
      if (now - lastSaveRef.current < 10000) return;
      lastSaveRef.current = now;
      saveProgress(pos);
    },
    [saveProgress],
  );

  // Opening a lesson marks it "started" (creates the progress row) so the class
  // flips to "In progress" immediately — even before any playback.
  useEffect(() => {
    if (!lesson) return;
    saveProgress(lesson.lastPositionSeconds ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id]);

  // Vimeo resume + position tracking via the iframe postMessage API (best-
  // effort: the player just starts from zero if a command is dropped).
  useEffect(() => {
    const iframe = iframeRef.current;
    const resumeTo = lesson?.lastPositionSeconds ?? 0;
    if (!iframe || !lesson || !vimeoEmbed(lesson.videoUrl)) return;
    const post = (method: string, value?: unknown) =>
      iframe.contentWindow?.postMessage(
        JSON.stringify(value === undefined ? { method } : { method, value }),
        "https://player.vimeo.com",
      );
    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin === "string" && !e.origin.includes("player.vimeo.com"))
        return;
      let data: { event?: string; data?: { seconds?: number } };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (data?.event === "ready") {
        post("addEventListener", "timeupdate");
        if (resumeTo > 0) post("setCurrentTime", resumeTo);
      } else if (data?.event === "timeupdate") {
        const s = data.data?.seconds;
        if (typeof s === "number") throttledSave(s);
      }
    };
    window.addEventListener("message", onMessage);
    // Nudge, in case the player was ready before this listener attached.
    post("addEventListener", "ready");
    post("addEventListener", "timeupdate");
    const t =
      resumeTo > 0
        ? window.setTimeout(() => post("setCurrentTime", resumeTo), 1500)
        : undefined;
    return () => {
      window.removeEventListener("message", onMessage);
      if (t) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, throttledSave]);

  // YouTube position heartbeat via the iframe API (best-effort, mirrors Vimeo).
  // start=<resume> in the embed URL already handles resume-on-load, so a dropped
  // subscription only loses mid-play position updates — never resume.
  useEffect(() => {
    const iframe = ytIframeRef.current;
    if (!iframe || !lesson || !youtubeId(lesson.videoUrl)) return;
    const post = (msg: unknown) =>
      iframe.contentWindow?.postMessage(JSON.stringify(msg), "*");
    const onMessage = (e: MessageEvent) => {
      // Only trust the YouTube player's own origins (nocookie serves the embed;
      // the player itself may post from youtube.com). A substring check would
      // trust e.g. "https://youtube.evil.com" and let it spoof a currentTime
      // that corrupts the saved resume point.
      if (
        e.origin !== "https://www.youtube-nocookie.com" &&
        e.origin !== "https://www.youtube.com"
      )
        return;
      let data: { event?: string; info?: { currentTime?: number } };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (
        data?.event === "infoDelivery" &&
        typeof data.info?.currentTime === "number"
      ) {
        throttledSave(data.info.currentTime);
      }
    };
    window.addEventListener("message", onMessage);
    // Subscribe repeatedly for a few seconds in case the player wasn't ready
    // when the first message was posted, then stop.
    let tries = 0;
    const iv = window.setInterval(() => {
      post({ event: "listening", id: 1 });
      if (++tries >= 5) window.clearInterval(iv);
    }, 1000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, throttledSave]);

  const railDone = siblings?.filter((l) => l.completed || l.id === (completed ? lessonId : "")).length ?? 0;

  /* ---------- locked / error / loading states on the light canvas ---------- */
  if (locked) {
    return (
      <div className="ink-page">
        <div className="ik-band" />
        <div className="ik-main">
          <div className="locked-panel">
            <div className="lock-icon">🔒</div>
            <h2>This lesson is locked</h2>
            <p>Your current membership doesn’t include access to this lesson.</p>
            <Link href="/account" className="btn btn-primary">
              Upgrade membership
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (error && !lesson) {
    return (
      <div className="ink-page">
        <div className="ik-band" />
        <div className="ik-main">
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    );
  }
  if (!lesson) {
    return (
      <div className="ink-page">
        <div className="ik-band">
          <div className="ik-band-inner ik-band-inner--crumbs">
            <div className="ik-skel ik-skel--ink" style={{ width: 260, height: 14 }} />
            <div className="ik-skel ik-skel--ink" style={{ width: 380, height: 30, marginTop: 16 }} />
          </div>
        </div>
        <div className="ik-main">
          <div className="ik-cols ik-cols--player">
            <div className="ik-skel" style={{ aspectRatio: "16/9", borderRadius: 18 }} />
            <div className="ik-skel" style={{ height: 220, borderRadius: 16, background: "#fff" }} />
          </div>
        </div>
      </div>
    );
  }

  const vimeo = vimeoEmbed(lesson.videoUrl);
  const ytId = youtubeId(lesson.videoUrl);
  const resumeAt = lesson.lastPositionSeconds ?? 0;
  const notes = lesson.notes ?? [];
  const fmtSize = (n: number) =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const dur = fmtDuration(lesson.durationSeconds);

  let media: ReactNode;
  if (lesson.audioUrl) {
    // Audio lesson: the thumbnail (or a headphones glyph) is the backdrop and
    // the controls sit on top. The same three handlers as the <video> branch
    // give resume + heartbeat, since <audio> is the same HTMLMediaElement API.
    media = (
      <>
        {lesson.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lesson.thumbnailUrl} alt="" className="ik-player-hero" />
        ) : (
          <span className="ik-player-audio-glyph" aria-hidden="true">
            🎧
          </span>
        )}
        <span className="ik-player-scrim" aria-hidden="true" />
        <div className="ik-player-audio">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            controls
            src={lesson.audioUrl}
            onLoadedMetadata={(e) => {
              const pos = lesson.lastPositionSeconds ?? 0;
              if (pos > 0 && pos < (e.currentTarget.duration || Infinity)) {
                e.currentTarget.currentTime = pos;
              }
            }}
            onTimeUpdate={(e) => throttledSave(e.currentTarget.currentTime)}
            onPause={(e) => saveProgress(e.currentTarget.currentTime)}
          />
        </div>
      </>
    );
  } else if (vimeo) {
    media = (
      <iframe
        ref={iframeRef}
        src={vimeo}
        title={lesson.title}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  } else if (ytId) {
    media = (
      <iframe
        ref={ytIframeRef}
        src={youtubeEmbedSrc(ytId, resumeAt)}
        title={lesson.title}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  } else if (lesson.videoUrl && !isProviderVideoUrl(lesson.videoUrl)) {
    media = (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        ref={videoRef}
        controls
        playsInline
        src={lesson.videoUrl}
        onLoadedMetadata={(e) => {
          const pos = lesson.lastPositionSeconds ?? 0;
          if (pos > 0 && pos < (e.currentTarget.duration || Infinity)) {
            e.currentTarget.currentTime = pos;
          }
        }}
        onTimeUpdate={(e) => throttledSave(e.currentTarget.currentTime)}
        onPause={(e) => saveProgress(e.currentTarget.currentTime)}
      />
    );
  } else if (lesson.thumbnailUrl) {
    media = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lesson.thumbnailUrl} alt="" className="ik-player-hero" />
        <span className="ik-player-scrim" aria-hidden="true" />
      </>
    );
  } else {
    media = <span className="ik-player-scrim" aria-hidden="true" />;
  }

  return (
    <div className="ink-page">
      <PopupHost context={{ type: "lessons" }} />

      {/* ---- band: breadcrumb + lesson title + position pill (frame 2d) ---- */}
      <div className="ik-band">
        <div className="ik-band-inner ik-band-inner--crumbs">
          <nav className="ik-crumbs" aria-label="Breadcrumb">
            <Link href="/dashboard">Dashboard</Link>
            <span aria-hidden="true">›</span>
            <Link href={`/courses/${course?.slug ?? lesson.courseId}`}>{course?.title ?? "Course"}</Link>
            <span aria-hidden="true">›</span>
            <span className="on">{lessonPos ? `Lesson ${lessonPos.n}` : "Lesson"}</span>
          </nav>
          <div className="ik-band-row" style={{ marginTop: 12 }}>
            <div className="ik-grow">
              <h1 className="ik-band-title" style={{ fontSize: 24 }}>
                {lesson.title}
              </h1>
            </div>
            {lessonPos && (
              <span className="ik-band-pill">
                Lesson {lessonPos.n} of {lessonPos.of}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="ik-main">
        <div className="ik-cols ik-cols--player">
          {/* ---- left: player + action card + downloads + content ---- */}
          <div>
            <div className="ik-player">{media}</div>

            <section className="ik-panel ik-actions-card">
              <div className="ik-actions-row">
                <span className={completed ? "ik-status" : "ik-status ik-status--todo"}>
                  <span className="ik-status-dot" aria-hidden="true" />
                  {completed ? "Completed" : "In progress"}
                </span>
                <span className="ik-actions-meta">
                  {dur ? `Duration ${dur}` : null}
                  {dur && course ? " · " : null}
                  {course ? `Course: ${course.title}` : null}
                </span>
                <div className="ik-grow" style={{ flex: 1 }} />
                {notes.length > 0 && (
                  <a href="#downloads" className="ik-ghost ik-ghost--sm">
                    <DownloadIcon />
                    Resources
                  </a>
                )}
                {completed ? (
                  <span className="ik-ghost ik-ghost--sm" style={{ cursor: "default", color: "var(--teal-text)", borderColor: "rgba(53,179,162,.35)" }}>
                    <CheckIcon />
                    Marked complete
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ik-cta ik-cta--sm"
                    onClick={markComplete}
                    disabled={completing}
                    aria-busy={completing}
                  >
                    <CheckIcon color="#fff" />
                    {completing ? "Saving…" : "Mark as complete"}
                  </button>
                )}
              </div>

              {error && (
                <div className="alert alert-error" style={{ marginTop: 14, marginBottom: 0 }}>
                  {error}
                </div>
              )}

              {certificates.length > 0 && (
                <>
                  <hr className="ik-divider" />
                  <div style={{ display: "grid", gap: 14 }}>
                    {certificates.map((c) => (
                      <div key={c.levelId} style={{ display: "grid", gap: 6 }}>
                        {(c.eligible || c.claimed) && certificates.length > 1 && (
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{c.levelName}</span>
                        )}
                        {c.eligible || c.claimed ? (
                          <CertificateClaimButton status={c} />
                        ) : completing ? (
                          // The optimistic tick has already landed but the grant
                          // hasn't come back yet. Saying "finish every lesson"
                          // here would contradict the ✓ the member just saw, and
                          // showing the claim button would promise a credential
                          // the server hasn't issued.
                          //
                          // No extra "is this the last lesson?" guard is needed:
                          // the API returns certificate status ONLY for a class's
                          // terminal lesson (certificates.service statusForLesson
                          // returns [] otherwise), so this block rendering at all
                          // is already the server saying so.
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                            Checking your certificate…
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                            Finish every lesson in “{c.levelName}” to earn your certificate.
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            {notes.length > 0 && (
              <section className="ik-panel" id="downloads" style={{ marginTop: 16 }}>
                <div className="ik-panel-head">
                  <span className="ik-panel-title">Downloads</span>
                </div>
                {noteError && (
                  <p className="alert alert-error" style={{ marginTop: 10 }}>
                    {noteError}
                  </p>
                )}
                <div className="ik-rows">
                  {notes.map((n) => (
                    <div key={n.id} className="ik-download">
                      <span className="ik-download-name">{n.originalName}</span>
                      <span className="ik-download-size">{fmtSize(n.size)}</span>
                      <button
                        type="button"
                        className="ik-ghost ik-ghost--sm"
                        onClick={() => download(n)}
                        disabled={downloadingId === n.id}
                        aria-busy={downloadingId === n.id}
                      >
                        <DownloadIcon />
                        {downloadingId === n.id ? "Downloading…" : "Download"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {lesson.content && <div className="ik-lesson-content">{lesson.content}</div>}
          </div>

          {/* ---- right rail: course lessons + up-next teaser ---- */}
          <div className="ik-stack">
            <section className="ik-panel ik-panel--snug" aria-label="Course lessons">
              <div className="ik-panel-head" style={{ marginBottom: 6 }}>
                <span className="ik-panel-title ik-panel-title--lg">
                  {course?.title ?? "This course"}
                </span>
                <div className="ik-grow" />
                {siblings && siblings.length > 0 && (
                  <span className="ik-panel-note">
                    {railDone} of {siblings.length} done
                  </span>
                )}
              </div>
              {siblings === null ? (
                <div>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="ik-lesson">
                      <span className="ik-skel" style={{ width: 56, height: 38 }} />
                      <span className="ik-lesson-main">
                        <span className="ik-skel" style={{ width: "70%", height: 13 }} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                siblings.map((l) => {
                  const isCurrent = l.id === lessonId;
                  const isDone = l.completed || (isCurrent && completed);
                  const d = fmtDuration(l.durationSeconds);
                  return (
                    <Link
                      key={l.id}
                      href={`/lessons/${l.id}`}
                      className={isCurrent ? "ik-lesson ik-lesson--current" : "ik-lesson"}
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      {l.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.thumbnailUrl} alt="" className="ik-lesson-thumb" />
                      ) : (
                        <span className="ik-lesson-thumb" aria-hidden="true" />
                      )}
                      <span className="ik-lesson-main">
                        <span className="ik-lesson-title">{l.title}</span>
                        {d && <span className="ik-lesson-dur">{d}</span>}
                      </span>
                      {isCurrent && !isDone ? (
                        <span className="ik-resume-pill">RESUME</span>
                      ) : isDone ? (
                        <span className="ik-lesson-state ik-lesson-state--done">
                          <CheckIcon />
                        </span>
                      ) : (
                        <span className="ik-lesson-state ik-lesson-state--todo">
                          <PlayGlyph />
                        </span>
                      )}
                    </Link>
                  );
                })
              )}
            </section>

            {upNext && (
              <Link href={`/lessons/${upNext.id}`} className="ik-upnext">
                {upNext.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={upNext.thumbnailUrl} alt="" className="ik-upnext-thumb" />
                ) : (
                  <span
                    className="ik-upnext-thumb"
                    style={{ background: "rgba(255,255,255,.1)" }}
                    aria-hidden="true"
                  />
                )}
                <span className="ik-upnext-main">
                  <span className="ik-upnext-label">Up next</span>
                  <span className="ik-upnext-title">{upNext.title}</span>
                </span>
                <span className="ik-upnext-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LessonPage() {
  return (
    <AuthGate>
      <LessonInner />
    </AuthGate>
  );
}
