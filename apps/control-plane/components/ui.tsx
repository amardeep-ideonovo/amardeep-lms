"use client";

// Small shared presentational + overlay components for the control plane.

import { ReactNode, useEffect, useRef, useState } from "react";

// ---------- avatar ----------

// Initials tile. Replaces the picsum.photos avatars the console used to pull:
// those served photographs of real, identifiable people as stand-ins for our
// operators and clients, and broke entirely offline or behind a firewall.
// Rendered locally, so it works in both.

/** "Jane Doe" -> "JD"; also handles emails and handles. */
export function initials(name: string): string {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Deterministic tint per person, so a face-less feed is still scannable.
const AVATAR_TONES = ["amber", "violet", "green", "blue", "sea"] as const;

export function Avatar({
  name,
  seed,
  size = 28,
}: {
  name: string;
  /** Stable key for the color; defaults to the name. */
  seed?: string;
  size?: number;
}) {
  const key = seed ?? name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  // Sized inline rather than by a composed class, so it can't depend on which
  // avatar rule happens to come later in globals.css.
  return (
    <span
      className={`avatar-initials avatar-${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

// ---------- status pill ----------

export type PillTone = "success" | "warning" | "danger" | "info" | "neutral" | "teal-dark";

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

// ---------- progress bar ----------

export function Bar({
  pct,
  color,
  height = 8,
}: {
  pct: number;
  color?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="bar" style={{ height }}>
      <span
        className="bar-fill"
        style={{ width: `${clamped}%`, height, background: color }}
      />
    </span>
  );
}

// ---------- health dot + label ----------

export function HealthLabel({ tone, label }: { tone: "ok" | "warn" | "danger" | "none"; label: string }) {
  return (
    <span className={`health health-${tone}`}>
      <span className="health-dot" />
      {label}
    </span>
  );
}

// ---------- skeleton ----------

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skl" style={{ height }} />;
}

export function PageSkeleton() {
  return (
    <div className="page-in" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
        <Skeleton height={92} />
        <Skeleton height={92} />
        <Skeleton height={92} />
        <Skeleton height={92} />
      </div>
      <Skeleton height={280} />
      <Skeleton height={180} />
    </div>
  );
}

// ---------- modal ----------

export function Modal({
  title,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  tone = "neutral",
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "neutral" | "danger";
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} width={420}>
      <div className="modal-body">{body}</div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${tone === "danger" ? "btn-danger" : "btn-ink"}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            onClose();
          }}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------- kebab / popover menu ----------

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}

export function Kebab({ items, align = "right" }: { items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="kebab-wrap" ref={ref}>
      <button
        type="button"
        className="kebab-btn"
        aria-label="Row actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className={`pop-menu pop-${align}`} role="menu">
          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                className={`pop-item${item.danger ? " danger" : ""}`}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`pop-item${item.danger ? " danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </span>
  );
}

// ---------- form field ----------

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
