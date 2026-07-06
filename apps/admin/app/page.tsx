"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import type {
  AdminLiveSessionDTO,
  AdminNotificationDTO,
  CourseCard,
  LevelDTO,
  MemberRow,
} from "@lms/types";

// NOTE (Ink Hero): the frame's "Weekly revenue" bar chart is intentionally
// omitted — the API has no revenue-over-time endpoint (only on-demand .xlsx
// exports under GET /admin/reports/*). Recent members takes the wide slot.

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// "Jul 4" (adds the year once it's not this year).
function shortDate(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString(undefined, opts);
}

// "AD" from a name, else from the email.
function initialsOf(name: string, email: string): string {
  const src = name.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function memberStatus(m: MemberRow): { label: string; cls: string } {
  if (!m.subscription) return { label: "Active", cls: "badge badge--ok" };
  if (m.subscription.active) {
    return m.subscription.status === "PAST_DUE"
      ? { label: "Past due", cls: "badge badge--warn" }
      : { label: "Active", cls: "badge badge--ok" };
  }
  switch (m.subscription.status) {
    case "PAST_DUE":
      return { label: "Past due", cls: "badge badge--warn" };
    case "PAUSED":
      return { label: "Paused", cls: "badge badge--warn" };
    case "CANCELED":
      return { label: "Canceled", cls: "badge badge--neutral" };
    case "EXPIRED":
      return { label: "Expired", cls: "badge badge--neutral" };
    default:
      return { label: "Inactive", cls: "badge badge--neutral" };
  }
}

// Countdown tag for the next-session ink card, from the real session datetime.
function liveTag(s: AdminLiveSessionDTO): string {
  const now = Date.now();
  const starts = Date.parse(s.startsAt);
  const ends = Date.parse(s.endsAt);
  if (now >= starts && now < ends) return "Live now";
  const days = Math.ceil((starts - now) / 86_400_000);
  if (days <= 0) return "Live today";
  if (days === 1) return "Live in 1 day";
  return `Live in ${days} days`;
}

function sessionWhen(s: AdminLiveSessionDTO): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: s.timezone ?? undefined,
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(s.startsAt));
  } catch {
    return new Date(s.startsAt).toLocaleString();
  }
}

