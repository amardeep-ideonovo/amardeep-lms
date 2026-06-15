"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AdminSection } from "@lms/types";
import { clearToken, getToken } from "@/lib/api";
import { useAdminAuth } from "./AdminAuthProvider";
import ThemeToggle from "./ThemeToggle";

type NavItem = {
  href: string;
  label: string;
  section?: AdminSection;
  icon: ReactNode;
  badge?: string;
};
type NavGroup = { label: string; items: NavItem[] };

// Inline stroke icons (no icon-font dependency). 19px, currentColor.
const I = {
  dashboard: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M3 11l9-8 9 8M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  members: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  classes: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  courses: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  gallery: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="8.5" r="1.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="m21 15-5-5L5 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  blog: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M4 4h16v16H4zM4 9h16M9 9v11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pages: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M14 2v6h6M8 13h8M8 17h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  popups: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  forms: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  contacts: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM1 8h2M1 12h2M1 16h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="11" cy="10.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 16.2a3.6 3.6 0 0 1 7 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  email: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="m3.5 7 8.5 6 8.5-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  campaigns: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="m3 11 15-7v16L3 13v-2ZM3 11v2M7 12.5V18a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  automations: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M13 2 4.5 12.5h6L11 22l8.5-10.5h-6L13 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  menus: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  header: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 9.5h18" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6.4" cy="7.25" r="0.95" fill="currentColor" />
      <path d="M14.5 7.25H18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  footer: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 14.5h18" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.5 17.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  appCustomization: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  subscriptions: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ),
  coupons: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M20 12V8H4v4M20 12v8H4v-8M20 12H4M12 7v13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  reports: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="7" y="11" width="3" height="6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="13" y="7" width="3" height="10" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  notifications: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  certificates: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 14.5 8 22l4-2.5L16 22l-1-7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 4.6h.09A1.65 1.65 0 0 0 11.27 3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9.27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  admins: (
    <svg className="ico" width="19" height="19" viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="m17 11 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// `section` gates each item by `read` permission. Notifications has none —
// it's the admin's own feed, always visible.
const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: I.dashboard },
      { href: "/classes", label: "Classes", section: "classes", icon: I.classes },
      { href: "/courses", label: "Courses", section: "courses", icon: I.courses },
      { href: "/certificates", label: "Certificates", section: "certificates", icon: I.certificates },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/blog", label: "Blog", section: "blog", icon: I.blog },
      { href: "/gallery", label: "Gallery", section: "gallery", icon: I.gallery },
      { href: "/pages", label: "Pages", section: "pages", icon: I.pages },
      { href: "/header", label: "Header", section: "menus", icon: I.header },
      { href: "/footer", label: "Footer", section: "menus", icon: I.footer },
      { href: "/navigation", label: "Navigation", section: "menus", icon: I.menus },
      { href: "/popups", label: "Popups", section: "popups", icon: I.popups },
      { href: "/forms", label: "Forms", section: "forms", icon: I.forms },
      { href: "/contacts", label: "Contacts", section: "contacts", icon: I.contacts },
      { href: "/email/templates", label: "Email templates", section: "email", icon: I.email },
      { href: "/email/campaigns", label: "Campaigns", section: "email", icon: I.campaigns },
      { href: "/email/automations", label: "Automations", section: "email", icon: I.automations },
    ],
  },
  {
    label: "Commerce",
    items: [
      { href: "/members", label: "Members", section: "members", icon: I.members },
      { href: "/subscriptions", label: "Subscriptions", section: "subscriptions", icon: I.subscriptions },
      { href: "/coupons", label: "Coupons", section: "coupons", icon: I.coupons },
      { href: "/reports", label: "Reports", section: "reports", icon: I.reports },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: I.notifications },
      { href: "/settings", label: "Settings", section: "settings", icon: I.settings },
      { href: "/app-customization", label: "App Customization", section: "appCustomization", icon: I.appCustomization },
    ],
  },
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
  // Hide when unauthenticated — but only after mount (token lives in localStorage,
  // unknown to SSR), keeping server and first client render identical.
  if (mounted && !getToken()) return null;

  const logout = () => {
    clearToken();
    router.replace("/login");
  };

  const renderItem = (item: NavItem) => {
    // "/" must match exactly; everything else matches by prefix.
    const active =
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={active ? "nav-link nav-link--active" : "nav-link"}
      >
        {item.icon}
        <span>{item.label}</span>
        {item.badge && <span className="nav-badge">{item.badge}</span>}
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand sidebar-brand--row">
        <span className="brand-mark" aria-hidden="true">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M12 3 3 8l9 5 9-5-9-5Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M3 16l9 5 9-5M3 12l9 5 9-5" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="brand-name">LMS Admin</span>
      </div>

      {GROUPS.map((group) => {
        // Only show sections the admin can read.
        const items = group.items.filter(
          (item) => !item.section || can(item.section, "read"),
        );
        // Append super-admin-only "Admins" to the System group.
        const withAdmins =
          group.label === "System" && isSuperAdmin
            ? [...items, { href: "/admins", label: "Admins", icon: I.admins } as NavItem]
            : items;
        if (withAdmins.length === 0) return null;
        return (
          <nav className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {withAdmins.map(renderItem)}
          </nav>
        );
      })}

      <ThemeToggle />

      <button className="btn btn--ghost sidebar-logout" onClick={logout}>
        Log out
      </button>
    </aside>
  );
}
