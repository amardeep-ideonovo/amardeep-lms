"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  AuthUser,
  ResolvedHeader,
  ResolvedHeaderCta,
  ResolvedMenu,
} from "@lms/types";
import {
  api,
  clearToken,
  fetchSiteHeader,
  getCachedMe,
  getToken,
  setCachedMe,
} from "@/lib/api";
import { MenuLink, flattenChildren, isExternal } from "./MenuLink";
import SpotlightLogo from "./SpotlightLogo";

// Avatar fallback initials from the member's name, else username/email.
function avatarInitials(u: AuthUser): string {
  const src =
    [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || u.email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "M") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Top navigation. Styling/layout (background, width, padding, columns, logo,
// CTAs, link colors) come from the admin "Header" builder, SSR'd via `header`.
// The menu *items* are visibility-filtered server-side and re-fetched on
// navigation/login (they depend on the member's token). With no saved config,
// CSS-var fallbacks reproduce the original header exactly.
export default function Nav({
  initialHeader,
  initialMenu,
  brandTitle,
}: {
  initialHeader?: ResolvedHeader | null;
  initialMenu?: ResolvedMenu | null;
  // Cross-platform brand name (AppConfig.title) — the same source the mobile
  // app uses. Falls back to "LMS" when unset, so web and apps stay aligned.
  brandTitle?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [header, setHeader] = useState<ResolvedHeader | null>(
    initialHeader ?? null,
  );
  // Seeded from the SSR'd menu so the first paint shows the real nav (no flash
  // of the built-in fallback on refresh).
  const [menu, setMenu] = useState<ResolvedMenu | null>(initialMenu ?? null);
  const [mobile, setMobile] = useState<ResolvedMenu | null>(null);
  const [drawer, setDrawer] = useState(false);

  // Member identity for the account dropdown (replaces the bare Logout button).
  // Seeded from the localStorage cache so the avatar paints immediately on
  // refresh — no flicker — then refreshed by the live /auth/me call below.
  const [me, setMe] = useState<AuthUser | null>(() => getCachedMe());
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const h = header;
  const menuId = h?.menuId ?? null;

  useEffect(() => {
    setAuthed(!!getToken());
  }, [pathname]);

  // Re-resolve which header applies to this path + visitor (audience/page
  // rules) on navigation and on login/logout. The SSR'd initialHeader covers
  // the first paint; a null result -> the built-in fallback rendered below.
  useEffect(() => {
    let alive = true;
    fetchSiteHeader(pathname)
      .then((m) => alive && setHeader(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, authed]);

  useEffect(() => {
    let alive = true;
    // The chosen menu (or the HEADER-location menu when none is picked).
    const headerMenu = menuId
      ? api.resolveMenuById(menuId)
      : api.resolveMenu("HEADER");
    headerMenu.then((m) => alive && setMenu(m)).catch(() => {});
    api.resolveMenu("MOBILE").then((m) => alive && setMobile(m)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, menuId, authed]);

  useEffect(() => setDrawer(false), [pathname]);

  // Load (or clear) the member's profile for the account dropdown, keeping the
  // cache in sync so the next refresh paints instantly.
  useEffect(() => {
    if (!authed) {
      setMe(null);
      setCachedMe(null);
      return;
    }
    let alive = true;
    api
      .me()
      .then((u) => {
        if (!alive) return;
        setMe(u);
        setCachedMe(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authed]);

  // Close the account dropdown on outside click or navigation.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node))
        setProfileOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);
  useEffect(() => setProfileOpen(false), [pathname]);

  if (pathname === "/login") return null;

  const logout = () => {
    clearToken();
    setDrawer(false);
    router.replace("/login");
  };
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const headerItems = menu?.items ?? [];
  const hasMenu = headerItems.length > 0;
  const drawerItems = mobile?.items?.length ? mobile.items : headerItems;
  const ctas = h?.ctas ?? [];
  const layout3 = h?.layout === "THREE_COL";

  // Inline CSS vars from the saved config. Omitted entirely when there's no
  // config so the CSS fallbacks (original theme values) apply unchanged.
  const styleVars: React.CSSProperties = {};
  if (h) {
    const v = styleVars as Record<string, string>;
    v["--hdr-bg"] = h.bgColor;
    v["--hdr-maxw"] = h.width === "FULL" ? "100%" : `${h.maxWidth ?? 1080}px`;
    v["--hdr-pad-x"] = `${h.paddingX}px`;
    v["--hdr-pad-y"] = `${h.paddingY}px`;
    v["--hdr-link"] = h.linkColor;
    v["--hdr-active"] = h.menuActiveColor ?? h.linkColor;
    v["--hdr-active-bg"] = h.menuActiveColor
      ? `color-mix(in srgb, ${h.menuActiveColor} 14%, transparent)`
      : "var(--fill-primary)";
  }

  // Default brand: the Spotlight glyph + site title (Ink Hero). An admin-
  // uploaded header logo still replaces the whole mark.
  const Brand = h?.logoUrl ? (
    <Link href="/dashboard" className="nav-brand nav-brand--logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={h.logoUrl} alt="" className="nav-logo" />
    </Link>
  ) : (
    <Link href="/dashboard" className="nav-brand">
      <SpotlightLogo size={26} />
      <span>{brandTitle?.trim() || "LMS"}</span>
    </Link>
  );

  const Fallback = (
    <>
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
        className={
          isActive("/account") || isActive("/pricing") || isActive("/checkout")
            ? "nav-link active"
            : "nav-link"
        }
      >
        Account
      </Link>
    </>
  );

  const renderCta = (c: ResolvedHeaderCta, className: string) => {
    const style: React.CSSProperties = {
      background: c.bgColor,
      color: c.textColor,
      padding: `${c.paddingY}px ${c.paddingX}px`,
      borderRadius: c.borderRadius,
    };
    return isExternal(c.href) ? (
      <a
        key={c.id}
        className={className}
        href={c.href}
        style={style}
        target={c.newTab ? "_blank" : undefined}
        rel={c.newTab ? "noopener noreferrer" : undefined}
        onClick={() => setDrawer(false)}
      >
        {c.label}
      </a>
    ) : (
      <Link
        key={c.id}
        className={className}
        href={c.href}
        style={style}
        target={c.newTab ? "_blank" : undefined}
        onClick={() => setDrawer(false)}
      >
        {c.label}
      </Link>
    );
  };

  // Account dropdown: avatar button → menu with name/email, Account, Log out.
  // Mirrors the admin topbar avatar menu. Only shown to signed-in members.
  const profileName = me
    ? [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username
    : "Your account";
  const ProfileMenu = authed ? (
    <div className="nav-profile" ref={profileRef}>
      <button
        type="button"
        className="nav-profile-btn"
        title="Account"
        aria-haspopup="menu"
        aria-expanded={profileOpen}
        onClick={() => setProfileOpen((v) => !v)}
      >
        <span className="nav-avatar">
          {me?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.avatarUrl} alt="" className="nav-avatar-img" />
          ) : (
            <span className="nav-avatar-initials">
              {me ? avatarInitials(me) : ""}
            </span>
          )}
        </span>
        {me && <span className="nav-profile-name">{profileName}</span>}
      </button>
      {profileOpen && (
        <div className="nav-avatar-menu" role="menu">
          <div className="nav-avatar-head">
            <div className="nav-avatar-name">{profileName}</div>
            {me?.email && <div className="nav-avatar-email">{me.email}</div>}
          </div>
          <Link
            href="/account"
            role="menuitem"
            className="nav-avatar-item"
            onClick={() => setProfileOpen(false)}
          >
            Your account
          </Link>
          <button
            type="button"
            role="menuitem"
            className="nav-avatar-item nav-avatar-item--danger"
            onClick={logout}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <header className="nav" style={styleVars}>
      <div className={layout3 ? "nav-inner nav-inner--3" : "nav-inner"}>
        {Brand}

        <nav className="nav-links">
          {hasMenu
            ? headerItems.map((it) => (
                <div
                  key={it.id}
                  className={it.children.length ? "nav-item has-sub" : "nav-item"}
                >
                  <MenuLink
                    item={it}
                    className={isActive(it.href) ? "nav-link active" : "nav-link"}
                  />
                  {it.children.length > 0 && (
                    <div className="nav-sub">
                      {flattenChildren(it.children).map(({ item, depth }) => (
                        <div key={item.id} style={{ paddingLeft: depth * 12 }}>
                          <MenuLink item={item} className="nav-sub-link" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            : Fallback}
          <span className="nav-sep" aria-hidden="true" />
          {!layout3 && ProfileMenu}
        </nav>

        {layout3 && (
          <div className="nav-ctas">
            {ctas.map((c) => renderCta(c, "nav-cta"))}
            {ProfileMenu}
          </div>
        )}

        <button
          type="button"
          className="nav-burger"
          aria-label="Open menu"
          onClick={() => setDrawer(true)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {drawer && (
        <div className="nav-drawer-overlay" onClick={() => setDrawer(false)}>
          <div className="nav-drawer" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="nav-drawer-close"
              aria-label="Close menu"
              onClick={() => setDrawer(false)}
            >
              ✕
            </button>
            <div className="nav-drawer-links">
              {drawerItems.length ? (
                flattenChildren(drawerItems).map(({ item, depth }) => (
                  <div key={item.id} style={{ paddingLeft: depth * 14 }}>
                    <MenuLink
                      item={item}
                      className="nav-drawer-link"
                      onClick={() => setDrawer(false)}
                    />
                  </div>
                ))
              ) : (
                <>
                  <Link
                    href="/dashboard"
                    className="nav-drawer-link"
                    onClick={() => setDrawer(false)}
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/blog"
                    className="nav-drawer-link"
                    onClick={() => setDrawer(false)}
                  >
                    Blog
                  </Link>
                  <Link
                    href="/account"
                    className="nav-drawer-link"
                    onClick={() => setDrawer(false)}
                  >
                    Account
                  </Link>
                </>
              )}
              {ctas.length > 0 && (
                <div className="nav-drawer-ctas">
                  {ctas.map((c) => renderCta(c, "nav-drawer-cta"))}
                </div>
              )}
              {authed && (
                <>
                  <Link
                    href="/account"
                    className="nav-drawer-link"
                    onClick={() => setDrawer(false)}
                  >
                    Your account
                  </Link>
                  <button
                    type="button"
                    className="nav-logout"
                    onClick={logout}
                  >
                    Log out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
