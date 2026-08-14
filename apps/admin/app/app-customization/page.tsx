"use client";

import { useState } from "react";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import AppCustomizationBuilder from "./AppCustomizationBuilder";
import { STR } from "@lms/types";

// Standalone "App Customization" page (System group). A single global config
// that drives the native mobile app's branding — title, logo, theme colors, and
// light/dark mode — with a live phone preview. Gated by the `appCustomization`
// permission.
export default function AppCustomizationPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [error, setError] = useState<string | null>(null);

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("appCustomization", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>App Customization</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>App Customization</h1>
        <p className="subtitle">
          Brand the mobile app — title, logo, theme colors, and light/dark mode.
          Changes go live in members’ apps within about 30 seconds — no app
          update needed.
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
