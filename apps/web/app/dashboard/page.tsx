"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { CourseCard, DashboardResponse } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import ProgressBar from "@/components/ProgressBar";

function CourseTile({ course }: { course: CourseCard }) {
  if (course.locked) {
    return (
      <div className="card locked" aria-disabled="true">
        <span className="lock-badge" aria-label="Locked">
          🔒 Locked
        </span>
        {course.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.thumbnailUrl} alt="" className="card-thumb" />
        )}
        <h3 className="card-title">{course.title}</h3>
        {course.description && <p className="card-desc">{course.description}</p>}
        <div className="lock-overlay">
          <Link href="/account">Upgrade to unlock →</Link>
        </div>
      </div>
    );
  }
  return (
    <Link href={`/courses/${course.id}`} className="card">
      {course.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={course.thumbnailUrl} alt="" className="card-thumb" />
      )}
      <h3 className="card-title">{course.title}</h3>
      {course.description && <p className="card-desc">{course.description}</p>}
      <ProgressBar completed={course.completedCount} total={course.lessonCount} />
      <span className="card-cta">View course →</span>
    </Link>
  );
}

function CategoryTile({
  href,
  title,
  count,
  thumbnailUrl,
  variant,
}: {
  href: string;
  title: string;
  count: number;
  thumbnailUrl?: string | null;
  variant?: "all";
}) {
  return (
    <Link
      href={href}
      className={`cat-tile${variant === "all" ? " cat-tile--all" : ""}`}
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" className="cat-tile-img" />
      ) : (
        <div className="cat-tile-img cat-tile-img--empty">
          {variant === "all" ? "▦" : title.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="cat-tile-body">
        <h3 className="cat-tile-title">{title}</h3>
        <span className="cat-tile-count">
          {count} course{count === 1 ? "" : "s"}
        </span>
      </div>
    </Link>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let active = true;
    api
      .dashboard()
      .then((d) => active && setData(d))
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load dashboard."
        );
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data)
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );

  const sections = data.categories;
  const allCourses = sections.flatMap((s) => s.courses);
  const withCourses = sections.filter((s) => s.courses.length > 0);
  // "Categories assigned" = at least one course sits in a real category.
  const hasCategories = withCourses.some((s) => s.category.id !== "");

  const catParam = searchParams.get("category");
  const allParam = searchParams.get("all");

  // ----- Drill-down views (no search box here) -----
  if (allParam) {
    const ql = q.trim().toLowerCase();
    const list = ql
      ? allCourses.filter((c) => c.title.toLowerCase().includes(ql))
      : allCourses;
    return (
      <>
        <Link href="/dashboard" className="back-link">
          ← Back
        </Link>
        <h1 className="page-title">All courses</h1>
        {allCourses.length > 0 && (
          <div className="dash-search">
            <input
              type="search"
              placeholder="Search courses…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search courses"
            />
          </div>
        )}
        {list.length === 0 ? (
          <p className="empty">
            {ql
              ? `No courses match “${q}”.`
              : "No courses are available yet."}
          </p>
        ) : (
          <div className="card-grid">
            {list.map((c) => (
              <CourseTile key={c.id} course={c} />
            ))}
          </div>
        )}
      </>
    );
  }

  if (catParam !== null) {
    const sec = sections.find((s) => s.category.id === catParam);
    return (
      <>
        <Link href="/dashboard" className="back-link">
          ← Back
        </Link>
        <h1 className="page-title">{sec?.category.name ?? "Category"}</h1>
        {!sec || sec.courses.length === 0 ? (
          <p className="empty">No courses in this category.</p>
        ) : (
          <div className="card-grid">
            {sec.courses.map((c) => (
              <CourseTile key={c.id} course={c} />
            ))}
          </div>
        )}
      </>
    );
  }

  // ----- Main view -----
  // The search box is rendered ONCE at a stable position; only the content
  // below it switches on the query, so the input never unmounts (keeps focus).
  const query = q.trim().toLowerCase();
  const matchCats = withCourses.filter(
    (s) => s.category.id !== "" && s.category.name.toLowerCase().includes(query)
  );
  const matchCourses = allCourses.filter((c) =>
    c.title.toLowerCase().includes(query)
  );

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      {allCourses.length > 0 && (
        <div className="dash-search">
          <input
            type="search"
            placeholder="Search categories or courses…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search categories or courses"
          />
        </div>
      )}

      {allCourses.length === 0 ? (
        <p className="empty">No courses are available yet.</p>
      ) : query ? (
        matchCats.length === 0 && matchCourses.length === 0 ? (
          <p className="empty">No categories or courses match “{q}”.</p>
        ) : (
          <>
            {matchCats.length > 0 && (
              <section>
                <h2 className="section-title">Categories</h2>
                <div className="card-grid">
                  {matchCats.map((s) => (
                    <CategoryTile
                      key={s.category.id}
                      href={`/dashboard?category=${s.category.id}`}
                      title={s.category.name}
                      count={s.courses.length}
                      thumbnailUrl={s.category.thumbnailUrl}
                    />
                  ))}
                </div>
              </section>
            )}
            {matchCourses.length > 0 && (
              <section>
                <h2 className="section-title">Courses</h2>
                <div className="card-grid">
                  {matchCourses.map((c) => (
                    <CourseTile key={c.id} course={c} />
                  ))}
                </div>
              </section>
            )}
          </>
        )
      ) : !hasCategories ? (
        <div className="card-grid">
          {allCourses.map((c) => (
            <CourseTile key={c.id} course={c} />
          ))}
        </div>
      ) : (
        <div className="card-grid">
          {withCourses.map((s) => (
            <CategoryTile
              key={s.category.id || "uncategorized"}
              href={`/dashboard?category=${s.category.id}`}
              title={s.category.name}
              count={s.courses.length}
              thumbnailUrl={s.category.thumbnailUrl}
            />
          ))}
          <CategoryTile
            href="/dashboard?all=1"
            title="All courses"
            count={allCourses.length}
            variant="all"
          />
        </div>
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate>
      <Suspense
        fallback={
          <div className="centered-state">
            <div className="spinner" aria-label="Loading" />
          </div>
        }
      >
        <DashboardInner />
      </Suspense>
    </AuthGate>
  );
}
