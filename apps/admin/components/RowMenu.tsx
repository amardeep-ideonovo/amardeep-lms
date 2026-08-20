"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@lms/ui";

export type RowMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

// Fixed-position coordinates for the portalled popup. We right-align the menu to
// its trigger (matching the old right:0 anchoring) and flip it above the trigger
// when there isn't room below (last rows near the viewport bottom).
type Pos = { top: number | "auto"; bottom: number | "auto"; right: number };

// A compact "⋯" overflow menu for table rows: keeps secondary/destructive
// actions out of always-on view (so a stray click can't fire Delete) while
// staying keyboard- and click-outside-dismissible.
//
// The popup is rendered through a portal to <body> and positioned with
// position:fixed from the trigger's bounding rect. This is deliberate: the menu
// lives inside `.table-wrap`, whose `overflow-x: auto` forces `overflow-y` to
// compute to `auto` as well (CSS spec), turning the wrapper into a two-axis clip
// box that would otherwise crop the dropdown. Portalling escapes every overflow
// ancestor so the menu is never clipped, on any row.
export default function RowMenu({
  items,
  label = "Row actions",
}: {
  items: RowMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const estHeight = items.length * 38 + 16; // ~item height + padding
    const openUp =
      r.bottom + estHeight > window.innerHeight && r.top > estHeight;
    setPos({
      top: openUp ? "auto" : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : "auto",
      // Distance from the viewport's right edge to the trigger's right edge —
      // right-aligns the menu under the trigger without needing its width.
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, [items.length]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    recompute();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => recompute();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Capture phase so scrolls inside the table-wrap (which don't bubble to
    // window) still keep the fixed-position menu glued to its trigger.
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, recompute]);

  return (
    <div className="row-menu" ref={triggerRef}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="row-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </Button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="row-menu-pop"
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              right: pos.right,
              left: "auto",
            }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={
                  it.danger
                    ? "row-menu-item row-menu-item--danger"
                    : "row-menu-item"
                }
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
