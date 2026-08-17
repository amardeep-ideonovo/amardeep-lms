"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { CourseCard, LessonDTO } from "@lms/types";
import { STR, formatMoney } from "@lms/types";
import { Button } from "@lms/ui";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import ProgressBar from "@/components/ProgressBar";

function CourseInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const courseId = params.id;
  const [lessons, setLessons] = useState<LessonDTO[] | null>(null);
  const [course, setCourse] = useState<CourseCard | null>(null);
  // Tracked separately from `course` so the locked panel can distinguish "still
  // resolving whether this course is purchasable" from "resolved: not purchasable"
  // — without this, a 403 that lands before the course card loads would flash the
  // generic panel (and hide the Buy button) until the card arrives.
  const [courseLoaded, setCourseLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let active = true;
    async function run() {
      // Course card (cover + title + one-off price). Awaited so the locked panel
      // has price info before it renders (no flash), and courseLoaded flips even
      // on failure so we fall back to the generic panel rather than hanging.
      try {
        const cs = await api.courses();
        if (active)
          setCourse(
            cs.find((c) => c.slug === courseId || c.id === courseId) ?? null,
          );
      } catch {
        /* price/cover are best-effort; generic locked panel is the fallback */
      } finally {
        if (active) setCourseLoaded(true);
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

  // Buy a one-off course: hand off to the site's own branded in-app checkout,
  // which grants access and lands on the thank-you page (no hosted redirect).
  function buyCourse() {
    router.push(`/checkout/course/${courseId}`);
  }

  // One dark canvas wraps every state (locked / error / loading / lessons).
  let body: ReactNode;
  if (locked && !courseLoaded) {
    // Still resolving whether the course is purchasable — avoid flashing the
    // wrong locked panel before the course card (and its price) arrives.
    body = (
      <div className="centered-state">
        <div className="spinner" aria-label={STR.common.loadingLabel} />
      </div>
    );
  } else if (locked) {
    const price =
      course?.purchasable && course.priceAmount != null
        ? formatMoney(course.priceAmount, course.priceCurrency ?? "usd")
        : null;
    body = (
      <div className="locked-panel">
        <div className="lock-icon">🔒</div>
        <h2>This course is locked</h2>
        {price ? (
          <>
            <p>
              Buy this course for lifetime access — or unlock it with a
              membership.
            </p>
            <div className="locked-actions">
              <Button type="button" onClick={buyCourse}>
                {`Buy this course · ${price}`}
              </Button>
              <Link href="/account" className="btn btn-secondary">
                View membership plans
              </Link>
            </div>
          </>
        ) : (
          <>
            <p>You need an active membership level to view these lessons.</p>
            <Link href="/account" className="btn btn-primary">
              View plans
            </Link>
          </>
        )}
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
