"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import CertificateClaimButton from "@/components/CertificateClaimButton";

// Parse a Vimeo URL into its player embed URL (or null if not a Vimeo link).
// Production videos are hosted on Vimeo; lesson.videoUrl holds the Vimeo link.
function vimeoEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
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

  async function markComplete() {
    setCompleting(true);
    setError(null);
    try {
      const res = await api.completeLesson(lessonId);
      setCompleted(true);
      // Reflect in the rail without a refetch.
      setSiblings((ls) =>
        ls ? ls.map((l) => (l.id === lessonId ? { ...l, completed: true } : l)) : ls,
      );
      // Completing the final lesson unlocks the claim instantly (no refetch).
      if (res?.certificates) setCertificates(res.certificates);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLocked(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not mark complete.");
    } finally {
      setCompleting(false);
    }
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
  const notes = lesson.notes ?? [];
  const fmtSize = (n: number) =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const dur = fmtDuration(lesson.durationSeconds);

  let media: ReactNode;
  if (vimeo) {
    media = (
      <iframe
        src={vimeo}
        title={lesson.title}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  } else if (lesson.videoUrl) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    media = <video controls playsInline src={lesson.videoUrl} />;
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
            <Link href={`/courses/${lesson.courseId}`}>{course?.title ?? "Course"}</Link>
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
