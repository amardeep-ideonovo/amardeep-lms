"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { PageAdminRow, PageListItem, PageStatus } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { webUrl } from "@/lib/runtime-env";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import { useToast } from "@/components/ToastProvider";
import {
  OPTIMISTIC_NETWORK_MODE,
  mutationErrorMessage,
  useMountedRef,
} from "@/lib/mutations";
import { withBase } from "@/lib/base-path";
import { STR } from "@lms/types";
import { Button, buttonClass } from "@lms/ui";

// The public "View" link opens on the member site — origin from webUrl() at
// render time (runtime per-instance value; NEXT_PUBLIC_* would bake the
// localhost dev fallback into the prebuilt fleet image).

export default function PagesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const toast = useToast();
  const mounted = useMountedRef();
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
  // under the cursor; the server's own response does the move on commit
  // (docs/coding-standards.md D4: useMutation with an onMutate snapshot and a
  // verbatim onError rollback is the optimistic engine here).
  //
  // No `scope`: the old per-row queue key (`page:<id>`) has no v5 equivalent on
  // a single hook instance (scope ids are fixed per hook, and one scope for the
  // whole table would serialize writes to DIFFERENT rows, which overlap freely
  // today). Same-row overlap can't happen anyway — the row's own control is
  // disabled while its write is in flight (`rowBusy`).
  const publishMutation = useMutation({
    networkMode: OPTIMISTIC_NETWORK_MODE,
    mutationFn: ({ page, next }: { page: PageListItem; next: PageStatus }) =>
      api.updatePage(page.id, { status: next }),
    // Snapshot ONLY the slice about to change and paint through the same state
    // the table renders from; the snapshot rides to onError as the context.
    onMutate: ({ page, next }) => {
      setPages((prev) =>
        prev.map((x) => (x.id === page.id ? { ...x, status: next } : x)),
      );
      return { status: page.status };
    },
    // The server is always the winner: commit its authoritative row.
    onSuccess: (row) => {
      if (mounted.current) applyPage(row);
    },
    onError: (error, { page, next }, snapshot) => {
      if (!mounted.current || !snapshot) return;
      // Verbatim restore, keyed by id — the list may have re-sorted underneath.
      setPages((prev) =>
        prev.map((x) =>
          x.id === page.id ? { ...x, status: snapshot.status } : x,
        ),
      );
      toast(mutationErrorMessage(error, "Failed to update status"), {
        action: {
          label: "Retry",
          // Same variables — the same absolute "set status to X" intent.
          onAction: () => publishMutation.mutate({ page, next }),
        },
      });
    },
  });

  async function togglePublish(p: PageListItem) {
    setError(null);
    const next: PageStatus = p.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    setRowBusy(p.id);
    try {
      await publishMutation.mutateAsync({ page: p, next });
    } catch {
      // Failure is fully handled in onError (rollback + toast with Retry); the
      // await exists only so the row unlocks when the write settles.
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

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("pages", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Pages</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
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
        <Button onClick={addNewPage} disabled={busy}>
          + Add new page
        </Button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="card-head">
          <h2>All pages</h2>
        </div>
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : pages.length === 0 ? (
          <p className="muted">No pages yet. Click “Add new page” to start.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{STR.labels.title}</th>
                  <th>URL</th>
                  <th>Updated</th>
                  <th>{STR.labels.status}</th>
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditor(p.id)}
                        >
                          {STR.common.edit}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => rename(p)}
                        >
                          Rename
                        </Button>
                        <a
                          className={buttonClass({
                            variant: "ghost",
                            size: "sm",
                          })}
                          href={`${webUrl()}/${p.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View
                        </a>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => togglePublish(p)}
                          disabled={rowBusy === p.id}
                        >
                          {rowBusy === p.id
                            ? STR.common.saving
                            : p.status === "PUBLISHED"
                              ? "Unpublish"
                              : "Publish"}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => remove(p)}
                          disabled={rowBusy === p.id}
                        >
                          {STR.common.delete}
                        </Button>
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
