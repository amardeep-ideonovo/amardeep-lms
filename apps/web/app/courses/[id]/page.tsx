"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { LessonDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import ProgressBar from "@/components/ProgressBar";

function CourseInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const courseId = params.id;
  const [lessons, setLessons] = useState<LessonDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .courseLessons(courseId)
      .then((l) => {
        if (!active) return;
        setLessons([...l].sort((a, b) => a.order - b.order));
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
        setError(err instanceof Error ? err.message : "Failed to load lessons.");
      });
    return () => {
      active = false;
    };
  }, [courseId, router]);

  if (locked) {
    return (
      <div className="locked-panel">
        <div className="lock-icon">🔒</div>
        <h2>This course is locked</h2>
        <p>You need an active membership level to view these lessons.</p>
        <Link href="/account" className="btn btn-primary">
          View plans
        </Link>
      </div>
    );
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!lessons)
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );

  return (
    <>
      <div className="breadcrumb">
        <Link href="/dashboard">Dashboard</Link> / Course
      </div>
      <h1 className="page-title">Lessons</h1>
      <p className="page-sub">{lessons.length} lesson(s) in this course.</p>
      <ProgressBar
        completed={lessons.filter((l) => l.completed).length}
        total={lessons.length}
      />

      {lessons.length === 0 ? (
        <p className="empty">No lessons have been published yet.</p>
      ) : (
        <ul className="lesson-list">
          {lessons.map((lesson, i) => (
            <li key={lesson.id} className="lesson-row">
              <span className="lesson-index">{i + 1}</span>
              <Link href={`/lessons/${lesson.id}`} className="lesson-name">
                {lesson.title}
              </Link>
              {lesson.completed && <span className="lesson-done">Completed</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function CoursePage() {
  return (
    <AuthGate>
      <CourseInner />
    </AuthGate>
  );
}
