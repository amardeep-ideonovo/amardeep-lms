"use client";

import { useState } from "react";
import { mobileConnectCode } from "@lms/types";
import { buttonClass } from "./button";

// Shared "connect the mobile app" card for the two DOM apps (web + admin) —
// docs/coding-standards.md D5. ONE implementation of the copy-to-clipboard code
// chip, so the admin (handing the code to members) and the member account page
// (setting up their own phone) never drift in wording or behavior.
//
// Self-contained inline styles over shared design tokens (@lms/ui/tokens.css,
// imported by BOTH apps) rather than per-app CSS classes — the same tactic the
// tokens layer uses to stay app-agnostic — so this drops into either globals.css
// without new selectors to keep in sync.

export type MobileConnectCardProps = {
  // The member website origin (admin: webUrl(); web: runtime web origin). The
  // connect code is derived from its subdomain — see mobileConnectCode().
  webUrl: string | null | undefined;
  // "admin" wording addresses the operator (hand this to members); "member"
  // wording addresses the person setting up their own phone.
  audience: "admin" | "member";
  // Optional wrapper class so each app can place/space the card in its own grid.
  className?: string;
};

export function MobileConnectCard({
  webUrl,
  audience,
  className,
}: MobileConnectCardProps) {
  const [copied, setCopied] = useState(false);
  const code = mobileConnectCode(webUrl);
  // Fallback when no code can be derived (custom apex domain / dev origin): the
  // Connect screen also accepts the academy's web address, so show that host.
  let host = "";
  if (!code && webUrl) {
    try {
      host = new URL(webUrl).host;
    } catch {
      host = "";
    }
  }
  const value = code ?? host;
  if (!value) return null; // nothing usable to show — hide rather than mislead

  const copy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  const label = code ? "connect code" : "academy address";
  const lead =
    audience === "admin"
      ? "Members reach this academy on their phone with the Spotlight app."
      : "Use your membership on your phone.";
  const instruction = code
    ? audience === "admin"
      ? "Have them install the Spotlight app and connect with this code:"
      : "Install the Spotlight app, then enter this code to connect:"
    : audience === "admin"
      ? "Have them install the Spotlight app and connect with this address:"
      : "Install the Spotlight app, then enter this address to connect:";

  return (
    <div
      className={className}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm, 10px)",
        background: "var(--surface, #fff)",
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: "none",
          width: 38,
          height: 38,
          borderRadius: 10,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(53, 179, 162, .13)",
          color: "var(--teal-text, #238376)",
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <rect
            x="6"
            y="2"
            width="12"
            height="20"
            rx="2.5"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M10 18h4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </span>

      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "var(--text, #272144)" }}>
          {audience === "admin" ? "Mobile app" : "Get the mobile app"}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--muted, #777394)",
            lineHeight: 1.45,
            marginTop: 2,
          }}
        >
          {lead} {instruction}
        </div>
      </div>

      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <code
          aria-label={label}
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text, #272144)",
            background: "var(--surface-2, #f1eff7)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "7px 12px",
            userSelect: "all",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 260,
          }}
        >
          {value}
        </code>
        <button
          type="button"
          className={buttonClass({ variant: "secondary", size: "sm" })}
          onClick={copy}
          aria-live="polite"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
