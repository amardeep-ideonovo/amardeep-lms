"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AdminSection } from "@lms/types";
import { clearToken, getToken } from "@/lib/api";
import { useAdminAuth } from "./AdminAuthProvider";
import NotificationBell from "./NotificationBell";

// One row in the admin sidebar. `key` is the stable id stored in each admin's
// saved order (decoupled from `href`, so a link can move without breaking saved
// orders). `section` gates by `read` permission; `superOnly` is super-admin-only
// (Admins). Notifications has neither — it's the admin's own feed, always shown.
type NavItem = {
  key: string;
  href: string;
  label: string;
  section?: AdminSection;
  superOnly?: boolean;
};

const NAV: NavItem[] = [
  { key: "classes", href: "/classes", label: "Classes", section: "classes" },
  { key: "coupons", href: "/coupons", label: "Coupons", section: "coupons" },
  { key: "members", href: "/members", label: "Members", section: "members" },
  {
    key: "subscriptions",
    href: "/subscriptions",
    label: "Subscriptions",
    section: "subscriptions",
  },
  { key: "notifications", href: "/notifications", label: "Notifications" },
  { key: "courses", href: "/courses", label: "Courses", section: "courses" },
  { key: "gallery", href: "/gallery", label: "Gallery", section: "gallery" },
  { key: "blog", href: "/blog", label: "Blog", section: "blog" },
  { key: "pages", href: "/pages", label: "Pages", section: "pages" },
  { key: "popups", href: "/popups", label: "Popups", section: "popups" },
  { key: "forms", href: "/forms", label: "Forms", section: "forms" },
  { key: "settings", href: "/settings", label: "Settings", section: "settings" },
  { key: "admins", href: "/admins", label: "Admins", superOnly: true },
];

// Order `items` by the admin's saved key order. Keys missing from `order` keep
// their default position (appended in NAV order); unknown saved keys are ignored
// — so adding/removing a nav item later never corrupts an existing saved order.
function applyOrder(items: NavItem[], order: string[]): NavItem[] {
  const byKey = new Map(items.map((i) => [i.key, i] as const));
  const out: NavItem[] = [];
  for (const k of order) {
    const it = byKey.get(k);
    if (it) {
      out.push(it);
      byKey.delete(k);
    }
  }
  for (const it of items) if (byKey.has(it.key)) out.push(it);
  return out;
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { can, isSuperAdmin, menuOrder, saveMenuOrder } = useAdminAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // "Customize" (reorder) mode + its working state. `draft` holds the working
  // key order while editing; `dragKey` is the row currently being dragged.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hide the chrome on the login screen.
  if (pathname === "/login") return null;
  // Hide the chrome in the full-screen builders (/pages/:id/edit, /popups/:id/edit).
  if (/^\/(pages|popups)\/[^/]+\/edit$/.test(pathname)) return null;
  // Hide when unauthenticated — but only after mount. The token lives in
  // localStorage (unknown to SSR), so gating on `mounted` keeps the server and
  // first client render identical and avoids a hydration mismatch.
  if (mounted && !getToken()) return null;

  const logout = () => {
    clearToken();
    router.replace("/login");
  };

  // Only show sections this admin can read; super admins also get Admins.
  const visible = NAV.filter((item) => {
    if (item.superOnly) return isSuperAdmin;
    if (item.section) return can(item.section, "read");
    return true; // notifications — always visible
  });
  const displayed = applyOrder(visible, menuOrder);
  // While editing we render the working draft order (reconciled against what's
  // currently visible, so it stays correct even if perms change mid-edit).
  const editItems = applyOrder(visible, draft);

  const startEditing = () => {
    setDraft(displayed.map((i) => i.key));
    setError(null);
    setEditing(true);
  };
  const cancelEditing = () => {
    setEditing(false);
    setDragKey(null);
    setError(null);
  };

  // ↑/↓ reorder — keeps the feature usable on touch + keyboard (native HTML5
  // drag-and-drop doesn't fire on touch and isn't keyboard-accessible).
  const move = (key: string, dir: -1 | 1) => {
    setDraft((d) => {
      const order = d.length ? d : displayed.map((i) => i.key);
      const i = order.indexOf(key);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= order.length) return order;
      const next = order.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  // Live drag reorder: as the dragged row hovers another, slot it into that
  // position. Guarded so we only re-render when the order actually changes.
  const onDragOver = (overKey: string) => {
    if (!dragKey || dragKey === overKey) return;
    setDraft((d) => {
      const next = d.filter((k) => k !== dragKey);
      const idx = next.indexOf(overKey);
      if (idx === -1) return d;
      next.splice(idx, 0, dragKey);
      return next.join("|") === d.join("|") ? d : next;
    });
  };

  const onDone = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveMenuOrder(editItems.map((i) => i.key));
      setEditing(false);
      setDragKey(null);
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onReset = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveMenuOrder([]); // clear → fall back to the default order
      setEditing(false);
      setDragKey(null);
    } catch {
      setError("Couldn't reset. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand sidebar-brand--row">
        <span>LMS Admin</span>
        <NotificationBell />
      </div>

      {editing ? (
        <>
          <p className="sidebar-edit-hint">Drag, or use ↑ ↓, to reorder.</p>
          <nav className="sidebar-nav sidebar-nav--editing">
            {editItems.map((item, idx) => (
              <div
                key={item.key}
                className={
                  dragKey === item.key
                    ? "nav-edit-row nav-edit-row--dragging"
                    : "nav-edit-row"
                }
                draggable
                onDragStart={() => setDragKey(item.key)}
                onDragOver={(e) => {
                  e.preventDefault();
                  onDragOver(item.key);
                }}
                onDragEnd={() => setDragKey(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragKey(null);
                }}
              >
                <span className="nav-drag-handle" aria-hidden>
                  ⠿
                </span>
                <span className="nav-edit-label">{item.label}</span>
                <span className="nav-reorder-btns">
                  <button
                    type="button"
                    className="nav-reorder-btn"
                    aria-label={`Move ${item.label} up`}
                    disabled={idx === 0 || saving}
                    onClick={() => move(item.key, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="nav-reorder-btn"
                    aria-label={`Move ${item.label} down`}
                    disabled={idx === editItems.length - 1 || saving}
                    onClick={() => move(item.key, 1)}
                  >
                    ↓
                  </button>
                </span>
              </div>
            ))}
          </nav>

          {error && <p className="sidebar-error">{error}</p>}

          <div className="sidebar-edit-actions">
            <button className="btn" onClick={onDone} disabled={saving}>
              {saving ? "Saving…" : "Done"}
            </button>
            <button
              className="btn btn--ghost"
              onClick={cancelEditing}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
          <button
            type="button"
            className="sidebar-reset"
            onClick={onReset}
            disabled={saving}
          >
            Reset to default
          </button>
        </>
      ) : (
        <>
          <nav className="sidebar-nav">
            {displayed.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={active ? "nav-link nav-link--active" : "nav-link"}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {displayed.length > 1 && (
            <button
              type="button"
              className="btn btn--ghost sidebar-customize"
              onClick={startEditing}
            >
              Customize menu
            </button>
          )}
        </>
      )}

      <button className="btn btn--ghost sidebar-logout" onClick={logout}>
        Log out
      </button>
    </aside>
  );
}
