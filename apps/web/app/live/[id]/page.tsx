"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { LiveJoinCredentialsDTO, LiveSessionBarDTO } from "@lms/types";
import { ApiError, api, clearToken } from "@/lib/api";
import AuthGate from "@/components/AuthGate";

const pad = (n: number) => String(n).padStart(2, "0");
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${pad(m)}m ${pad(sec)}s`;
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function providerName(p: LiveSessionBarDTO["provider"]): string {
  return p === "ZOOM" ? "Zoom" : "Google Meet";
}

type Screen = "loading" | "locked" | "notfound" | "canceled" | "error" | "ok";

function LiveInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [session, setSession] = useState<LiveSessionBarDTO | null>(null);
  const [creds, setCreds] = useState<LiveJoinCredentialsDTO | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const offsetRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const loadShell = useCallback(async () => {
    try {
      const s = await api.liveSession(id);
      offsetRef.current = Date.parse(s.serverNow) - Date.now();
      setSession(s);
      setScreen("ok");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        if (err.status === 403) return setScreen("locked");
        if (err.status === 410) return setScreen("canceled");
        if (err.status === 404) return setScreen("notfound");
      }
      setErrorMsg(err instanceof Error ? err.message : "Failed to load session.");
      setScreen("error");
    }
  }, [id, router]);

  useEffect(() => {
    loadShell();
  }, [loadShell]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  const startsMs = session ? Date.parse(session.startsAt) : 0;
  const joinsMs = session ? Date.parse(session.joinsAt) : 0;
  const endsMs = session ? Date.parse(session.endsAt) : 0;
  const ended = !!session && now >= endsMs;
  const canJoin = !!session && now >= joinsMs && now < endsMs;

  // Fetch credentials only once we're inside the join window (never before).
  useEffect(() => {
    if (screen !== "ok" || !canJoin || creds) return;
    let alive = true;
    api
      .liveCredentials(id)
      .then((c) => {
        if (alive) setCreds(c);
      })
      .catch(() => {
        /* outside-window race / transient — the shell UI still shows the state */
      });
    return () => {
      alive = false;
    };
  }, [screen, canJoin, creds, id]);

  if (screen === "loading") {
    return (
      <div className="centered-state">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (screen === "locked") {
    return (
      <StatusCard
        title="You don’t have access"
        body="This live session is for members of a class you’re not enrolled in."
      />
    );
  }
  if (screen === "notfound") {
    return <StatusCard title="Session not found" body="This live session doesn’t exist." />;
  }
  if (screen === "canceled") {
    return (
      <StatusCard
        title="This live session was canceled"
        body="The host canceled this session. Check your dashboard for other sessions."
      />
    );
  }
  if (screen === "error") {
    return <StatusCard title="Something went wrong" body={errorMsg} />;
  }
  if (!session) return null;

  return (
    <div className="live-join">
      <Link href="/dashboard" className="back-link">
        ← Back to dashboard
      </Link>
      <p className="live-eyebrow">
        {providerName(session.provider)} live session
      </p>
      <h1 className="live-title">{session.title}</h1>
      <p className="live-meta">{session.audienceLabel}</p>
      {session.description && <p className="live-desc">{session.description}</p>}

      {ended ? (
        <div className="live-panel">
          <p className="live-status">This session has ended.</p>
        </div>
      ) : !canJoin ? (
        <div className="live-panel">
          <p className="live-eyebrow">Starts in</p>
          <div className="live-countdown" aria-hidden="true">
            {countdown(startsMs - now)}
          </div>
          <p className="live-hint">
            The join button unlocks when the session opens
            {joinsMs > startsMs ? "." : " a few minutes before it starts."}
          </p>
          <button className="live-btn" type="button" disabled>
            Join {providerName(session.provider)}
          </button>
        </div>
      ) : !creds ? (
        <div className="live-panel">
          <div className="spinner" aria-label="Preparing your join link" />
        </div>
      ) : (
        <div className="live-panel">
          <p className="live-status live-status--go">
            {now >= startsMs ? "● Live now" : "Ready to join"}
          </p>
          <p className="live-hint">
            You’re joining <strong>{hostOf(creds.joinUrl)}</strong> in a new tab.
          </p>
          <button
            className="live-btn"
            type="button"
            onClick={() =>
              window.open(creds.joinUrl, "_blank", "noopener,noreferrer")
            }
          >
            Join {providerName(session.provider)} meeting
          </button>
          {creds.password && (
            <div className="live-pass">
              <span className="live-pass-label">Passcode</span>
              <code className="live-pass-code">{creds.password}</code>
              <button
                type="button"
                className="live-pass-copy"
                onClick={() => {
                  if (navigator.clipboard && creds.password) {
                    navigator.clipboard
                      .writeText(creds.password)
                      .then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                      .catch(() => {});
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="live-join">
      <Link href="/dashboard" className="back-link">
        ← Back to dashboard
      </Link>
      <div className="live-panel">
        <h1 className="live-title">{title}</h1>
        <p className="live-meta">{body}</p>
      </div>
    </div>
  );
}

export default function LiveSessionPage() {
  return (
    <AuthGate>
      <LiveInner />
    </AuthGate>
  );
}
