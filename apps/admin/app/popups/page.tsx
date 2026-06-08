"use client";

import { useEffect, useState } from "react";
import type { PopupListItem } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { withBase } from "@/lib/base-path";
import { dialog } from "@/components/DialogProvider";

// Human summary of WHERE a popup shows, from its visibility flags.
function visibilitySummary(p: PopupListItem): string {
  const parts: string[] = [];
  if (p.showOnDashboard) parts.push("Dashboard");
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
  const ctr = p.views ? ` (${Math.round((p.clicks / p.views) * 100)}% CTR)` : "";
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
  const [popups, setPopups] = useState<PopupListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await load();
    } catch (err) {
      if (win) win.close();
      setError(err instanceof ApiError ? err.message : "Failed to create popup");
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
      await api.updatePopup(p.id, { name: name.trim() });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename popup");
    }
  }

  async function toggleActive(p: PopupListItem) {
    setError(null);
    try {
      await api.updatePopup(p.id, {
        status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status");
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
    try {
      await api.deletePopup(p.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete popup");
    }
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

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
          <p className="muted">Loading…</p>
        ) : popups.length === 0 ? (
          <p className="muted">No popups yet. Click “Add new popup” to start.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Shows on</th>
                <th>Position</th>
                <th>Performance</th>
                <th>Updated</th>
                <th>Status</th>
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
                      {p.status === "ACTIVE" ? "Active" : "Inactive"}
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
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => toggleActive(p)}
                      >
                        {p.status === "ACTIVE" ? "Deactivate" : "Activate"}
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
