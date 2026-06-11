"use client";

// Client overlay that shows the ACTIVE popups matching the current context
// (a member-area surface — dashboard/classes/courses/lessons — or a CMS
// page). The API does the WHERE filtering; this host enforces the WHEN:
//
//   trigger   — IMMEDIATE | DELAY (s) | SCROLL (% of page) | EXIT_INTENT
//   frequency — EVERY_VISIT | ONCE_PER_SESSION | ONCE_PER_DAYS | ONCE,
//               capped client-side via local/session storage (a popup is a
//               marketing surface, not a security boundary)
//   closeOnOverlay / animation — presentation niceties
//
//   <PopupHost context={{ type: "dashboard" }} />
//   <PopupHost context={{ type: "page", pageId }} />
//
// The popup body is a Puck document rendered with the SAME shared blocks as
// pages (so a popup can contain a heading, rich text, a button, even a Form).
import { useEffect, useRef, useState } from "react";
import { Render } from "@puckeditor/core";
import type { Data } from "@puckeditor/core";
import { createPuckConfig } from "@lms/puck";
import type { PageProps, RootProps } from "@lms/puck";
import "@lms/puck/styles.css";
import type {
  PopupContext,
  PopupPosition,
  PopupPublicDTO,
} from "@lms/types";
import FormEmbed from "@/components/FormEmbed";
import PageMenu from "@/components/PageMenu";
import { fetchActivePopups, recordPopupEvent } from "@/lib/api";

const config = createPuckConfig({
  formComponent: FormEmbed,
  menuComponent: PageMenu,
});

const EDGE = 20; // px gap from the viewport edges for non-centered popups

// ---------- frequency capping (storage is best-effort; private-mode safe) ----------
const seenKey = (id: string) => `lms-popup-seen:${id}`;

function isSuppressed(p: PopupPublicDTO): boolean {
  const b = p.behavior;
  if (!b || b.frequency === "EVERY_VISIT") return false;
  try {
    if (b.frequency === "ONCE_PER_SESSION") {
      return sessionStorage.getItem(seenKey(p.id)) != null;
    }
    const at = Number(localStorage.getItem(seenKey(p.id)) || 0);
    if (!at) return false;
    if (b.frequency === "ONCE") return true;
    const days = Math.max(1, b.frequencyDays || 7);
    return Date.now() - at < days * 86400000;
  } catch {
    return false;
  }
}

function markSeen(p: PopupPublicDTO): void {
  const b = p.behavior;
  if (!b || b.frequency === "EVERY_VISIT") return;
  try {
    if (b.frequency === "ONCE_PER_SESSION") {
      sessionStorage.setItem(seenKey(p.id), "1");
    } else {
      localStorage.setItem(seenKey(p.id), String(Date.now()));
    }
  } catch {
    /* storage unavailable — popup just behaves like EVERY_VISIT */
  }
}

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

