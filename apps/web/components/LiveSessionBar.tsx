"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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

// The dashboard live-session bar. Shows only when the entitled member has a live
// or upcoming session; renders nothing otherwise (so it never reveals existence
// to anyone not entitled). The countdown tracks the SERVER clock via an offset
// derived from serverNow, so a skewed client can't false-enable "Join".
export default function LiveSessionBar() {
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
      setSessions([]); // stay silent — the bar never surfaces errors
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

  return (
    <aside className="md-live-bar glass--strong" aria-label="Live sessions">
      <div className="md-live-eyebrow">
        <span className="md-live-dot" aria-hidden="true" /> Live session
      </div>
      <div className="md-live-list">
        {visible.map((s) => {
          const ph = phaseOf(s, now);
          const joinable = ph === "joinable" || ph === "live";
          return (
            <Link key={s.id} href={`/live/${s.id}`} className="md-live-item">
              <div className="md-live-info">
                <div className="md-live-title">{s.title}</div>
                <div className="md-live-meta">{s.audienceLabel}</div>
              </div>
              <div className="md-live-right">
                {ph === "live" ? (
                  <span className="md-live-badge">● Live now</span>
                ) : (
                  <span className="md-live-count">
                    in {countdown(Date.parse(s.startsAt) - now)}
                  </span>
                )}
                <span className={joinable ? "md-live-cta on" : "md-live-cta"}>
                  {joinable ? "Join" : "Details"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
