"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { CourseCard, LessonDTO } from "@lms/types";
import { STR } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import { buttonClass } from "@lms/ui";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
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
    async function run() {
      // Course card (cover + title + description for the content view). Best
      // effort — the lessons call below drives the locked/error/content states.
      try {
        const cs = await api.courses();
        if (active)
          setCourse(
            cs.find((c) => c.slug === courseId || c.id === courseId) ?? null,
          );
      } catch {
        /* cover/title are best-effort; the page still renders without them */
      }

      // Lessons drive the page (locked / error / content).
      try {
        const l = await api.courseLessons(courseId);
        if (!active) return;
        setLessons([...l].sort((a, b) => a.order - b.order));
        setLocked(false);
      } catch (err) {
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
        setError(
          err instanceof Error ? err.message : "Failed to load lessons.",
        );
      }
    }
    void run();
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
        <Link href="/account" className={buttonClass()}>
          View plans
        </Link>
      </div>
    );
  } else if (error) {
    body = <div className="alert alert-error">{error}</div>;
  } else if (!lessons) {
    body = (
      <div className="centered-state">
        <div className="spinner" aria-label={STR.common.loadingLabel} />
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
          <div
            className="page-sub rich-text"
            dangerouslySetInnerHTML={{ __html: course.description }}
          />
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
      <PopupHost context={{ type: "courses" }} />
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
