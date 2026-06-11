"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { LessonDTO, LessonNoteDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

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

function LessonInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lessonId = params.id;

  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .lesson(lessonId)
      .then((l) => {
        if (!active) return;
        setLesson(l);
        setCompleted(!!l.completed);
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
      await api.completeLesson(lessonId);
      setCompleted(true);
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

  // One dark canvas wraps every state (locked / error / loading / lesson).
  let body: ReactNode;
  if (locked) {
    body = (
      <div className="locked-panel">
        <div className="lock-icon">🔒</div>
        <h2>This lesson is locked</h2>
        <p>Your current membership doesn’t include access to this lesson.</p>
        <Link href="/account" className="btn btn-primary">
          Upgrade membership
        </Link>
      </div>
    );
  } else if (error) {
    body = <div className="alert alert-error">{error}</div>;
  } else if (!lesson) {
    body = (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  } else {
    const vimeo = vimeoEmbed(lesson.videoUrl);
    const notes = lesson.notes ?? [];
    const fmtSize = (n: number) =>
      n < 1024
        ? `${n} B`
        : n < 1024 * 1024
        ? `${(n / 1024).toFixed(0)} KB`
        : `${(n / 1024 / 1024).toFixed(1)} MB`;

    body = (
      <>
        <div className="breadcrumb">
          <Link href="/dashboard">Dashboard</Link> /{" "}
          <Link href={`/courses/${lesson.courseId}`}>Course</Link> / Lesson
        </div>
        <h1 className="page-title">{lesson.title}</h1>

        {vimeo ? (
          <div className="player-wrap">
            <iframe
              src={vimeo}
              title={lesson.title}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              style={{ height: "100%", width: "100%", border: 0 }}
            />
          </div>
        ) : lesson.videoUrl ? (
          <div className="player-wrap">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              controls
              playsInline
              src={lesson.videoUrl}
              style={{ height: "100%", width: "100%", background: "#000" }}
            />
          </div>
        ) : lesson.thumbnailUrl ? (
          // No video — show the lesson thumbnail as a hero image instead.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lesson.thumbnailUrl} alt="" className="lesson-hero" />
        ) : null}

        {notes.length > 0 && (
          <div className="downloads">
            <h2 className="downloads-title">Downloads</h2>
            {noteError && <p className="alert alert-error">{noteError}</p>}
            <ul className="downloads-list">
              {notes.map((n) => (
                <li key={n.id} className="download-item">
                  <span className="download-name">{n.originalName}</span>
                  <span className="download-size">{fmtSize(n.size)}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => download(n)}
                    disabled={downloadingId === n.id}
                  >
                    {downloadingId === n.id ? "Downloading…" : "Download"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {completed ? (
          <span className="lesson-done">✓ Completed</span>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={markComplete}
            disabled={completing}
          >
            {completing ? "Saving…" : "Mark complete"}
          </button>
        )}

        {lesson.content && (
          <div className="lesson-content lesson-content--below">
            {lesson.content}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="course-cinema">
      <div className="cd-wrap">{body}</div>
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
