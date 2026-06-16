"use client";

import { useEffect, useState } from "react";
import type { AudienceDTO, MenuListItem } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import FooterBuilder from "./FooterBuilder";

// Standalone "Footer" page (sidebar item under Header). Single global footer:
// logo, a menu, an email opt-in, and a bottom bar. Gated by the `menus` permission.
export default function FooterPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [menus, setMenus] = useState<MenuListItem[]>([]);
  const [audiences, setAudiences] = useState<AudienceDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !can("menus", "read")) return;
    Promise.all([
      api.listMenus(),
      // In-house audiences for the newsletter opt-in picker; degrade to empty
      // (signups still land in the default audience server-side).
      api.listAudiences().catch(() => [] as AudienceDTO[]),
    ])
      .then(([m, a]) => {
        setMenus(m);
        setAudiences(a);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load."),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("menus", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Footer</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>Footer</h1>
        <p className="subtitle">
          The site footer — logo, a menu, and an email opt-in, plus a bottom bar.
          Shown on every page when enabled.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      <FooterBuilder
        menus={menus}
        audiences={audiences}
        canEdit={can("menus", "edit")}
        onError={setError}
      />
    </div>
  );
}
