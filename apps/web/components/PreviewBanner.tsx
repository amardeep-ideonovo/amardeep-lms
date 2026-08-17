"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  clearToken,
  getCachedMe,
  getPreviewPair,
  getToken,
  setActivePreview,
  setCachedMe,
} from "@/lib/api";
import { qk } from "@/lib/queries";

// Shown only during an admin "preview the member site" session (the synthetic
// preview member — never a real member). Marks the session, lets the admin flip
// between the paywalled (locked) and paid (unlocked) views of the SAME page, and
// exits cleanly. It's a convenience marker, NOT an access control — the backend
// owns what the preview session may see and forbids all writes.
export default function PreviewBanner() {
  const router = useRouter();
  // Only observe /auth/me when a session token exists, so logged-out visitors
  // never fire an extra (and 401-ing) request. Shares the qk.me cache with the
  // rest of the app, seeded from the paint-fast me-cache.
  const [hasToken] = useState(() => !!getToken());
  const { data: me } = useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      const u = await api.me();
      setCachedMe(u);
      return u;
    },
    enabled: hasToken,
    initialData: () => getCachedMe() ?? undefined,
  });

  if (!me?.isPreview) return null;

  const mode = me.previewMode ?? "unlocked";
  const canToggle = !!getPreviewPair();

  function toggle() {
    const next = mode === "unlocked" ? "locked" : "unlocked";
    if (setActivePreview(next)) window.location.reload();
  }

  function exit() {
    clearToken();
    // The tab was script-opened by the admin dashboard, so close is allowed;
    // fall back to the public home if the browser blocks it.
    try {
      window.close();
    } catch {
      /* ignore */
    }
    router.replace("/");
  }

  return (
    <div role="status" className="preview-banner">
      <span>
        <strong>Preview mode</strong> — viewing the member site as a{" "}
        {mode === "unlocked" ? "member with full access" : "visitor (locked)"}.
        Changes can’t be saved.
      </span>
      <span className="preview-banner-actions">
        {canToggle && (
          <button
            type="button"
            className="preview-banner-btn"
            onClick={toggle}
            aria-label={`Switch to the ${
              mode === "unlocked" ? "locked" : "unlocked"
            } view`}
          >
            {mode === "unlocked" ? "Show locked view" : "Show unlocked view"}
          </button>
        )}
        <button type="button" className="preview-banner-btn" onClick={exit}>
          Exit preview
        </button>
      </span>
    </div>
  );
}
