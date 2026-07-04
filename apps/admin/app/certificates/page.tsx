"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminCertificateListDTO, CertificateTemplateDTO } from "@lms/types";
import { api, API_BASE_URL, ApiError } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

// Where the member site lives — for "copy verify link".
const WEB_URL =
  process.env.NEXT_PUBLIC_WEB_URL?.replace(/\/$/, "") || "http://localhost:3002";

const PAGE_SIZE = 20;

// Certificates: template gallery (the designs members receive) + the issued
// log. Templates are designed in /certificates/<id> (visual field editor).
export default function CertificatesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [tab, setTab] = useState<"templates" | "issued">("templates");
  const [error, setError] = useState<string | null>(null);

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("certificates", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Certificates</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h1>Certificates</h1>
        <p className="subtitle">
          Completion certificates for classes — members claim them after
          finishing every lesson. Upload artwork and position the dynamic
          fields visually.
        </p>
      </div>
      {error && <p className="error">{error}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button
          className={tab === "templates" ? "btn btn--sm" : "btn btn--ghost btn--sm"}
          onClick={() => setTab("templates")}
        >
          Templates
        </button>
        <button
          className={tab === "issued" ? "btn btn--sm" : "btn btn--ghost btn--sm"}
          onClick={() => setTab("issued")}
        >
          Issued
        </button>
      </div>

      {tab === "templates" ? (
        <TemplatesTab
          canCreate={can("certificates", "create")}
          canDelete={can("certificates", "delete")}
          onError={setError}
        />
      ) : (
        <IssuedTab canDelete={can("certificates", "delete")} onError={setError} />
      )}
    </div>
  );
}

function TemplatesTab({
  canCreate,
  canDelete,
  onError,
}: {
  canCreate: boolean;
  canDelete: boolean;
  onError: (m: string | null) => void;
}) {
  const [rows, setRows] = useState<CertificateTemplateDTO[] | null>(null);

  const load = useCallback(() => {
    api
      .listCertificateTemplates()
      .then(setRows)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [onError]);
  useEffect(load, [load]);

  const remove = async (t: CertificateTemplateDTO) => {
    const ok = await dialog.confirm({
      title: "Delete template?",
      message:
        t.issuedCount > 0
          ? `"${t.name}" has ${t.issuedCount} issued certificate(s). They keep their PDFs and stay valid — only the design is removed.`
          : `Delete "${t.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCertificateTemplate(t.id);
      load();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Delete failed");
    }
  };

  if (!rows) return <p className="muted">Loading…</p>;

  const hasDefault = rows.some((r) => r.isDefault);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0 }}>
          {rows.length} template{rows.length === 1 ? "" : "s"} — the default
          applies to every class without its own pick (set per class in the
          class editor).
        </p>
        {canCreate && (
          <Link href="/certificates/new" className="btn">
            New template
          </Link>
        )}
      </div>

      {!hasDefault && rows.length > 0 && (
        <p className="error" style={{ marginBottom: 14 }}>
          No default template — certificates are inactive for classes without
          an explicit template. Open a template and turn on “Default”.
        </p>
      )}
      {rows.length === 0 && (
        <p className="muted">
          No templates yet. Members can’t claim certificates until one exists —
          create the first template and it becomes the default automatically.
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        {rows.map((t) => (
          <div key={t.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <Link href={`/certificates/${t.id}`} style={{ display: "block" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${API_BASE_URL}${t.artworkUrl}`}
                alt=""
                style={{ width: "100%", aspectRatio: `${t.imageWidth} / ${t.imageHeight}`, objectFit: "cover", display: "block" }}
              />
            </Link>
            <div style={{ padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.name}
                </strong>
                {t.isDefault && <span className="badge badge--ok">Default</span>}
              </div>
              <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12.5 }}>
                {t.imageWidth}×{t.imageHeight} · {t.issuedCount} issued
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href={`/certificates/${t.id}`} className="btn btn--sm">
                  Edit
                </Link>
                {canDelete && (
                  <button className="btn btn--danger btn--sm" onClick={() => remove(t)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssuedTab({
  canDelete,
  onError,
}: {
  canDelete: boolean;
  onError: (m: string | null) => void;
}) {
  const [data, setData] = useState<AdminCertificateListDTO | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    api
      .listCertificates({ q: q || undefined, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [q, page, onError]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [load, q]);

  const revoke = async (id: string, serial: string) => {
    const ok = await dialog.confirm({
      title: "Revoke certificate?",
      message: `Delete ${serial}? The member loses the download and the public verification link stops working.`,
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCertificate(id);
      load();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Delete failed");
    }
  };

  const copyVerify = async (serial: string) => {
    try {
      await navigator.clipboard.writeText(`${WEB_URL}/verify/${serial}`);
    } catch {
      /* clipboard denied — non-fatal */
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div style={{ marginBottom: 14, maxWidth: 380 }}>
        <input
          type="search"
          placeholder="Search serial, member, email or class…"
          style={{ width: "100%" }}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="muted">No certificates issued{q ? " for this search" : " yet"}.</p>
      ) : (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Member</th>
                <th>Class</th>
                <th>Template</th>
                <th>Issued</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: "monospace", fontSize: 12.5 }}>{r.serial}</td>
                  <td>
                    {r.memberName}
                    <span className="muted" style={{ display: "block", fontSize: 12 }}>
                      {r.memberEmail}
                    </span>
                  </td>
                  <td>{r.className}</td>
                  <td>{r.templateName ?? <span className="muted">removed</span>}</td>
                  <td>{new Date(r.issuedAt).toLocaleDateString()}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="btn btn--sm"
                      onClick={() =>
                        api
                          .downloadCertificate(r)
                          .catch((e) =>
                            onError(e instanceof ApiError ? e.message : "Download failed")
                          )
                      }
                    >
                      Download
                    </button>{" "}
                    <button className="btn btn--sm" onClick={() => copyVerify(r.serial)}>
                      Copy verify link
                    </button>{" "}
                    {canDelete && (
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => revoke(r.id, r.serial)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <button className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Prev
              </button>
              <span className="muted">
                Page {data.page} of {pages} ({data.total} total)
              </span>
              <button className="btn btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
