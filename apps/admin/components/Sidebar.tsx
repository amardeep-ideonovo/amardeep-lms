"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AdminSection } from "@lms/types";
import { clearToken, getToken } from "@/lib/api";
import { useAdminAuth } from "./AdminAuthProvider";
import NotificationBell from "./NotificationBell";

// `section` gates the item by `read` permission. Notifications has none — it's
// the admin's own feed, always visible.
const NAV: { href: string; label: string; section?: AdminSection }[] = [
  { href: "/classes", label: "Classes", section: "classes" },
  { href: "/coupons", label: "Coupons", section: "coupons" },
  { href: "/members", label: "Members", section: "members" },
  { href: "/subscriptions", label: "Subscriptions", section: "subscriptions" },
  { href: "/notifications", label: "Notifications" },
  { href: "/courses", label: "Courses", section: "courses" },
  { href: "/gallery", label: "Gallery", section: "gallery" },
  { href: "/blog", label: "Blog", section: "blog" },
  { href: "/pages", label: "Pages", section: "pages" },
  { href: "/popups", label: "Popups", section: "popups" },
  { href: "/forms", label: "Forms", section: "forms" },
  { href: "/settings", label: "Settings", section: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { can, isSuperAdmin } = useAdminAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  // Only show sections the admin can read; super admins see everything + Admins.
  const items = NAV.filter((item) => !item.section || can(item.section, "read"));

  return (
    <aside className="sidebar">
      <div className="sidebar-brand sidebar-brand--row">
        <span>LMS Admin</span>
        <NotificationBell />
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "nav-link nav-link--active" : "nav-link"}
            >
              {item.label}
            </Link>
          );
        })}
        {isSuperAdmin && (
          <Link
            href="/admins"
            className={
              pathname.startsWith("/admins")
                ? "nav-link nav-link--active"
                : "nav-link"
            }
          >
            Admins
          </Link>
        )}
      </nav>
      <button className="btn btn--ghost sidebar-logout" onClick={logout}>
        Log out
      </button>
    </aside>
  );
}
