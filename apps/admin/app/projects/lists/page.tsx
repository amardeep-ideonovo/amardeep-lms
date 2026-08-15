"use client";

// Projects → Lists: the standalone "WEB QUEUE" workspace. The page owns the list
// picker (tabs), "+ New list" and the per-list Workflows panel; the actual queue
// TABLE (typed columns, inline-editable cells, add-column/add-row, the per-item
// 💬 detail card) lives in the reusable <QueueTable/> component, shared with the
// channel List tabs in app/projects/page.tsx. Admin-only; gated on `projects`.
//
// TODO (later, research-informed): saved VIEWS + advanced filters (grouping,
// per-column filter rules, sort).

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChatChannelDTO,
  ChatListSummaryDTO,
  ChatWorkflowDTO,
  ChatWorkflowTrigger,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useModalA11y } from "@/lib/useModalA11y";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import QueueTable from "@/components/QueueTable";
import {
  AdminLite,
  NameResolver,
  loadAdminRoster,
  makeNameResolver,
} from "@/lib/projects";
import { useOptimisticAction } from "@/lib/useOptimisticAction";
import { getProjectsSocket, onChatListUpdate } from "@/lib/projectsSocket";
import { STR } from "@lms/types";

// ============================================================================
// Page
// ============================================================================
export default function ProjectListsPage() {
  const { me, can, loading: authLoading } = useAdminAuth();

  const [lists, setLists] = useState<ChatListSummaryDTO[]>([]);
  const [channels, setChannels] = useState<ChatChannelDTO[]>([]);
  const [roster, setRoster] = useState<AdminLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolveName: NameResolver = useMemo(
    () => makeNameResolver(roster),
    [roster],
  );

  const canCreate = can("projects", "create");
  const canEdit = can("projects", "edit");
  const canDelete = can("projects", "delete");

  // The page keeps a light copy of all lists for the picker tabs (names, channel
  // labels, item counts). The QueueTable loads + mutates the selected list's full
  // contents itself; we just refetch here on its changes to keep the tab counts
  // honest.
  const load = useCallback(async () => {
    try {
      const rows = await api.listLists();
      setLists(rows);
      setSelectedId((cur) => {
        if (cur && rows.some((l) => l.id === cur)) return cur;
        return rows[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load lists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !can("projects", "read")) return;
    void load();
    api
      .listChannels()
      .then(setChannels)
      .catch(() => setChannels([]));
    void loadAdminRoster().then(setRoster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Realtime: refresh the picker (tab counts) on any list update we're showing.
  useEffect(() => {
    if (authLoading || !can("projects", "read")) return;
    getProjectsSocket();
    const off = onChatListUpdate((evt) => {
      if (lists.some((l) => l.id === evt.listId)) void load();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, lists]);

  // 10s catch-all poll (covers stand-alone lists + missed socket events).
  useEffect(() => {
    if (authLoading || !can("projects", "read")) return;
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const selected = useMemo(
    () => lists.find((l) => l.id === selectedId) ?? null,
    [lists, selectedId],
  );

  // ---- list-level actions ----
  async function createList() {
    const name = await dialog.prompt({
      message: "New list name",
      placeholder: "e.g. Web queue",
      confirmLabel: STR.common.create,
    });
    if (!name || !name.trim()) return;
    try {
      const created = await api.createList({ name: name.trim() });
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create list");
    }
  }

  const channelName = useCallback(
    (id: string | null | undefined) =>
      id ? (channels.find((c) => c.id === id)?.name ?? "channel") : null,
    [channels],
  );

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("projects", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Lists</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Lists</h1>
          <p className="subtitle">
            A queue table for the team — define typed columns (status, owner,
            due date, secrets…) and track work item by item, Airtable-style.
          </p>
        </div>
        <div className="row-actions">
          {selectedId && (
            <button
              className="btn btn--ghost"
              onClick={() => setWorkflowsOpen(true)}
              title="Automations that auto-post into a channel when items change"
            >
              ⚡ Workflows
            </button>
          )}
          {canCreate && (
            <button className="btn" onClick={createList}>
              + New list
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">{STR.common.loading}</p>
      ) : lists.length === 0 ? (
        <div className="card" style={{ margin: 0 }}>
          <p className="muted">
            No lists yet.{canCreate ? " Create one to begin." : ""}
          </p>
        </div>
      ) : (
        <>
          {/* List picker */}
          <div className="pj-tbl-tabs">
            {lists.map((l) => (
              <button
                key={l.id}
                className={`pj-tbl-tab${l.id === selectedId ? " pj-tbl-tab--active" : ""}`}
                onClick={() => setSelectedId(l.id)}
              >
                {l.name}
                {l.channelId && (
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {" "}
                    #{channelName(l.channelId)}
                  </span>
                )}
                <span className="pj-tbl-tab-count">{l.itemCount}</span>
              </button>
            ))}
          </div>

          {selected && (
            <QueueTable
              key={selected.id}
              listId={selected.id}
              roster={roster}
              resolveName={resolveName}
              meId={me?.id ?? null}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onError={setError}
              // Keep the picker's tab counts fresh when the table mutates.
              onListLoaded={(updated) =>
                setLists((prev) =>
                  prev.map((l) =>
                    l.id === updated.id
                      ? {
                          id: updated.id,
                          channelId: updated.channelId,
                          name: updated.name,
                          createdByAdminId: updated.createdByAdminId,
                          createdAt: updated.createdAt,
                          updatedAt: updated.updatedAt,
                          itemCount: updated.items.length,
                        }
                      : l,
                  ),
                )
              }
            />
          )}

          {workflowsOpen && selected && (
            <WorkflowsPanel
              list={selected}
              channels={channels}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onClose={() => setWorkflowsOpen(false)}
              onError={setError}
            />
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Workflows panel — list / create / enable / delete the auto-post automations
// for the current list (the Slack "Web Queue Workflow" flow). Gated on the
// `projects` RBAC like the rest of the page.
// ============================================================================
const TRIGGER_LABELS: { value: ChatWorkflowTrigger; label: string }[] = [
  { value: "ITEM_CREATED", label: "When an item is added" },
  { value: "ITEM_ASSIGNED", label: "When an item is assigned" },
  { value: "ITEM_UPDATED", label: "When an item is updated" },
];

function WorkflowsPanel({
  list,
  channels,
  canCreate,
  canEdit,
  canDelete,
  onClose,
  onError,
}: {
  list: ChatListSummaryDTO;
  channels: ChatChannelDTO[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [workflows, setWorkflows] = useState<ChatWorkflowDTO[]>([]);
  const optimistic = useOptimisticAction();
  // Names the workflow whose enable/delete is mid-flight so its row locks.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // New-workflow form state.
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<ChatWorkflowTrigger>("ITEM_CREATED");
  const [channelId, setChannelId] = useState<string>(list.channelId ?? "");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const modalRef = useModalA11y();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listWorkflows(list.id);
      setWorkflows(rows);
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to load workflows",
      );
    } finally {
      setLoading(false);
    }
  }, [list.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Default the post-target select to the list's own channel.
  const listChannelName = list.channelId
    ? (channels.find((c) => c.id === list.channelId)?.name ?? null)
    : null;

  async function create() {
    if (!name.trim()) return;
    // A workflow needs somewhere to post: an explicit channel OR the list's own.
    const target = channelId || list.channelId || "";
    if (!target) {
      onError(
        "This list has no channel — pick a target channel for the workflow.",
      );
      return;
    }
    setBusy(true);
    try {
      await api.createWorkflow({
        name: name.trim(),
        listId: list.id,
        // Send channelId only when it differs from the list's own (else inherit).
        channelId: channelId && channelId !== list.channelId ? channelId : null,
        trigger,
        config: template.trim() ? { template: template.trim() } : undefined,
      });
      setName("");
      setTemplate("");
      setTrigger("ITEM_CREATED");
      setChannelId(list.channelId ?? "");
      setCreating(false);
      await load();
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to create workflow",
      );
    } finally {
      setBusy(false);
    }
  }

  // The Enabled/Disabled chip flips on click; PATCH returns the whole workflow,
  // so the response replaces the row and no refetch is needed.
  async function toggleEnabled(wf: ChatWorkflowDTO) {
    setRowBusy(wf.id);
    const next = !wf.enabled;
    try {
      await optimistic.run({
        key: `workflow:${wf.id}`,
        snapshot: () => wf.enabled,
        apply: () =>
          setWorkflows((prev) =>
            prev.map((x) => (x.id === wf.id ? { ...x, enabled: next } : x)),
          ),
        request: () => api.updateWorkflow(wf.id, { enabled: next }),
        commit: (updated) =>
          setWorkflows((prev) =>
            prev.map((x) => (x.id === updated.id ? updated : x)),
          ),
        revert: (enabled) =>
          setWorkflows((prev) =>
            prev.map((x) => (x.id === wf.id ? { ...x, enabled } : x)),
          ),
        errorMessage: "Failed to update workflow",
      });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(wf: ChatWorkflowDTO) {
    const ok = await dialog.confirm({
      message: STR.confirm.deleteEntity("workflow", wf.name),
      danger: true,
      confirmLabel: STR.common.delete,
    });
    if (!ok) return;
    setRowBusy(wf.id);
    try {
      await api.deleteWorkflow(wf.id);
      await load();
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Failed to delete workflow",
      );
    } finally {
      setRowBusy(null);
    }
  }

  const triggerLabel = (t: ChatWorkflowTrigger) =>
    TRIGGER_LABELS.find((x) => x.value === t)?.label ?? t;
  const channelName = (id: string | null | undefined) =>
    id ? (channels.find((c) => c.id === id)?.name ?? "channel") : null;

  return (
    // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.
    <div
      ref={modalRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal modal--wide" role="dialog" aria-label="Workflows">
        <div className="modal-header">
          <h2>⚡ Workflows — {list.name}</h2>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label={STR.common.close}
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Auto-post a formatted, @mentioned message into a channel when items
            in this list are added or assigned.
            {listChannelName ? (
              <>
                {" "}
                Default target: <strong>#{listChannelName}</strong>.
              </>
            ) : (
              " This list has no channel, so each workflow must pick a target."
            )}
          </p>

          {/* Existing workflows */}
          {loading ? (
            <p className="muted">{STR.common.loading}</p>
          ) : workflows.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No workflows yet.
            </p>
          ) : (
            <div className="pj-wf-list">
              {workflows.map((wf) => (
                <div className="pj-wf-row" key={wf.id}>
                  <div className="pj-wf-main">
                    <span className="pj-wf-name">{wf.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {triggerLabel(wf.trigger)} → #
                      {channelName(wf.channelId ?? list.channelId) ?? "—"}
                    </span>
                  </div>
                  <div className="pj-wf-actions">
                    <span
                      className={`chip${wf.enabled ? "" : " chip--muted"}`}
                      style={{ fontSize: 11 }}
                    >
                      {wf.enabled ? "Enabled" : "Disabled"}
                    </span>
                    {canEdit && (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => toggleEnabled(wf)}
                        disabled={rowBusy === wf.id}
                      >
                        {rowBusy === wf.id
                          ? STR.common.saving
                          : wf.enabled
                            ? "Disable"
                            : "Enable"}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="pj-tbl-rowdel"
                        title="Delete workflow"
                        onClick={() => remove(wf)}
                        disabled={rowBusy === wf.id}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create */}
          {canCreate &&
            (creating ? (
              <div className="pj-wf-create">
                <label className="pj-pop-label">Workflow name</label>
                <input
                  className="pj-pop-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Web Queue Workflow"
                  autoFocus
                />

                <label className="pj-pop-label">Trigger</label>
                <select
                  className="pj-pop-input"
                  value={trigger}
                  onChange={(e) =>
                    setTrigger(e.target.value as ChatWorkflowTrigger)
                  }
                >
                  {TRIGGER_LABELS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>

                <label className="pj-pop-label">Post to channel</label>
                <select
                  className="pj-pop-input"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  <option value="">
                    {listChannelName
                      ? `List channel (#${listChannelName})`
                      : "— pick a channel —"}
                  </option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>

                <label className="pj-pop-label">
                  Message template{" "}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    (optional — uses a default if blank)
                  </span>
                </label>
                <textarea
                  className="pj-pop-input"
                  rows={4}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder={
                    "Placeholders: {actor} {assignee} {title} {field:Category} {field:Due}"
                  }
                />

                <div className="pj-pop-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setCreating(false)}
                  >
                    {STR.common.cancel}
                  </button>
                  <button
                    className="btn btn--sm"
                    onClick={create}
                    disabled={busy || !name.trim()}
                  >
                    {busy ? "Creating…" : "Create workflow"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn--sm"
                style={{ marginTop: 12 }}
                onClick={() => setCreating(true)}
              >
                + New workflow
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
