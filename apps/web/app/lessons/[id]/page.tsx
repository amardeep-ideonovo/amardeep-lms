"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import MuxPlayer from "@mux/mux-player-react";
import type { LessonDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

// Mux requires a real playbackId; the API supplies a signed token via
// muxPlaybackToken. We use a placeholder playbackId here per spec.
const PLACEHOLDER_PLAYBACK_ID = "00000000000000000000000000000000";

function LessonInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const lessonId = params.id;

  const [lesson, setLesson] = useState<LessonDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);

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

  if (locked) {
    return (
      <div className="locked-panel">
        <div className="lock-icon">🔒</div>
        <h2>This lesson is locked</h2>
        <p>Your current membership doesn’t include access to this lesson.</p>
        <Link href="/account" className="btn btn-primary">
          Upgrade membership
        </Link>
      </div>
    );
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!lesson)
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );

  return (
    <>
      <div className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link> /{" "}
        <Link href={`/courses/${lesson.courseId}`}>Course</Link> / Lesson
      </div>
      <h1 className="page-title">{lesson.title}</h1>

      {lesson.muxPlaybackToken && (
        <div className="player-wrap">
          <MuxPlayer
            playbackId={PLACEHOLDER_PLAYBACK_ID}
            tokens={{ playback: lesson.muxPlaybackToken }}
            streamType="on-demand"
            style={{ height: "100%", width: "100%" }}
          />
        </div>
      )}

      {lesson.content && <div className="lesson-content">{lesson.content}</div>}

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
    </>
  );
}

export default function LessonPage() {
  return (
    <AuthGate>
      <LessonInner />
    </AuthGate>
  );
}
