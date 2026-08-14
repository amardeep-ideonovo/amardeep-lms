"use client";

import { useEffect, useState } from "react";
import type { PageAdminRow, PageListItem } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { webUrl } from "@/lib/runtime-env";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import { useOptimisticAction } from "@/lib/useOptimisticAction";
import { withBase } from "@/lib/base-path";

// The public "View" link opens on the member site — origin from webUrl() at
// render time (runtime per-instance value; NEXT_PUBLIC_* would bake the
// localhost dev fallback into the prebuilt fleet image).

export default function PagesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const optimistic = useOptimisticAction();
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per-row guard for publish/delete so a row's own control can disable while
  // its mutation + reload run (separate from `busy`, which owns "New page").
  const [rowBusy, setRowBusy] = useState<string | null>(null);

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
    if (authLoading || !can("pages", "read")) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Create/update return the full PageAdminRow, which extends PageListItem with
  // the (heavy) Puck document — narrow it back to the row the table renders and
  // apply it to the list instead of refetching. GET /admin/pages is ordered by
  // updatedAt desc, so a saved page moves to the top; re-sorting on the server's
  // own updatedAt reproduces that exactly.
  function applyPage(row: PageAdminRow) {
    const item: PageListItem = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    };
    setPages((prev) =>
      (prev.some((p) => p.id === item.id)
        ? prev.map((p) => (p.id === item.id ? item : p))
        : [item, ...prev]
      ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

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
      applyPage(page);
    } catch (err) {
      if (win) win.close();
      setError(err instanceof ApiError ? err.message : "Failed to create page");
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: PageListItem) {
    const title = await dialog.prompt({
      title: "Rename page",
      message: "Page title",
      defaultValue: p.title,
    });
    if (title === null || !title.trim()) return;
    const slug = await dialog.prompt({
      title: "Page slug",
      message:
        "Slug (the URL after the domain). Keep it unchanged to leave as-is.",
      defaultValue: p.slug,
    });
    if (slug === null) return;
    setError(null);
    try {
      applyPage(
        await api.updatePage(p.id, {
          title: title.trim(),
          slug: slug.trim() || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename page");
    }
  }

  // The badge flips on click. Only `status` is painted optimistically — the
  // list is sorted by `updatedAt`, and faking that would slide the row out from
  // under the cursor; the server's own response does the move on commit.
  async function togglePublish(p: PageListItem) {
    setError(null);
    const next = p.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    setRowBusy(p.id);
    try {
      await optimistic.run({
        key: `page:${p.id}`,
        snapshot: () => p.status,
        apply: () =>
          setPages((prev) =>
            prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)),
          ),
        request: () => api.updatePage(p.id, { status: next }),
        commit: (row) => applyPage(row),
        revert: (status) =>
          setPages((prev) =>
            prev.map((x) => (x.id === p.id ? { ...x, status } : x)),
          ),
        errorMessage: "Failed to update status",
      });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(p: PageListItem) {
    if (
      !(await dialog.confirm({
        message: `Delete "${p.title}"? This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    setRowBusy(p.id);
    try {
      await api.deletePage(p.id);
      setPages((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete page");
    } finally {
      setRowBusy(null);
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

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("pages", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Pages</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Pages</h1>
          <p className="subtitle">
            Build marketing &amp; content pages with the visual editor.
            Published pages are live at <code>/your-slug</code>; drafts stay
            private.
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
          <div className="table-wrap">
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
                          href={`${webUrl()}/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View
                        </a>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => togglePublish(p)}
                          disabled={rowBusy === p.id}
                        >
                          {rowBusy === p.id
                            ? "Saving…"
                            : p.status === "PUBLISHED"
                              ? "Unpublish"
                              : "Publish"}
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => remove(p)}
                          disabled={rowBusy === p.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
