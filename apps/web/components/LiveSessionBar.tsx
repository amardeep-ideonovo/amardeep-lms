"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LiveSessionBarDTO } from "@lms/types";
import { api } from "@/lib/api";

const pad = (n: number) => String(n).padStart(2, "0");
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// "TUE 7:00 PM" from the session start (viewer-local time).
function eyebrowTime(iso: string): string {
  const d = new Date(iso);
  const day = d
    .toLocaleDateString(undefined, { weekday: "short" })
    .toUpperCase();
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} ${time}`;
}

type Phase = "upcoming" | "joinable" | "live" | "ended";
function phaseOf(s: LiveSessionBarDTO, now: number): Phase {
  const starts = Date.parse(s.startsAt);
  const joins = Date.parse(s.joinsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= ends) return "ended";
  if (now >= starts) return "live";
  if (now >= joins) return "joinable";
  return "upcoming";
}

// The dashboard live-session card — Ink Hero: an ink #272144 card with the red
// LIVE eyebrow, session title, audience line and a teal Register/Join CTA.
// Shows only when the entitled member has a live or upcoming session; renders
// nothing otherwise (never reveals existence to anyone not entitled). The
// countdown tracks the SERVER clock via an offset derived from serverNow, so a
// skewed client can't false-enable "Join".
export default function LiveSessionBar() {
  const router = useRouter();
  const [sessions, setSessions] = useState<LiveSessionBarDTO[] | null>(null);
  const offsetRef = useRef(0); // serverNow - clientNow (ms)
  const [now, setNow] = useState(() => Date.now());
  const phasesRef = useRef<string>("");

  const load = useCallback(async () => {
    try {
      const list = await api.liveCurrent();
      if (list.length > 0) {
        offsetRef.current = Date.parse(list[0].serverNow) - Date.now();
      }
      setSessions(list);
    } catch {
      setSessions([]); // stay silent — the card never surfaces errors
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const poll = setInterval(load, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  // Refetch exactly when a session crosses a phase boundary — catches a cancel /
  // reschedule the pure clock derivation would otherwise miss.
  useEffect(() => {
    if (!sessions) return;
    const sig = sessions.map((s) => `${s.id}:${phaseOf(s, now)}`).join("|");
    if (phasesRef.current && phasesRef.current !== sig) load();
    phasesRef.current = sig;
  }, [now, sessions, load]);

  if (!sessions) return null;
  const visible = sessions.filter((s) => phaseOf(s, now) !== "ended");
  if (visible.length === 0) return null;

  const [first, ...rest] = visible;
  const ph = phaseOf(first, now);
  const joinable = ph === "joinable" || ph === "live";

  return (
    <aside className="ik-live-card" aria-label="Live sessions">
      <div className="ik-live-eyebrow">
        <span className="ik-live-dot" aria-hidden="true" />
        <span>
          {ph === "live" ? "Live now" : `Live · ${eyebrowTime(first.startsAt)}`}
        </span>
      </div>
      <div className="ik-live-title">{first.title}</div>
      <div className="ik-live-meta">
        {first.audienceLabel}
        {!joinable && <> · starts in {countdown(Date.parse(first.startsAt) - now)}</>}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        className="ik-cta ik-cta--block"
        onClick={() => router.push(`/live/${first.id}`)}
      >
        {joinable ? "Join now" : "Register"}
      </button>
      {rest.length > 0 && (
        <div className="ik-live-more">
          {rest.map((s) => {
            const p = phaseOf(s, now);
            return (
              <Link key={s.id} href={`/live/${s.id}`}>
                <span>{s.title}</span>
                <span>
                  {p === "live" || p === "joinable"
                    ? "Join"
                    : eyebrowTime(s.startsAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
