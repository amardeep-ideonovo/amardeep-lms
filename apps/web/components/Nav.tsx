"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, getToken } from "@/lib/api";
import { useEffect, useState } from "react";

// Top navigation. Hidden on the login page; logout clears token + redirects.
export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!getToken());
  }, [pathname]);

  if (pathname === "/login") return null;

  const logout = () => {
    clearToken();
    router.replace("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/dashboard" className="nav-brand">
          LMS
        </Link>
        <nav className="nav-links">
          <Link
            href="/dashboard"
            className={isActive("/dashboard") ? "nav-link active" : "nav-link"}
          >
            Dashboard
          </Link>
          <Link
            href="/blog"
            className={isActive("/blog") ? "nav-link active" : "nav-link"}
          >
            Blog
          </Link>
          <Link
            href="/account"
            className={isActive("/account") ? "nav-link active" : "nav-link"}
          >
            Account
          </Link>
          {authed && (
            <button type="button" className="nav-logout" onClick={logout}>
              Logout
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