// Entrance keyframes per configured animation (Web Animations API — no
// stylesheet involvement, and `transform` composes with the position offsets
// because we animate a child wrapper, not the positioned box itself).
function entranceKeyframes(anim: string): Keyframe[] | null {
  switch (anim) {
    case "FADE":
      return [{ opacity: 0 }, { opacity: 1 }];
    case "SLIDE_UP":
      return [
        { opacity: 0, transform: "translateY(28px)" },
        { opacity: 1, transform: "translateY(0)" },
      ];
    case "ZOOM":
      return [
        { opacity: 0, transform: "scale(0.9)" },
        { opacity: 1, transform: "scale(1)" },
      ];
    default:
      return null;
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
  const b = popup.behavior;
  const centered = s.position === "CENTER";
  const innerRef = useRef<HTMLDivElement | null>(null);

  // Count one impression + start the frequency clock when this popup appears.
  useEffect(() => {
    recordPopupEvent(popup.id, "view");
    markSeen(popup);
    const frames = entranceKeyframes(b?.animation ?? "FADE");
    if (frames && innerRef.current?.animate) {
      try {
        innerRef.current.animate(frames, { duration: 360, easing: "ease-out" });
      } catch {
        /* old browser — popup simply appears */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup.id]);

  // Dismiss = close button or (when allowed) backdrop tap.
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
      {/* Centered popups get a dimming backdrop. Click-to-dismiss is the
          admin's call (closeOnOverlay). Corner / edge popups behave like
          toasts — no backdrop, page stays usable. */}
      {centered && (
        <div
          onClick={b?.closeOnOverlay === false ? undefined : handleClose}
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
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
          pointerEvents: "auto",
        }}
      >
        <div
          ref={innerRef}
          style={{
            width: "100%",
            height: s.height && s.height !== "auto" ? s.height : undefined,
            maxHeight: "calc(100vh - 40px)",
            overflow: "auto",
            background: s.background || "#ffffff",
            border: `1px solid ${s.borderColor || "#e2e8f0"}`,
            borderRadius: s.borderRadius,
            padding: s.padding,
            boxShadow: "0 12px 40px rgba(15,23,42,0.25)",
            position: "relative",
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
      </div>
    </>
  );
}

// Arms a popup's trigger and renders the card once it fires.
function TriggerGate({
  popup,
  onClose,
}: {
  popup: PopupPublicDTO;
  onClose: () => void;
}) {
  const b = popup.behavior;
  const trigger = b?.trigger ?? "IMMEDIATE";
  const [fired, setFired] = useState(trigger === "IMMEDIATE");

  useEffect(() => {
    if (fired) return;

    if (trigger === "DELAY") {
      const t = setTimeout(
        () => setFired(true),
        Math.max(0, b?.triggerValue ?? 0) * 1000,
      );
      return () => clearTimeout(t);
    }

    if (trigger === "SCROLL") {
      const pct = Math.min(100, Math.max(1, b?.triggerValue || 25));
      const onScroll = () => {
        const doc = document.documentElement;
        const scrollable = doc.scrollHeight - window.innerHeight;
        if (scrollable <= 0) return;
        if ((window.scrollY / scrollable) * 100 >= pct) setFired(true);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll(); // already past the threshold (e.g. anchor navigation)
      return () => window.removeEventListener("scroll", onScroll);
    }

    if (trigger === "EXIT_INTENT") {
      // Desktop: cursor leaves through the viewport top (heading for the tab
      // bar). Touch devices have no exit intent — approximate with a delay.
      const fine = window.matchMedia?.("(pointer: fine)").matches ?? true;
      if (fine) {
        const onLeave = (e: MouseEvent) => {
          if (e.clientY <= 0) setFired(true);
        };
        document.addEventListener("mouseleave", onLeave);
        return () => document.removeEventListener("mouseleave", onLeave);
      }
      const t = setTimeout(() => setFired(true), 15000);
      return () => clearTimeout(t);
    }

    setFired(true); // unknown trigger value from a newer admin — fail open
    return undefined;
  }, [fired, trigger, b?.triggerValue]);

  if (!fired) return null;
  return <PopupCard popup={popup} onClose={onClose} />;
}

export default function PopupHost({ context }: { context: PopupContext }) {
  const [popups, setPopups] = useState<PopupPublicDTO[]>([]);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  // Stable dependency: re-fetch when the targeted surface changes.
  const ctxKey =
    context.type === "page" ? `page:${context.pageId}` : context.type;

  useEffect(() => {
    let alive = true;
    fetchActivePopups(context)
      // Frequency-capped popups are dropped up front so their triggers never arm.
      .then((list) => alive && setPopups(list.filter((p) => !isSuppressed(p))))
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
        <TriggerGate
          key={p.id}
          popup={p}
          onClose={() => setClosed((prev) => new Set(prev).add(p.id))}
        />
      ))}
    </div>
  );
}
