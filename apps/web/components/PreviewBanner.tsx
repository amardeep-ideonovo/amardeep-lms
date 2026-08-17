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
    <div
      role="status"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "8px 16px",
        background: "var(--ink-900)",
        color: "var(--surface)",
        fontSize: 14,
        lineHeight: 1.3,
        textAlign: "center",
      }}
    >
      <span>
        <strong>Preview mode</strong> — viewing the member site as a{" "}
        {mode === "unlocked" ? "member with full access" : "visitor (locked)"}.
        Changes can’t be saved.
      </span>
      <span style={{ display: "inline-flex", gap: 8 }}>
        {canToggle && (
          <button
            type="button"
            onClick={toggle}
            style={previewBtnStyle}
            aria-label={`Switch to the ${
              mode === "unlocked" ? "locked" : "unlocked"
            } view`}
          >
            {mode === "unlocked" ? "Show locked view" : "Show unlocked view"}
          </button>
        )}
        <button type="button" onClick={exit} style={previewBtnStyle}>
          Exit preview
        </button>
      </span>
    </div>
  );
}

const previewBtnStyle: React.CSSProperties = {
  appearance: "none",
  border: "1px solid rgba(255,255,255,0.5)",
  background: "transparent",
  color: "var(--surface)",
  borderRadius: 999,
  padding: "3px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
