import { Fragment, type ReactNode } from "react";
import Link from "next/link";

/**
 * Shared "ink band" page header — the same dark greeting band used across the
 * dashboard / classes / class-detail screens, extracted so pages that lacked a
 * header (blog, account, course) can carry the identical treatment. Renders the
 * exact `.ik-band` markup, so it matches those pages 1:1.
 *
 * Pass `imageUrl` for the photo-hero variant (mirrors the class-detail page);
 * pass `crumbs` for a breadcrumb row; `children` sits on the right of the title
 * row (e.g. a CTA or progress ring).
 */
type Crumb = { href?: string; label: string };

export default function PageBand({
  title,
  subtitle,
  crumbs,
  imageUrl,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  imageUrl?: string | null;
  children?: ReactNode;
}) {
  const hasCrumbs = !!crumbs && crumbs.length > 0;
  return (
    <header
      className={
        imageUrl
          ? "ik-band ik-band--header ik-band--photo"
          : "ik-band ik-band--header"
      }
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      <div
        className={
          hasCrumbs ? "ik-band-inner ik-band-inner--crumbs" : "ik-band-inner"
        }
      >
        {hasCrumbs && (
          <nav className="ik-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden="true">›</span>}
                {c.href ? (
                  <Link href={c.href}>{c.label}</Link>
                ) : (
                  <span className="on">{c.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <div
          className="ik-band-row"
          style={hasCrumbs ? { marginTop: 14 } : undefined}
        >
          <div className="ik-grow">
            <h1 className="ik-band-title">{title}</h1>
            {subtitle && <p className="ik-band-sub">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </header>
  );
}
