"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveZoomEmbedDTO } from "@lms/types";

// Renders a Zoom meeting INSIDE the page via the Zoom Meeting SDK "Component
// View" — no redirect, no new tab. The SDK is imported dynamically (client-only;
// it touches window at load) and joins with the server-minted signature. The
// member can adjust the passcode before joining. On unmount we leave the meeting.
type Phase = "idle" | "joining" | "joined" | "error";

// The embedded client is imperative and loosely typed; keep a minimal surface.
type EmbeddedClient = {
  init: (opts: Record<string, unknown>) => Promise<void>;
  join: (opts: Record<string, unknown>) => Promise<void>;
  leaveMeeting?: () => Promise<void>;
  leave?: () => Promise<void>;
};

export default function ZoomEmbed({
  embed,
  onUnavailable,
}: {
  embed: LiveZoomEmbedDTO;
  // Called when the in-page join fails (e.g. a present-but-wrong SDK
  // key/secret mints a bad signature) so the parent can reveal the raw
  // join-link fallback instead of stranding the member in the embed.
  onUnavailable?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<EmbeddedClient | null>(null);
  const [passcode, setPasscode] = useState(embed.password ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");

  // Leave the meeting if the member navigates away mid-call.
  useEffect(() => {
    return () => {
      const c = clientRef.current;
      if (c) {
        (c.leaveMeeting?.() ?? c.leave?.() ?? Promise.resolve()).catch(() => {});
      }
    };
  }, []);

  async function join() {
    if (!rootRef.current) return;
    setPhase("joining");
    setError("");
    try {
      const mod = await import("@zoom/meetingsdk/embedded");
      const ZoomMtgEmbedded = mod.default;
      const client = ZoomMtgEmbedded.createClient() as unknown as EmbeddedClient;
      clientRef.current = client;
      await client.init({
        zoomAppRoot: rootRef.current,
        language: "en-US",
        patchJsMedia: true,
      });
      await client.join({
        sdkKey: embed.sdkKey,
        signature: embed.signature,
        meetingNumber: embed.meetingNumber,
        userName: embed.userName,
        password: passcode || undefined,
      });
      setPhase("joined");
    } catch (e) {
      const err = e as { reason?: string; message?: string } | undefined;
      setError(err?.reason || err?.message || "Couldn't start the meeting.");
      setPhase("error");
    }
  }

  const showForm = phase === "idle" || phase === "error";

  return (
    <div className="live-zoom">
      {showForm && (
        <div className="live-panel">
          <p className="live-status live-status--go">Ready to join</p>
          <div className="live-field">
            <label htmlFor="zoom-pass">
              Passcode {embed.password ? "" : <span className="live-hint">(if the meeting needs one)</span>}
            </label>
            <input
              id="zoom-pass"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Meeting passcode"
              autoComplete="off"
            />
          </div>
          {phase === "error" && <p className="live-error">{error}</p>}
          <button className="live-btn" type="button" onClick={join}>
            {phase === "error" ? "Try again" : "Join meeting here"}
          </button>
          {phase === "error" && onUnavailable && (
            <button
              type="button"
              onClick={onUnavailable}
              className="live-hint"
              style={{
                background: "none",
                border: "none",
                textDecoration: "underline",
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              Having trouble? Join in Zoom directly instead
            </button>
          )}
        </div>
      )}
      {phase === "joining" && (
        <div className="live-panel">
          <div className="spinner" aria-label="Starting the meeting" />
          <p className="live-hint">Connecting you to the meeting…</p>
        </div>
      )}
      <div
        ref={rootRef}
        className="live-zoom-root"
        style={{ display: phase === "joining" || phase === "joined" ? "block" : "none" }}
      />
    </div>
  );
}
