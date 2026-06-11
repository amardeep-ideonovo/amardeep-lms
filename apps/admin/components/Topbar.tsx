"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type {
  AdminSearchItem,
  AdminSearchResponse,
  AdminSection,
  AuthAdmin,
} from "@lms/types";
import { api, clearToken, getToken } from "@/lib/api";
import { useAdminAuth } from "./AdminAuthProvider";
import NotificationBell from "./NotificationBell";

// Client-side command / navigation entries. Permission-gated exactly like the
// sidebar, so the search only offers sections this admin may open.
type Cmd = {
  id: string;
  title: string;
  href: string;
  section?: AdminSection;
  superOnly?: boolean;
};
const COMMANDS: Cmd[] = [
  { id: "go-dashboard", title: "Dashboard", href: "/" },
  { id: "go-members", title: "Members", href: "/members", section: "members" },
  { id: "go-classes", title: "Classes", href: "/classes", section: "classes" },
  { id: "go-courses", title: "Courses", href: "/courses", section: "courses" },
  { id: "go-blog", title: "Blog", href: "/blog", section: "blog" },
  { id: "go-gallery", title: "Gallery", href: "/gallery", section: "gallery" },
  { id: "go-pages", title: "Pages", href: "/pages", section: "pages" },
  { id: "go-header", title: "Header", href: "/header", section: "menus" },
  { id: "go-footer", title: "Footer", href: "/footer", section: "menus" },
  {
    id: "go-navigation",
    title: "Navigation",
    href: "/navigation",
    section: "menus",
  },
  { id: "go-popups", title: "Popups", href: "/popups", section: "popups" },
  { id: "go-forms", title: "Forms", href: "/forms", section: "forms" },
  {
    id: "go-subscriptions",
    title: "Subscriptions",
    href: "/subscriptions",
    section: "subscriptions",
  },
  { id: "go-coupons", title: "Coupons", href: "/coupons", section: "coupons" },
  { id: "go-reports", title: "Reports", href: "/reports", section: "reports" },
  { id: "go-notifications", title: "Notifications", href: "/notifications" },
  { id: "go-settings", title: "Settings", href: "/settings", section: "settings" },
  {
    id: "go-app-customization",
    title: "App Customization",
    href: "/app-customization",
    section: "appCustomization",
  },
  { id: "go-admins", title: "Admins", href: "/admins", superOnly: true },
];

type Row = { id: string; title: string; subtitle: string; href: string };
type RenderGroup = { key: string; label: string; rows: Row[] };

