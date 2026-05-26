"use client";

// Client overlay that shows the ACTIVE popups matching the current context
// (the member dashboard, or a CMS page). The API does ALL visibility filtering,
// so this just fetches and renders. Display behaviour: EVERY page load — the
// popup appears on mount; the close button hides it for this view only (no
// persistence), so it reappears on the next visit.
//
//   <PopupHost context={{ type: "dashboard" }} />
//   <PopupHost context={{ type: "page", pageId }} />
//
// The popup body is a Puck document rendered with the SAME shared blocks as
// pages (so a popup can contain a heading, rich text, a button, even a Form).
import { useEffect, useState } from "react";
import { Render } from "@puckeditor/core";
import type { Data } from "@puckeditor/core";
import { createPuckConfig } from "@lms/puck";
import type { PageProps, RootProps } from "@lms/puck";
import "@lms/puck/styles.css";
import type { PopupContext, PopupPosition, PopupPublicDTO } from "@lms/types";
import FormEmbed from "@/components/FormEmbed";
import { fetchActivePopups, recordPopupEvent } from "@/lib/api";

const config = createPuckConfig({ formComponent: FormEmbed });

const EDGE = 20; // px gap from the viewport edges for non-centered popups

// Placement of the popup box for a given on-screen position.
function boxPosition(pos: PopupPosition): React.CSSProperties {
  switch (pos) {
    case "TOP":
      return { top: EDGE, left: "50%", transform: "translateX(-50%)" };
    case "BOTTOM":
      return { bottom: EDGE, left: "50%", transform: "translateX(-50%)" };
    case "TOP_LEFT":
      return { top: EDGE, left: EDGE };
    case "TOP_RIGHT":
      return { top: EDGE, right: EDGE };
    case "BOTTOM_LEFT":
      return { bottom: EDGE, left: EDGE };
    case "BOTTOM_RIGHT":
      return { bottom: EDGE, right: EDGE };
    case "CENTER":
    default:
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
}

function PopupCard({
  popup,
  onClose,
}: {
  popup: PopupPublicDTO;
  onClose: () => void;
}) {
  const s = popup.style;
  const centered = s.position === "CENTER";

  // Count one impression when this popup first appears.
  useEffect(() => {
    recordPopupEvent(popup.id, "view");
  }, [popup.id]);

  // Dismiss = close button or backdrop tap.
  const handleClose = () => {
    recordPopupEvent(popup.id, "dismiss");
    onClose();
  };

  // Engagement: a click on any link/button inside the popup body.
  const handleContentClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) {
      recordPopupEvent(popup.id, "click");
    }
  };

  return (
    <>
      {/* Centered popups get a dimming backdrop (click to dismiss). Corner /
          edge popups behave like toasts — no backdrop, page stays usable. */}
      {centered && (
        <div
          onClick={handleClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            pointerEvents: "auto",
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={popup.name}
        style={{
          position: "fixed",
          ...boxPosition(s.position),
          width: s.width || "480px",
          height: s.height && s.height !== "auto" ? s.height : undefined,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
          overflow: "auto",
          background: s.background || "#ffffff",
          border: `1px solid ${s.borderColor || "#e2e8f0"}`,
          borderRadius: s.borderRadius,
          padding: s.padding,
          boxShadow: "0 12px 40px rgba(15,23,42,0.25)",
          pointerEvents: "auto",
        }}
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: 999,
            border: "none",
            background: "rgba(15,23,42,0.08)",
            color: "#0f172a",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            zIndex: 1,
          }}
        >
          ×
        </button>
        <div onClickCapture={handleContentClick}>
          <Render
            config={config}
            data={popup.data as unknown as Data<PageProps, RootProps>}
          />
        </div>
      </div>
    </>
  );
}

export default function PopupHost({ context }: { context: PopupContext }) {
  const [popups, setPopups] = useState<PopupPublicDTO[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  // Stable dependency: re-fetch when the targeted surface changes.
  const ctxKey =
    context.type === "page" ? `page:${context.pageId}` : "dashboard";

  useEffect(() => {
    let alive = true;
    fetchActivePopups(context)
      .then((list) => alive && setPopups(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  const visible = popups.filter((p) => !closed.has(p.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 4000, pointerEvents: "none" }}>
      {visible.map((p) => (
        <PopupCard
          key={p.id}
          popup={p}
          onClose={() => setClosed((prev) => new Set(prev).add(p.id))}
        />
      ))}
    </div>
  );
}
