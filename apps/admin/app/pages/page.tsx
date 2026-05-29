"use client";

import { useEffect, useState } from "react";
import type { PageListItem } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { withBase } from "@/lib/base-path";

// Where to open the public "View" link. Set NEXT_PUBLIC_WEB_URL in prod;
// defaults to the dev member site.
const WEB_URL =
  process.env.NEXT_PUBLIC_WEB_URL?.replace(/\/$/, "") || "http://localhost:3002";

export default function PagesPage() {
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPages(await api.listPages());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load pages");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openEditor(id: string) {
    window.open(withBase(`/pages/${id}/edit`), "_blank", "noopener");
  }

  async function addNewPage() {
    // Open the tab synchronously (in the click handler) so the popup blocker
    // permits it, then create a draft and point the tab at the editor. The
    // title is edited at the top of the editor — no browser prompt.
    const win = window.open("", "_blank");
    setBusy(true);
    setError(null);
    try {
      const page = await api.createPage({ title: "Untitled page" });
      if (win) win.location.href = withBase(`/pages/${page.id}/edit`);
      else openEditor(page.id);
      await load();
    } catch (err) {
      if (win) win.close();
      setError(err instanceof ApiError ? err.message : "Failed to create page");
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: PageListItem) {
    const title = window.prompt("Page title", p.title);
    if (title === null || !title.trim()) return;
    const slug = window.prompt(
      "Slug (the URL after the domain). Keep it unchanged to leave as-is.",
      p.slug
    );
    if (slug === null) return;
    setError(null);
    try {
      await api.updatePage(p.id, {
        title: title.trim(),
        slug: slug.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename page");
    }
  }

  async function togglePublish(p: PageListItem) {
    setError(null);
    try {
      await api.updatePage(p.id, {
        status: p.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status");
    }
  }

  async function remove(p: PageListItem) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${p.title}"? This cannot be undone.`)
    )
      return;
    setError(null);
    try {
      await api.deletePage(p.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete page");
    }
  }

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Pages</h1>
          <p className="subtitle">
            Build marketing &amp; content pages with the visual editor. Published
            pages are live at <code>/your-slug</code>; drafts stay private.
          </p>
        </div>
        <button className="btn" onClick={addNewPage} disabled={busy}>
          + Add new page
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="card-head">
          <h2>All pages</h2>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : pages.length === 0 ? (
          <p className="muted">No pages yet. Click “Add new page” to start.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>URL</th>
                <th>Updated</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td className="muted">/{p.slug}</td>
                  <td className="muted">{fmtDate(p.updatedAt)}</td>
                  <td>
                    <span
                      className={
                        p.status === "PUBLISHED"
                          ? "badge badge--published"
                          : "badge badge--draft"
                      }
                    >
                      {p.status === "PUBLISHED" ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => openEditor(p.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => rename(p)}
                      >
                        Rename
                      </button>
                      <a
                        className="btn btn--ghost btn--sm"
                        href={`${WEB_URL}/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View
                      </a>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => togglePublish(p)}
                      >
                        {p.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => remove(p)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
