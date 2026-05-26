"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getToken } from "@/lib/api";

const NAV = [
  { href: "/levels", label: "Levels" },
  { href: "/members", label: "Members" },
  { href: "/courses", label: "Courses" },
  { href: "/blog", label: "Blog" },
  { href: "/pages", label: "Pages" },
  { href: "/popups", label: "Popups" },
  { href: "/forms", label: "Forms" },
  { href: "/settings", label: "Settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  // Hide the chrome on the login screen.
  if (pathname === "/login") return null;
  // Hide the chrome in the full-screen builders (/pages/:id/edit, /popups/:id/edit).
  if (/^\/(pages|popups)\/[^/]+\/edit$/.test(pathname)) return null;
  if (typeof window !== "undefined" && !getToken()) return null;

  const logout = () => {
    clearToken();
    router.replace("/login");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">LMS Admin</div>
      <nav className="sidebar-nav">
        {NAV.map((item) => {
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
      </nav>
      <button className="btn btn--ghost sidebar-logout" onClick={logout}>
        Log out
      </button>
    </aside>
  );
}
