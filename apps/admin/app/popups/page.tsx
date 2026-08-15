"use client";

import { useEffect, useState } from "react";
import type { PopupAdminRow, PopupListItem } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { withBase } from "@/lib/base-path";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import { useOptimisticAction } from "@/lib/useOptimisticAction";
import { STR } from "@lms/types";

// Human summary of WHERE a popup shows, from its visibility flags.
function visibilitySummary(p: PopupListItem): string {
  const parts: string[] = [];
  if (p.showOnDashboard) parts.push("Dashboard");
  if (p.showOnClasses) parts.push("Classes");
  if (p.showOnCourses) parts.push("Courses");
  if (p.showOnLessons) parts.push("Lessons");
  switch (p.pageMode) {
    case "ALL":
      parts.push("All pages");
      break;
    case "INCLUDE":
      parts.push(`${p.pageCount} page${p.pageCount === 1 ? "" : "s"}`);
      break;
    case "EXCLUDE":
      parts.push(`All pages except ${p.pageCount}`);
      break;
    default:
      break; // NONE
  }
  return parts.length ? parts.join(" + ") : "Not shown anywhere";
}

// Compact analytics summary for the list (views · clicks · closed [+ CTR]).
function perfSummary(p: PopupListItem): string {
  if (!p.views && !p.clicks && !p.dismissals) return "No activity yet";
  const ctr = p.views
    ? ` (${Math.round((p.clicks / p.views) * 100)}% CTR)`
    : "";
  return `${p.views} views · ${p.clicks} clicks · ${p.dismissals} closed${ctr}`;
}

const POSITION_LABEL: Record<PopupListItem["position"], string> = {
  CENTER: "Center",
  TOP: "Top",
  BOTTOM: "Bottom",
  TOP_LEFT: "Top left",
  TOP_RIGHT: "Top right",
  BOTTOM_LEFT: "Bottom left",
  BOTTOM_RIGHT: "Bottom right",
};

export default function PopupsPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const optimistic = useOptimisticAction();
  const [popups, setPopups] = useState<PopupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per-row guard for activate/delete so a row's own control can disable while
  // its mutation + reload run (separate from `busy`, which owns "New popup").
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPopups(await api.listPopups());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load popups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !can("popups", "read")) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Create/update return the full PopupAdminRow. It carries every list column,
  // with `pageCount` derived the same way the API's list mapper derives it
  // (pageIds.length), so we can apply it locally instead of refetching. GET
  // /admin/popups is ordered by updatedAt desc — a saved popup moves to the top.
  function applyPopup(row: PopupAdminRow) {
    const item: PopupListItem = {
      id: row.id,
      name: row.name,
      status: row.status,
      position: row.position,
      showOnDashboard: row.showOnDashboard,
      showOnClasses: row.showOnClasses,
      showOnCourses: row.showOnCourses,
      showOnLessons: row.showOnLessons,
      pageMode: row.pageMode,
      pageCount: row.pageIds.length,
      views: row.views,
      clicks: row.clicks,
      dismissals: row.dismissals,
      updatedAt: row.updatedAt,
    };
    setPopups((prev) =>
      (prev.some((p) => p.id === item.id)
        ? prev.map((p) => (p.id === item.id ? item : p))
        : [item, ...prev]
      ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  function openEditor(id: string) {
    window.open(withBase(`/popups/${id}/edit`), "_blank", "noopener");
  }

  async function addNewPopup() {
    // Open the tab synchronously (in the click handler) so the popup blocker
    // permits it, then create a draft and point the tab at the editor. The
    // name is edited at the top of the editor — no browser prompt.
    const win = window.open("", "_blank");
    setBusy(true);
    setError(null);
    try {
      const popup = await api.createPopup({ name: "Untitled popup" });
      if (win) win.location.href = withBase(`/popups/${popup.id}/edit`);
      else openEditor(popup.id);
      applyPopup(popup);
    } catch (err) {
      if (win) win.close();
      setError(
        err instanceof ApiError ? err.message : "Failed to create popup",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rename(p: PopupListItem) {
    const name = await dialog.prompt({
      title: "Rename popup",
      message: "Popup name",
      defaultValue: p.name,
    });
    if (name === null || !name.trim()) return;
    setError(null);
    try {
      applyPopup(await api.updatePopup(p.id, { name: name.trim() }));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to rename popup",
      );
    }
  }

  // The status chip flips on click. Only `status` is painted optimistically —
  // the list is sorted by `updatedAt` and the server's response does that move.
  async function toggleActive(p: PopupListItem) {
    setError(null);
    const next = p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setRowBusy(p.id);
    try {
      await optimistic.run({
        key: `popup:${p.id}`,
        snapshot: () => p.status,
        apply: () =>
          setPopups((prev) =>
            prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)),
          ),
        request: () => api.updatePopup(p.id, { status: next }),
        commit: (row) => applyPopup(row),
        revert: (status) =>
          setPopups((prev) =>
            prev.map((x) => (x.id === p.id ? { ...x, status } : x)),
          ),
        errorMessage: "Failed to update status",
      });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(p: PopupListItem) {
    if (
      !(await dialog.confirm({
        message: `Delete "${p.name}"? This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    setRowBusy(p.id);
    try {
      await api.deletePopup(p.id);
      setPopups((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete popup",
      );
    } finally {
      setRowBusy(null);
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("popups", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Popups</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Popups</h1>
          <p className="subtitle">
            Build popups with the same visual editor as pages, then choose where
            they appear — the member dashboard and/or specific pages. Only{" "}
            <strong>Active</strong> popups show to visitors.
          </p>
        </div>
        <button className="btn" onClick={addNewPopup} disabled={busy}>
          + Add new popup
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="card-head">
          <h2>All popups</h2>
        </div>
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : popups.length === 0 ? (
          <p className="muted">
            No popups yet. Click “Add new popup” to start.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{STR.labels.name}</th>
                  <th>Shows on</th>
                  <th>Position</th>
                  <th>Performance</th>
                  <th>Updated</th>
                  <th>{STR.labels.status}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {popups.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="muted">{visibilitySummary(p)}</td>
                    <td className="muted">{POSITION_LABEL[p.position]}</td>
                    <td className="muted">{perfSummary(p)}</td>
                    <td className="muted">{fmtDate(p.updatedAt)}</td>
                    <td>
                      <span
                        className={
                          p.status === "ACTIVE"
                            ? "badge badge--published"
                            : "badge badge--draft"
                        }
                      >
                        {p.status === "ACTIVE" ? STR.common.active : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => openEditor(p.id)}
                        >
                          {STR.common.edit}
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => rename(p)}
                        >
                          Rename
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => toggleActive(p)}
                          disabled={rowBusy === p.id}
                        >
                          {rowBusy === p.id
                            ? STR.common.saving
                            : p.status === "ACTIVE"
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => remove(p)}
                          disabled={rowBusy === p.id}
                        >
                          {STR.common.delete}
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