// Avatar fallback initials (when there's no photo): from the name, else email.
function initialsOf(me: AuthAdmin | null): string {
  if (!me) return "?";
  const src = (me.name && me.name.trim()) || me.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "A";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

// Sticky top bar: working global search + notifications + admin avatar.
// Mirrors the Sidebar's visibility rules so it disappears on the login screen
// and inside the full-screen page/popup builders.
export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { can, isSuperAdmin, me } = useAdminAuth();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [q, setQ] = useState("");
  const [resp, setResp] = useState<AdminSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  // Debounced server search for entities. Commands are matched client-side.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResp(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(() => {
      api
        .search(query)
        .then((r) => {
          if (reqId.current === id) {
            setResp(r);
            setLoading(false);
          }
        })
        .catch(() => {
          if (reqId.current === id) {
            setResp(null);
            setLoading(false);
          }
        });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // ⌘K / Ctrl+K focuses the search; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking outside the search box.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current && !boxRef.current.contains(t)) setOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(t))
        setAvatarOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // Matching commands (permission-gated): all when empty, filtered when typing.
  const commandRows = useMemo<Row[]>(() => {
    const visible = COMMANDS.filter((c) =>
      c.superOnly ? isSuperAdmin : c.section ? can(c.section, "read") : true,
    );
    const query = q.trim().toLowerCase();
    const matched = query
      ? visible.filter((c) => c.title.toLowerCase().includes(query))
      : visible;
    return matched.map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: "Go to page",
      href: c.href,
    }));
  }, [q, can, isSuperAdmin]);

  // Rendered groups: Commands first, then entity groups from the API.
  const groups = useMemo<RenderGroup[]>(() => {
    const out: RenderGroup[] = [];
    if (commandRows.length)
      out.push({ key: "commands", label: "Commands", rows: commandRows });
    for (const g of resp?.groups ?? []) {
      out.push({
        key: g.type,
        label: g.label,
        rows: g.items.map((it: AdminSearchItem) => ({
          id: `${it.type}:${it.id}`,
          title: it.title,
          subtitle: it.subtitle ?? "",
          href: it.href,
        })),
      });
    }
    return out;
  }, [commandRows, resp]);

  // Flat list for keyboard navigation (matches render order).
  const flat = useMemo<Row[]>(() => groups.flatMap((g) => g.rows), [groups]);

  // Keep the highlight in range as results change.
  useEffect(() => setActive(0), [q, resp]);

  if (pathname === "/login") return null;
  if (/^\/(pages|popups)\/[^/]+\/edit$/.test(pathname)) return null;
  if (mounted && !getToken()) return null;

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    setResp(null);
    inputRef.current?.blur();
    router.push(href);
  };

  const logout = () => {
    setAvatarOpen(false);
    clearToken();
    router.replace("/login");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const row = flat[active];
      if (row) go(row.href);
    }
  };

  const query = q.trim();
  const showDropdown =
    open && (groups.length > 0 || loading || query.length >= 2);
  const noResults =
    open && !loading && query.length >= 2 && groups.length === 0;

  // Running index across groups so keyboard highlight maps to `flat`.
  let runningIndex = -1;

  return (
    <header className="topbar">
      <div className="topbar-search" ref={boxRef}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="m20 20-3-3"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search members, classes, or type a command…"
          aria-label="Search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="topbar-search-results"
        />
        <span className="kbd">⌘K</span>

        {showDropdown && (
          <div
            className="search-dropdown"
            id="topbar-search-results"
            role="listbox"
          >
            {groups.map((g) => (
              <div className="search-group" key={g.key}>
                <div className="search-group-label">{g.label}</div>
                {g.rows.map((row) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  return (
                    <Link
                      key={row.id}
                      href={row.href}
                      role="option"
                      aria-selected={idx === active}
                      className={
                        idx === active
                          ? "search-item search-item--active"
                          : "search-item"
                      }
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        // close + clear; the Link itself does the navigation
                        setOpen(false);
                        setQ("");
                        setResp(null);
                      }}
                    >
                      <span className="search-item__title">{row.title}</span>
                      {row.subtitle && (
                        <span className="search-item__sub">{row.subtitle}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
            {loading && <div className="search-loading">Searching…</div>}
            {noResults && (
              <div className="search-empty">No results for “{query}”.</div>
            )}
          </div>
        )}
      </div>

      <NotificationBell />

      <div className="top-avatar-wrap" ref={avatarRef}>
        <button
          type="button"
          className="top-avatar"
          title="Account"
          aria-haspopup="menu"
          aria-expanded={avatarOpen}
          onClick={() => setAvatarOpen((v) => !v)}
        >
          {me?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.avatarUrl} alt="" className="top-avatar-img" />
          ) : (
            <span className="top-avatar-initials">{initialsOf(me)}</span>
          )}
          <span className="live" aria-hidden="true" />
        </button>
        {avatarOpen && (
          <div className="avatar-menu" role="menu">
            <div className="avatar-menu-head">
              <div className="avatar-menu-name">{me?.name || "Admin"}</div>
              <div className="avatar-menu-email">{me?.email}</div>
            </div>
            <button
              type="button"
              className="avatar-menu-item"
              role="menuitem"
              onClick={() => {
                setAvatarOpen(false);
                router.push("/profile");
              }}
            >
              Your profile
            </button>
            <button
              type="button"
              className="avatar-menu-item avatar-menu-item--danger"
              role="menuitem"
              onClick={logout}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
