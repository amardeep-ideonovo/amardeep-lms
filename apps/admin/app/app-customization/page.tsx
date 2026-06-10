"use client";

import { useState } from "react";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import AppCustomizationBuilder from "./AppCustomizationBuilder";

// Standalone "App Customization" page (System group). A single global config
// that drives the native mobile app's branding — title, logo, theme colors, and
// light/dark mode — with a live phone preview. Gated by the `appCustomization`
// permission.
export default function AppCustomizationPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [error, setError] = useState<string | null>(null);

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("appCustomization", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>App Customization</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>App Customization</h1>
        <p className="subtitle">
          Brand the mobile app — title, logo, theme colors, and light/dark mode.
          Changes apply the next time the app launches.
        </p>
      </div>
      {error && <p className="error">{error}</p>}
      <AppCustomizationBuilder
        canEdit={can("appCustomization", "edit")}
        onError={setError}
      />
    </div>
  );
}