export default function DashboardPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [sessions, setSessions] = useState<AdminLiveSessionDTO[]>([]);
  const [activity, setActivity] = useState<AdminNotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    (async () => {
      // Fetch only what this admin may read; tolerate per-call failures.
      const [m, l, c, s, n] = await Promise.allSettled([
        can("members", "read") ? api.listMembers() : Promise.resolve([]),
        can("classes", "read") ? api.listLevels() : Promise.resolve([]),
        can("courses", "read") ? api.listCourses() : Promise.resolve([]),
        can("liveSessions", "read")
          ? api.listLiveSessions()
          : Promise.resolve([]),
        api.listNotifications({ pageSize: 6 }),
      ]);
      if (!alive) return;
      if (m.status === "fulfilled") setMembers(m.value);
      if (l.status === "fulfilled") setLevels(l.value);
      if (c.status === "fulfilled") setCourses(c.value);
      if (s.status === "fulfilled") setSessions(s.value);
      if (n.status === "fulfilled") setActivity(n.value.items);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [authLoading, can]);

  const totalMembers = members.length;
  const activeSubs = members.filter((m) => m.subscription?.active).length;
  const pastDue = members.filter(
    (m) => m.subscription?.status === "PAST_DUE",
  ).length;
  const newThisWeek = members.filter(
    (m) => Date.now() - new Date(m.registeredAt).getTime() < 7 * 86_400_000,
  ).length;
  const paidPlans = levels.filter((l) => l.type === "PAID").length;

  // Next upcoming (or currently running) published live session — real data.
  const nextSession = sessions
    .filter(
      (s) => s.status === "SCHEDULED" && Date.parse(s.endsAt) > Date.now(),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  // Newest five members for the "Recent members" card.
  const recent = [...members]
    .sort(
      (a, b) =>
        new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime(),
    )
    .slice(0, 5);

  // Getting-started checklist, completion derived from live data.
  const tasks = [
    {
      title: "Add your first member",
      desc: "Members appear here as they register",
      href: "/members",
      done: totalMembers > 0,
    },
    {
      title: "Create a class",
      desc: "Membership levels members can hold",
      href: "/classes",
      done: levels.length > 0,
    },
    {
      title: "Publish a course",
      desc: "Build lessons & release to members",
      href: "/courses",
      done: courses.length > 0,
    },
    {
      title: "Set up a paid plan",
      desc: "Add pricing to a class to start billing",
      href: "/classes",
      done: paidPlans > 0,
    },
    {
      title: "Connect Stripe & email",
      desc: "Wire up billing and email in Settings",
      href: "/settings",
      done: false,
    },
  ];
  const completed = tasks.filter((t) => t.done).length;
  const pct = Math.round((completed / tasks.length) * 100);

  // KPI cards — the four stats this admin's API really serves. Delta lines
  // render ONLY when a real number exists (members/week, past-due count).
  const cards: {
    label: string;
    value: number | null; // null = no read permission
    tint: string;
    color: string;
    delta?: { text: string; cls: string } | null;
    icon: ReactNode;
  }[] = [
    {
      label: "Total members",
      value: can("members", "read") ? totalMembers : null,
      tint: "rgba(53,179,162,.13)",
      color: "#2a9d8d",
      delta:
        newThisWeek > 0
          ? { text: `↑ ${newThisWeek} this week`, cls: "up" }
          : null,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: "Active subscriptions",
      value: can("members", "read") ? activeSubs : null,
      tint: "rgba(247,160,30,.14)",
      color: "#b46f0a",
      delta:
        pastDue > 0 ? { text: `${pastDue} past due`, cls: "warn" } : null,
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M2 10h20" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      ),
    },
    {
      label: "Classes",
      value: can("classes", "read") ? levels.length : null,
      tint: "rgba(144,70,200,.13)",
      color: "#7a3bab",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: "Courses",
      value: can("courses", "read") ? courses.length : null,
      tint: "rgba(67,165,101,.13)",
      color: "#2d7a45",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  const showMembersCard = can("members", "read");

  return (
    <div>
      {/* KPI row */}
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <span
              className="stat-ico"
              style={{ background: c.tint, color: c.color }}
            >
              {c.icon}
            </span>
            <span>
              <span className="stat-label">{c.label}</span>
              <span className="stat-value">
                {loading || c.value === null ? "—" : c.value.toLocaleString()}
              </span>
              {!loading && c.value !== null && c.delta ? (
                <span className={`stat-delta ${c.delta.cls}`}>
                  {c.delta.text}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      {/* Recent members + next live session */}
      {(showMembersCard || nextSession) && (
      <div
        className="dash-mid"
        style={
          nextSession && showMembersCard
            ? undefined
            : { gridTemplateColumns: "1fr" }
        }
      >
        {showMembersCard && (
          <div className="panel">
            <div className="mini-head">
              <h2>Recent members</h2>
              <div className="spacer" />
              <Link href="/members" className="mini-link">
                View all
              </Link>
            </div>
            <div className="mini-grid mini-grid--head mini-grid--members">
              <span>Member</span>
              <span>Plan</span>
              <span>Joined</span>
              <span>Status</span>
            </div>
            {loading ? (
              <p className="muted" style={{ padding: "12px 0" }}>
                Loading…
              </p>
            ) : recent.length === 0 ? (
              <p className="muted" style={{ padding: "12px 0" }}>
                No members yet — they appear here as they register.
              </p>
            ) : (
              recent.map((m) => {
                const name =
                  [m.firstName, m.lastName].filter(Boolean).join(" ") ||
                  m.username ||
                  m.email;
                const st = memberStatus(m);
                return (
                  <div
                    className="mini-grid mini-grid--members"
                    key={m.id}
                  >
                    <Link href={`/members/${m.id}`} className="mini-member">
                      <span className="ava" aria-hidden="true">
                        {initialsOf(name, m.email)}
                      </span>
                      <span className="mini-member-main">
                        <span className="mini-member-name">{name}</span>
                        <span className="mini-member-sub">{m.email}</span>
                      </span>
                    </Link>
                    <span className="mini-cell">
                      {m.subscription?.planName ?? "—"}
                    </span>
                    <span className="mini-cell--muted">
                      {shortDate(m.registeredAt)}
                    </span>
                    <span>
                      <span className={st.cls}>{st.label}</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        {nextSession && (
          <div className="live-next">
            <div className="live-next-tag">
              <span className="live-dot" />
              <span>{liveTag(nextSession)}</span>
            </div>
            <div className="live-next-title">{nextSession.title}</div>
            <div className="live-next-meta">
              {nextSession.audienceLabel}
              <br />
              {sessionWhen(nextSession)}
            </div>
            <div className="live-next-spacer" />
            <Link href="/live-sessions" className="btn">
              Manage session
            </Link>
          </div>
        )}
      </div>
      )}

      {/* lower */}
      <div className="dash-lower">
        {/* getting started */}
        <div className="panel">
          <div className="panel-head">
            <div className="ttl">
              <h2>Getting Started</h2>
            </div>
            <span className="panel-progress-txt">
              {completed} of {tasks.length} completed
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          {tasks.map((t) => (
            <div className={t.done ? "task done" : "task"} key={t.title}>
              <div className="task-check">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="task-main">
                <div className="task-title">{t.title}</div>
                <div className="task-desc">{t.desc}</div>
              </div>
              {!t.done && (
                <Link href={t.href} className="task-go">
                  Go to
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* recent activity */}
        <div className="panel">
          <div className="panel-head">
            <div className="ttl">
              <div className="panel-ico">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2>Recent Activity</h2>
            </div>
            <Link href="/notifications" className="panel-link">
              View all
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>

          {activity.length === 0 ? (
            <p className="muted" style={{ padding: "12px 0" }}>
              {loading ? "Loading…" : "No recent activity yet."}
            </p>
          ) : (
            activity.map((n) => (
              <div className="feed-item" key={n.id}>
                <div className="feed-ico">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="feed-main">
                  <div className="feed-text">
                    <span className="who">{n.title}</span>
                    {n.body ? <> — {n.body}</> : null}
                  </div>
                  <div className="feed-time">{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
