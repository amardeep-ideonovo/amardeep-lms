"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { FooterConfig, ResolvedMenu } from "@lms/types";
import { api, footerSubscribe } from "@/lib/api";
import { MenuLink, flattenChildren, isExternal } from "./MenuLink";

// Site footer from the admin "Footer" builder: logo · menu · email opt-in, plus a
// bottom bar. The config is SSR'd (no flash); the menu items are visibility-
// filtered and re-resolved client-side. Renders nothing unless enabled.
export default function Footer({
  config,
  brandTitle,
}: {
  config?: FooterConfig | null;
  // Cross-platform brand name (AppConfig.title) — same source as the nav and
  // the apps. Falls back to "LMS" when unset, so all surfaces stay aligned.
  brandTitle?: string | null;
}) {
  const pathname = usePathname();
  const [menu, setMenu] = useState<ResolvedMenu | null>(null);

  const f = config ?? null;
  const menuId = f?.menuId ?? null;
  const enabled = !!f?.enabled;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const m = menuId ? api.resolveMenuById(menuId) : api.resolveMenu("FOOTER");
    m.then((r) => alive && setMenu(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, menuId, enabled]);

  if (pathname === "/login") return null;
  if (!f || !enabled) return null;

  const year = new Date().getFullYear();
  const copyright = f.copyright.replace(/\{year\}/g, String(year));
  const links = menu ? flattenChildren(menu.items) : [];

  // Inline CSS vars from the saved config (consumed by globals.css with fallbacks).
  const style = {} as React.CSSProperties;
  const v = style as Record<string, string>;
  v["--ftr-bg"] = f.bgColor;
  v["--ftr-text"] = f.textColor;
  v["--ftr-heading"] = f.headingColor;
  v["--ftr-link"] = f.linkColor;
  v["--ftr-pad-y"] = `${f.paddingY}px`;

  return (
    <footer className="site-footer" style={style}>
      <div className="site-footer-inner">
        {/* col 1: logo */}
        <div className="site-footer-col">
          {f.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.logoUrl} alt="" className="footer-logo" />
          ) : (
            <Link href="/dashboard" className="footer-brand">
              {brandTitle?.trim() || "LMS"}
            </Link>
          )}
          {f.tagline && <p className="footer-tagline">{f.tagline}</p>}
        </div>

        {/* col 2: menu */}
        <div className="site-footer-col">
          {f.menuHeading && (
            <div className="footer-col-title">{f.menuHeading}</div>
          )}
          <div className="footer-col-links">
            {links.map(({ item }) => (
              <MenuLink key={item.id} item={item} className="footer-link" />
            ))}
          </div>
        </div>

        {/* col 3: email opt-in */}
        <div className="site-footer-col">
          {f.email.heading && (
            <div className="footer-col-title">{f.email.heading}</div>
          )}
          {f.email.text && <p className="footer-tagline">{f.email.text}</p>}
          <FooterSubscribe
            placeholder={f.email.placeholder}
            buttonText={f.email.buttonText}
          />
        </div>
      </div>

      <div className="site-footer-bottom">
        <span>{copyright}</span>
        {f.bottomLinks.length > 0 && (
          <span className="site-footer-bottom-links">
            {f.bottomLinks.map((l) =>
              isExternal(l.url) ? (
                <a
                  key={l.id}
                  href={l.url}
                  className="footer-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {l.label}
                </a>
              ) : (
                <Link key={l.id} href={l.url} className="footer-link">
                  {l.label}
                </Link>
              ),
            )}
          </span>
        )}
      </div>
    </footer>
  );
}

// Built-in email capture -> /site/footer/subscribe -> in-house audience (server-side).
function FooterSubscribe({
  placeholder,
  buttonText,
}: {
  placeholder: string;
  buttonText: string;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await footerSubscribe(email.trim());
      if (res.ok) {
        setDone(res.message || "Thanks! You're subscribed.");
        setEmail("");
      } else {
        setErr(res.message || "Couldn’t subscribe. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="footer-subscribe-done">{done}</p>;

  return (
    <form className="footer-subscribe" onSubmit={onSubmit} noValidate>
      <input
        type="email"
        value={email}
        placeholder={placeholder}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email address"
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? "…" : buttonText}
      </button>
      {err && <span className="footer-subscribe-err">{err}</span>}
    </form>
  );
}
