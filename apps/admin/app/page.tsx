"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import type {
  AdminNotificationDTO,
  CourseCard,
  LevelDTO,
  MemberRow,
} from "@lms/types";

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

// "jane.doe@x.com" -> "Jane"
function firstNameFromEmail(email?: string): string {
  if (!email) return "there";
  const local = email.split("@")[0].split(/[._-]/)[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export default function DashboardPage() {
  const { me, can, loading: authLoading } = useAdminAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [activity, setActivity] = useState<AdminNotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    (async () => {
      // Fetch only what this admin may read; tolerate per-call failures.
      const [m, l, c, n] = await Promise.allSettled([
        can("members", "read") ? api.listMembers() : Promise.resolve([]),
        can("classes", "read") ? api.listLevels() : Promise.resolve([]),
        can("courses", "read") ? api.listCourses() : Promise.resolve([]),
        api.listNotifications({ pageSize: 6 }),
      ]);
      if (!alive) return;
      if (m.status === "fulfilled") setMembers(m.value);
      if (l.status === "fulfilled") setLevels(l.value);
      if (c.status === "fulfilled") setCourses(c.value);
      if (n.status === "fulfilled") setActivity(n.value.items);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [authLoading, can]);

  const totalMembers = members.length;
  const activeSubs = members.filter((m) => m.subscription?.active).length;
  const paidPlans = levels.filter((l) => l.type === "PAID").length;

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

  const cards: {
    label: string;
    value: number;
    tint: string;
    color: string;
    icon: ReactNode;
  }[] = [
    {
      label: "Total Members",
      value: totalMembers,
      tint: "rgba(124,92,252,.14)",
      color: "#9577fb",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      label: "Active Subscriptions",
      value: activeSubs,
      tint: "rgba(52,211,153,.13)",
      color: "#4ade9f",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M2 10h20" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ),
    },
    {
      label: "Classes",
      value: levels.length,
      tint: "rgba(167,139,250,.14)",
      color: "#a78bfa",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      label: "Courses",
      value: courses.length,
      tint: "rgba(245,177,61,.14)",
      color: "#f5b13d",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  return (
    <div>
      {/* hero */}
      <div className="hero">
        <div className="dash-hero-avatar">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="live" />
        </div>
        <div className="hero-main">
          <h1>
            Welcome back,{" "}
            {me?.name?.trim()
              ? me.name.trim().split(/\s+/)[0]
              : firstNameFromEmail(me?.email)}
            !
          </h1>
          <div className="hero-sub">
            <span className="ws">LMS Workspace</span>
            <span className="pill pill--env">● Live</span>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent-2)" }}>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <b>{totalMembers}</b>
              <span>members</span>
            </div>
            <div className="hero-stat">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ color: "var(--purple)" }}>
                <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <b>{levels.length}</b>
              <span>classes</span>
            </div>
          </div>
        </div>
        <Link href="/members" className="tour-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Manage members
        </Link>
      </div>

      {/* stat cards */}
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-top">
              <div className="stat-ico" style={{ background: c.tint, color: c.color }}>
                {c.icon}
              </div>
            </div>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{loading ? "—" : c.value}</div>
          </div>
        ))}
      </div>

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
