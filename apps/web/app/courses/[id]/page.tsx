"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { CourseCard, LessonDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";
import ProgressBar from "@/components/ProgressBar";

// Minor units (cents) -> localized currency string, e.g. (2500, "usd") => "$25.00".
function formatMoney(minor: number, currency?: string): string {
  const cur = (currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${cur}`;
  }
}

function CourseInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
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
  const [buying, setBuying] = useState(false);
  // True once we return from a successful Stripe checkout. If the course is still
  // locked (webhook lag / a failed inline confirm), we show a "finalizing" panel
  // with a Refresh instead of re-offering the Buy button — which would otherwise
  // invite a second payment.
  const [justPaid, setJustPaid] = useState(false);
  // Bumped by the Refresh button to re-run the load (re-checks the grant).
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    async function run() {
      // Returning from a successful one-off checkout: confirm the grant BEFORE
      // loading lessons so the page opens unlocked without waiting on the webhook.
      const purchase = search.get("purchase");
      const sessionId = search.get("session_id");
      if (purchase === "success" && sessionId) {
        setJustPaid(true);
        try {
          await api.confirmCoursePurchase(sessionId);
        } catch {
          /* webhook is the backstop; the load below shows the real state */
        }
        // Strip the checkout params so a refresh/back never re-confirms.
        if (active) router.replace(`/courses/${courseId}`);
      }

      // Course card (cover + title + one-off price). Awaited so the locked panel
      // has price info before it renders (no flash), and courseLoaded flips even
      // on failure so we fall back to the generic panel rather than hanging.
      try {
        const cs = await api.courses();
        if (active) setCourse(cs.find((c) => c.id === courseId) ?? null);
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
        setError(err instanceof Error ? err.message : "Failed to load lessons.");
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [courseId, router, search, reloadTick]);

  async function buyCourse() {
    if (buying) return;
    setBuying(true);
    try {
      const { url } = await api.courseCheckout(courseId);
      // Hand off to Stripe's hosted checkout; we return to
      // /courses/<id>?purchase=success&session_id=… where the effect confirms.
      window.location.href = url;
    } catch (err) {
      setBuying(false);
      setError(
        err instanceof Error ? err.message : "Could not start checkout.",
      );
    }
  }

  // One dark canvas wraps every state (locked / error / loading / lessons).
  let body: ReactNode;
  if (locked && justPaid) {
    // Paid, but access isn't active yet (webhook lag or a failed inline confirm).
    // Never re-show Buy here — that risks a second charge.
    body = (
      <div className="locked-panel">
        <div className="lock-icon">⏳</div>
        <h2>Finalizing your purchase…</h2>
        <p>
          Payment received. Access can take a moment to activate — this usually
          only takes a few seconds.
        </p>
        <div className="locked-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            Refresh
          </button>
          <Link href="/account" className="btn btn-secondary">
            Go to my account
          </Link>
        </div>
      </div>
    );
  } else if (locked && !courseLoaded) {
    // Still resolving whether the course is purchasable — avoid flashing the
    // wrong locked panel before the course card (and its price) arrives.
    body = (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  } else if (locked) {
    const price =
      course?.purchasable && course.priceAmount != null
        ? formatMoney(course.priceAmount, course.priceCurrency)
        : null;
    body = (
      <div className="locked-panel">
        <div className="lock-icon">🔒</div>
        <h2>This course is locked</h2>
        {price ? (
          <>
            <p>Buy this course for lifetime access — or unlock it with a membership.</p>
            <div className="locked-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={buyCourse}
                disabled={buying}
              >
                {buying ? "Starting checkout…" : `Buy this course · ${price}`}
              </button>
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
      <PopupHost context={{ type: "courses" }} />
      <div className="cd-wrap">{body}</div>
    </div>
  );
}

export default function CoursePage() {
  return (
    <AuthGate>
      {/* CourseInner reads useSearchParams (checkout return params) — Suspense
          keeps Next's prerender happy, mirroring the checkout thank-you page. */}
      <Suspense
        fallback={
          <div className="course-cinema">
            <div className="cd-wrap">
              <div className="centered-state">
                <div className="spinner" aria-label="Loading" />
              </div>
            </div>
          </div>
        }
      >
        <CourseInner />
      </Suspense>
    </AuthGate>
  );
}
