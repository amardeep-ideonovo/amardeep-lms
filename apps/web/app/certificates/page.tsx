"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ClassTileDTO, MyCertificateDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import {
  type ClassExtras,
  classColorClass,
  classIndexMap,
  classPct,
} from "@/lib/memberData";
import { useMemberDashboard, useMyCertificates } from "@/lib/queries";
import AuthGate from "@/components/AuthGate";
import SpotlightLogo from "@/components/SpotlightLogo";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const AwardIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="9" r="6" stroke="#fff" strokeWidth="1.7" />
    <path
      d="M9 14.5 8 22l4-2.5L16 22l-1-7.5"
      stroke="#fff"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const DownloadIcon = ({ color = "#fff" }: { color?: string }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
      stroke={color}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* Earned certificate — ink header + teal seal + credential footer (frame 2e). */
function CertCard({ cert }: { cert: MyCertificateDTO }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    setErr(null);
    try {
      await api.downloadCertificate(cert);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="ik-cert-card">
      <div className="ik-cert-head">
        <div className="ik-cert-brand">
          <SpotlightLogo size={18} />
          <span className="ik-cert-label">Certificate of completion</span>
        </div>
        <div className="ik-cert-name">{cert.className}</div>
        <div className="ik-cert-meta">
          Awarded to {cert.memberName} · {fmtDate(cert.issuedAt)}
        </div>
        <span className="ik-cert-seal" aria-hidden="true">
          <AwardIcon />
        </span>
      </div>
      <div className="ik-cert-foot">
        <span className="ik-cert-serial">Credential ID {cert.serial}</span>
        <div className="ik-grow" />
        <button
          type="button"
          className="ik-cta ik-cta--sm"
          onClick={download}
          disabled={busy}
          aria-busy={busy}
        >
          <DownloadIcon />
          {busy ? "Preparing…" : "Download PDF"}
        </button>
        <Link href={`/verify/${cert.serial}`} className="ik-ghost ik-ghost--sm">
          Verify
        </Link>
      </div>
      {err && (
        <p className="alert alert-error" style={{ margin: "0 24px 16px" }}>
          {err}
        </p>
      )}
    </article>
  );
}

// Stable empty enrichment map for the renders before the dashboard payload
// lands (or after it fails) — never written to.
const EMPTY_EXTRAS: ReadonlyMap<string, ClassExtras> = new Map();

function CertificatesInner() {
  const certsQuery = useMyCertificates();
  // The in-progress section is best-effort, exactly as the old fetch's
  // catch-to-empty was: a dashboard error still renders the earned grid, just
  // without the progress rows. Both reads share their caches with the other
  // member pages and revalidate on tab focus, updating in place.
  const dashboard = useMemberDashboard();

  const certs = certsQuery.data ?? null;
  const classes = useMemo<ClassTileDTO[] | null>(
    () => dashboard.data?.classes ?? (dashboard.error ? [] : null),
    [dashboard.data, dashboard.error],
  );
  const extras = dashboard.data?.extras ?? EMPTY_EXTRAS;

  const colorIdx = useMemo(() => classIndexMap(classes ?? []), [classes]);

  // A 401 means the global handler (lib/query.tsx) is already redirecting to
  // /login — keep the skeleton up for that frame instead of flashing an alert.
  const err = certsQuery.error;
  if (!certs && err && !(err instanceof ApiError && err.status === 401)) {
    return (
      <div className="ink-page">
        <div className="ik-band" />
        <div className="ik-main">
          <div className="alert alert-error">
            {err instanceof Error
              ? err.message
              : "Failed to load certificates."}
          </div>
        </div>
      </div>
    );
  }
  if (!certs || !classes) {
    return (
      <div className="ink-page">
        <div className="ik-band">
          <div className="ik-band-inner">
            <div
              className="ik-skel ik-skel--ink"
              style={{ width: 220, height: 34 }}
            />
            <div
              className="ik-skel ik-skel--ink"
              style={{ width: 380, height: 16, marginTop: 12 }}
            />
          </div>
        </div>
        <div className="ik-main">
          <div className="ik-cert-grid">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="ik-skel"
                style={{ height: 220, borderRadius: 18 }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // In progress = enrolled classes not yet at 100% (certificate not earned).
  const certLevelIds = new Set(certs.map((c) => c.levelId));
  const inProgress = classes.filter(
    (c) =>
      c.owned &&
      !certLevelIds.has(c.id) &&
      !(
        c.progress &&
        c.progress.total > 0 &&
        c.progress.completed >= c.progress.total
      ),
  );

  return (
    <div className="ink-page">
      {/* ---- band: title + counts (frame 2e) ---- */}
      <div className="ik-band">
        <div className="ik-band-inner">
          <h1 className="ik-band-title">Certificates</h1>
          <p className="ik-band-sub">
            {certs.length} earned · {inProgress.length} in progress — finish a
            class to unlock its certificate.
          </p>
        </div>
      </div>

      <div className="ik-main">
        {certs.length > 0 ? (
          <div className="ik-cert-grid">
            {certs.map((c) => (
              <CertCard key={c.id} cert={c} />
            ))}
          </div>
        ) : (
          <div
            className="ik-panel"
            style={{ textAlign: "center", padding: "36px 24px" }}
          >
            <div
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}
            >
              No certificates yet
            </div>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 13.5,
                margin: "8px 0 0",
              }}
            >
              Finish every lesson in a class to earn its certificate.
            </p>
          </div>
        )}

        {/* ---- in-progress list with class-colored bars ---- */}
        {inProgress.length > 0 && (
          <section
            className="ik-panel"
            style={{ marginTop: 22 }}
            aria-label="Certificates in progress"
          >
            <div className="ik-panel-head" style={{ marginBottom: 8 }}>
              <span className="ik-panel-title">In progress</span>
            </div>
            {inProgress.map((c) => {
              const pct = classPct(c);
              const ex = extras.get(c.id);
              const left =
                ex && ex.coursesLeft > 0
                  ? ex.coursesLeft === 1
                    ? "1 course left"
                    : `${ex.coursesLeft} courses left`
                  : ex && ex.lessonsLeft > 0
                    ? `${ex.lessonsLeft} lesson${ex.lessonsLeft === 1 ? "" : "s"} left`
                    : pct === 0
                      ? "not started"
                      : null;
              return (
                <Link
                  key={c.id}
                  href={`/classes/${c.slug ?? c.id}`}
                  className={`ik-prog-row ${classColorClass(colorIdx.get(c.id) ?? 0)}`}
                >
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="ik-prog-thumb" />
                  ) : (
                    <span className="ik-prog-thumb" aria-hidden="true" />
                  )}
                  <span className="ik-prog-main">
                    <span className="ik-prog-top">
                      <span className="ik-prog-name">{c.name}</span>
                      <span className="ik-prog-note">
                        {pct}%{left ? ` · ${left}` : ""}
                      </span>
                    </span>
                    <span className="ik-prog-track">
                      <span
                        className="ik-prog-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </span>
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

export default function CertificatesPage() {
  return (
    <AuthGate>
      <CertificatesInner />
    </AuthGate>
  );
}
