"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { FooterConfig, ResolvedMenu } from "@lms/types";
import { STR } from "@lms/types";
import { api, fetchFooter, footerSubscribe } from "@/lib/api";
import { MenuLink, flattenChildren, isExternal } from "./MenuLink";

// Site footer from the admin "Footer" builder: logo · menu · email opt-in, plus a
// bottom bar. The config is SSR'd (no flash); the menu items are visibility-
// filtered and re-resolved client-side. Renders nothing unless enabled.
export default function Footer({
  config,
  brandTitle,
  legal,
}: {
  config?: FooterConfig | null;
  // Cross-platform brand name (AppConfig.title) — same source as the nav and
  // the apps. Falls back to "LMS" when unset, so all surfaces stay aligned.
  brandTitle?: string | null;
  // Per-academy legal links (AppConfig.privacyUrl/termsUrl — force-defaulted by
  // the API to the platform pages). Always shown in the bottom bar so every page
  // that renders the footer links a policy, independent of the admin's
  // bottomLinks. (When the footer is disabled the footer renders nothing — the
  // signup consent line + the mobile app carry the links on their own surfaces.)
  legal?: { privacyUrl?: string | null; termsUrl?: string | null };
}) {
  const pathname = usePathname();
  const [menu, setMenu] = useState<ResolvedMenu | null>(null);
  // Live config, seeded from the SSR'd prop. The SSR value sits behind two
  // small caches (the API's config TTL + Next's stale-while-revalidate data
  // cache), so an admin's footer edit used to need SEVERAL hard reloads to
  // surface. Re-resolve fresh on every navigation — exactly what Nav does for
  // the header — and reconcile in place; a fetch failure keeps the last good
  // config (availability over freshness).
  const [live, setLive] = useState<FooterConfig | null>(config ?? null);
  useEffect(() => {
    let alive = true;
    fetchFooter()
      .then((fresh) => {
        if (alive && fresh) setLive(fresh);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname]);

  const f = live;
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

  const privacyUrl = legal?.privacyUrl || null;
  const termsUrl = legal?.termsUrl || null;

  // One renderer for every bottom-bar link (policy links + admin bottomLinks):
  // an external target opens in a new tab, an in-app path uses the router.
  const bottomLink = (url: string, label: string, key: string) =>
    isExternal(url) ? (
      <a
        key={key}
        href={url}
        className="footer-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        {label}
      </a>
    ) : (
      <Link key={key} href={url} className="footer-link">
        {label}
      </Link>
    );

  const policyLinks =
    privacyUrl || termsUrl ? (
      <span className="site-footer-bottom-links">
        {privacyUrl &&
          bottomLink(privacyUrl, STR.legal.privacy, "legal-privacy")}
        {termsUrl && bottomLink(termsUrl, STR.legal.terms, "legal-terms")}
      </span>
    ) : null;

  // The decorative footer (logo/menu/email) is gated on `enabled` — OFF by
  // default for a real academy. But the policy links must appear on every
  // non-login page ("every member surface links a policy"), so when the footer
  // is off (or unconfigured) we still render a MINIMAL legal-only bar.
  if (!f || !enabled) {
    return policyLinks ? (
      <footer className="site-footer site-footer--legal-only">
        <div className="site-footer-bottom">{policyLinks}</div>
      </footer>
    ) : null;
  }

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
              {brandTitle?.trim() || "Spotlight Academy"}
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
        {(privacyUrl || termsUrl || f.bottomLinks.length > 0) && (
          <span className="site-footer-bottom-links">
            {privacyUrl &&
              bottomLink(privacyUrl, STR.legal.privacy, "legal-privacy")}
            {termsUrl && bottomLink(termsUrl, STR.legal.terms, "legal-terms")}
            {f.bottomLinks.map((l) => bottomLink(l.url, l.label, l.id))}
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
      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "…" : buttonText}
      </button>
      {err && <span className="footer-subscribe-err">{err}</span>}
    </form>
  );
}
