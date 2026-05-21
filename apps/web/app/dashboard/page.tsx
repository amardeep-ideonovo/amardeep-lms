"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CourseCard, DashboardResponse } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import { useRouter } from "next/navigation";

function Card({ course }: { course: CourseCard }) {
  if (course.locked) {
    return (
      <div className="card locked" aria-disabled="true">
        <span className="lock-badge" aria-label="Locked">
          🔒 Locked
        </span>
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
      <h3 className="card-title">{course.title}</h3>
      {course.description && <p className="card-desc">{course.description}</p>}
      <span className="card-cta">View course →</span>
    </Link>
  );
}

function DashboardInner() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setError(err instanceof Error ? err.message : "Failed to load dashboard.");
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

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">Your courses, organized by category.</p>

      {data.categories.length === 0 && (
        <p className="empty">No courses are available yet.</p>
      )}

      {data.categories.map(({ category, courses }) => (
        <section key={category.id}>
          <h2 className="section-title">{category.name}</h2>
          {courses.length === 0 ? (
            <p className="empty">No courses in this category.</p>
          ) : (
            <div className="card-grid">
              {courses.map((c) => (
                <Card key={c.id} course={c} />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardInner />
    </AuthGate>
  );
}
