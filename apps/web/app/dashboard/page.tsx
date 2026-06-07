"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClassTileDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";
import PopupHost from "@/components/PopupHost";

// A class tile. Clicking it opens the public class page (/classes/<slug ?? id>),
// where a member who owns the class then sees its courses. "Enrolled" marks the
// classes the member's active membership already unlocks.
function ClassTile({ cls }: { cls: ClassTileDTO }) {
  return (
    <Link href={`/classes/${cls.slug ?? cls.id}`} className="cat-tile">
      {cls.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cls.imageUrl} alt="" className="cat-tile-img" />
      ) : (
        <div className="cat-tile-img cat-tile-img--empty">
          {cls.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="cat-tile-body">
        <h3 className="cat-tile-title">{cls.name}</h3>
        <span className="cat-tile-count">
          {cls.owned ? "Enrolled" : "View class"}
        </span>
      </div>
    </Link>
  );
}

function DashboardInner() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassTileDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const cs = await api.myClasses();
        if (!mounted) return;
        setClasses(cs); // update in place — no spinner flash on a focus refresh
        setError(null);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to load dashboard."
        );
      }
    }
    load();
    // Refresh when the member returns to this tab so a class purchased elsewhere
    // (or an admin grant) flips to "Enrolled" without a manual reload.
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!classes)
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );

  // Group tiles by enrollment: classes the member is enrolled in first, then
  // the rest to explore. Each group keeps the backend's name ordering.
  const enrolled = classes.filter((c) => c.owned);
  const available = classes.filter((c) => !c.owned);

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      {classes.length === 0 ? (
        <p className="empty">No classes are available yet.</p>
      ) : (
        <>
          {enrolled.length > 0 && (
            <section>
              <h2 className="section-title" style={{ marginTop: 8 }}>
                My classes
              </h2>
              <div className="card-grid">
                {enrolled.map((c) => (
                  <ClassTile key={c.id} cls={c} />
                ))}
              </div>
            </section>
          )}
          {available.length > 0 && (
            <section>
              <h2 className="section-title">Explore more classes</h2>
              <div className="card-grid">
                {available.map((c) => (
                  <ClassTile key={c.id} cls={c} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <AuthGate>
      <DashboardInner />
      {/* Active popups targeted at the dashboard (shown on every visit). */}
      <PopupHost context={{ type: "dashboard" }} />
    </AuthGate>
  );
}
