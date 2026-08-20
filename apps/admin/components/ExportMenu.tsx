"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@lms/ui";
import { DownloadIcon, SpinnerIcon } from "@/components/ExportIcons";

export type ExportMenuOption = {
  label: string;
  hint?: string;
  onSelect: () => void | Promise<void>;
};

// Download control with a small dropdown so the admin can choose WHAT to export
// — the current filtered view or the whole table — right at download time,
// instead of the download silently dumping everything (or silently honoring
// filters with no visible choice). Used on the Members + Subscriptions pages.
export default function ExportMenu({
  options,
  busy = false,
  disabled = false,
  label = "Download",
  size = "md",
}: {
  options: ExportMenuOption[];
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  // "md" (default) matches a full-size sibling button (e.g. Refresh); "sm" fits
  // a compact filter row.
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <Button
        type="button"
        variant="secondary"
        size={size}
        iconOnly
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={busy ? "Exporting…" : label}
        title={busy ? "Exporting…" : label}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? <SpinnerIcon /> : <DownloadIcon />}
      </Button>
      {open && (
        <div className="row-menu-pop export-menu-pop" role="menu">
          {options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="menuitem"
              className="row-menu-item export-menu-item"
              onClick={() => {
                setOpen(false);
                void opt.onSelect();
              }}
            >
              <span className="export-menu-item__label">{opt.label}</span>
              {opt.hint && (
                <span className="export-menu-item__hint">{opt.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
