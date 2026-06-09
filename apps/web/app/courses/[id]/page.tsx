"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { CourseCard, LessonDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import ProgressBar from "@/components/ProgressBar";

function CourseInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const courseId = params.id;
  const [lessons, setLessons] = useState<LessonDTO[] | null>(null);
  const [course, setCourse] = useState<CourseCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let active = true;
    // Lessons drive the page; the course (for cover + title) is best-effort.
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
    api
      .courses()
      .then((cs) => {
        if (active) setCourse(cs.find((c) => c.id === courseId) ?? null);
      })
      .catch(() => {
        /* cover/title are decorative; ignore failures */
      });
    return () => {
      active = false;
    };
  }, [courseId, router]);

  // One dark canvas wraps every state (locked / error / loading / lessons).
  let body: ReactNode;
  if (locked) {
    body = (
      <div className="locked-panel">
        <div className="lock-icon">🔒</div>
        <h2>This course is locked</h2>
        <p>You need an active membership level to view these lessons.</p>
        <Link href="/account" className="btn btn-primary">
          View plans
        </Link>
      </div>
    );
  } else if (error) {
    body = <div className="alert alert-error">{error}</div>;
  } else if (!lessons) {
    body = (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  } else {
    body = (
      <>
        <div className="breadcrumb">
          <Link href="/dashboard">Dashboard</Link> / Course
        </div>

        {course?.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.coverImageUrl} alt="" className="course-cover" />
        )}

        <h1 className="page-title">{course?.title ?? "Lessons"}</h1>
        {course?.description ? (
          <p className="page-sub">{course.description}</p>
        ) : (
          <p className="page-sub">{lessons.length} lesson(s) in this course.</p>
        )}
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
                {lesson.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lesson.thumbnailUrl}
                    alt=""
                    className="lesson-thumb"
                  />
                ) : (
                  <div
                    className="lesson-thumb lesson-thumb--empty"
                    aria-hidden="true"
                  >
                    ▶
                  </div>
                )}
                <Link href={`/lessons/${lesson.id}`} className="lesson-name">
                  {lesson.title}
                </Link>
                {lesson.completed && (
                  <span className="lesson-done">Completed</span>
                )}
              </li>
            ))}
          </ul>
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

export default function CoursePage() {
  return (
    <AuthGate>
      <CourseInner />
    </AuthGate>
  );
}
