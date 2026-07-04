"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AutomationDTO,
  AutomationTrigger,
  EmailTemplateDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

type Draft = {
  name: string;
  trigger: AutomationTrigger;
  templateId: string;
  active: boolean;
};

const TRIGGERS: AutomationTrigger[] = [
  "SIGNUP",
  "SUBSCRIPTION_ACTIVE",
  "SUBSCRIPTION_CANCELED",
  "LESSON_COMPLETED",
  "CERTIFICATE_ISSUED",
];

// Human labels + a one-line description of when each event fires, so an admin
// picking a trigger knows what they're wiring up.
const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  SIGNUP: "Member signs up",
  SUBSCRIPTION_ACTIVE: "Subscription becomes active",
  SUBSCRIPTION_CANCELED: "Subscription canceled",
  LESSON_COMPLETED: "Lesson completed",
  CERTIFICATE_ISSUED: "Certificate issued",
};
const TRIGGER_HINT: Record<AutomationTrigger, string> = {
  SIGNUP: "Sent right after a new member creates their account.",
  SUBSCRIPTION_ACTIVE: "Sent when a paid subscription starts or renews.",
  SUBSCRIPTION_CANCELED: "Sent when a subscription is canceled.",
  LESSON_COMPLETED: "Sent when a member completes a lesson.",
  CERTIFICATE_ISSUED: "Sent when a member earns a class certificate.",
};

function emptyDraft(): Draft {
  return { name: "", trigger: "SIGNUP", templateId: "", active: true };
}

function draftFromAutomation(a: AutomationDTO): Draft {
  return {
    name: a.name,
    trigger: a.trigger,
    templateId: a.templateId,
    active: a.active,
  };
}

export default function AutomationsPage() {
  const { can, loading: authLoading } = useAdminAuth();

  const [automations, setAutomations] = useState<AutomationDTO[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const canCreate = can("email", "create");
  const canEdit = can("email", "edit");
  const canDelete = can("email", "delete");

  const selected = useMemo(
    () => automations.find((a) => a.id === selectedId) ?? null,
    [automations, selectedId],
  );
  const editorOpen = creating || !!selected;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, t] = await Promise.all([
        api.listAutomations(),
        api.listEmailTemplates(),
      ]);
      setAutomations(a);
      setTemplates(t);
      setSelectedId((prev) =>
        prev && !a.some((row) => row.id === prev) ? null : prev,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load automations",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !can("email", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  function openEdit(a: AutomationDTO) {
    setCreating(false);
    setSelectedId(a.id);
    setDraft(draftFromAutomation(a));
    setEditorError(null);
  }

  function openCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraft({ ...emptyDraft(), templateId: templates[0]?.id ?? "" });
    setEditorError(null);
  }

  function closeEditor() {
    setCreating(false);
    setSelectedId(null);
    setEditorError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.templateId) {
      setEditorError("Pick a template.");
      return;
    }
    setSaving(true);
    setEditorError(null);
    const body = {
      name: draft.name.trim() || "Untitled automation",
      trigger: draft.trigger,
      templateId: draft.templateId,
      active: draft.active,
    };
    try {
      if (creating) {
        const created = await api.createAutomation(body);
        await load();
        openEdit(created);
      } else if (selected) {
        const updated = await api.updateAutomation(selected.id, body);
        await load();
        setDraft(draftFromAutomation(updated));
      }
    } catch (err) {
      setEditorError(
        err instanceof ApiError ? err.message : "Failed to save automation",
      );
    } finally {
      setSaving(false);
    }
  }

  // Inline active toggle from the list — patches just `active` so an admin can
  // pause/resume an automation without opening the editor.
  async function toggleActive(a: AutomationDTO) {
    if (!canEdit) return;
    setBusyId(a.id);
    setError(null);
    try {
      const updated = await api.updateAutomation(a.id, { active: !a.active });
      await load();
      if (selectedId === a.id) setDraft(draftFromAutomation(updated));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: AutomationDTO) {
    const ok = await dialog.confirm({
      message: `Delete automation "${a.name}"? The ${TRIGGER_LABEL[
        a.trigger
      ].toLowerCase()} email will stop sending.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteAutomation(a.id);
      if (selectedId === a.id) closeEditor();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("email", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Automations</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  const templateName = (id: string) =>
    templates.find((t) => t.id === id)?.name ?? "— (template deleted)";

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Automations</h1>
          <p className="subtitle">
            Emails that send automatically when something happens — a member
            signs up, a subscription starts, a certificate is issued. Point each
            trigger at a template and toggle it on or off. The signup welcome is
            set up for you.
          </p>
        </div>
        {canCreate && (
          <div className="row-actions">
            <button className="btn" onClick={openCreate}>
              + New automation
            </button>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: editorOpen ? "minmax(0, 1.4fr) 1fr" : "1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ---------------- Left: automation list ---------------- */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <h2 style={{ fontSize: 16 }}>All automations</h2>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : automations.length === 0 ? (
            <p className="muted">
              No automations yet.{canCreate ? " Create one to begin." : ""}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Trigger</th>
                    <th>Template</th>
                    <th>Active</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {automations.map((a) => {
                    const active = a.id === selectedId;
                    const busy = busyId === a.id;
                    return (
                      <tr
                        key={a.id}
                        style={
                          active
                            ? { background: "var(--surface-hover)" }
                            : undefined
                        }
                      >
                        <td>
                          <button
                            className="linklike"
                            onClick={() => openEdit(a)}
                            style={{ fontWeight: 600 }}
                          >
                            {a.name}
                          </button>
                        </td>
                        <td>
                          <span className="badge badge--neutral">
                            {TRIGGER_LABEL[a.trigger]}
                          </span>
                        </td>
                        <td>{templateName(a.templateId)}</td>
                        <td>
                          <button
                            type="button"
                            className={
                              a.active
                                ? "badge badge--ok"
                                : "badge badge--draft"
                            }
                            style={{
                              cursor: canEdit ? "pointer" : "default",
                              border: "none",
                            }}
                            disabled={!canEdit || busy}
                            onClick={() => toggleActive(a)}
                            title={
                              canEdit
                                ? a.active
                                  ? "Click to pause"
                                  : "Click to activate"
                                : undefined
                            }
                          >
                            {busy ? "…" : a.active ? "Active" : "Paused"}
                          </button>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {canDelete && (
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => remove(a)}
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ---------------- Right: editor ---------------- */}
        {editorOpen && (
          <form className="card" style={{ margin: 0 }} onSubmit={save}>
            <div className="card-head">
              <h2 style={{ fontSize: 16 }}>
                {creating ? "New automation" : `Editing: ${selected?.name}`}
              </h2>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={closeEditor}
              >
                Close
              </button>
            </div>

            {editorError && <p className="error">{editorError}</p>}

            <div className="field">
              <label>Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Welcome"
                required
                disabled={!canEdit && !creating}
              />
            </div>

            <div className="field">
              <label>Trigger</label>
              <select
                value={draft.trigger}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    trigger: e.target.value as AutomationTrigger,
                  })
                }
                disabled={!canEdit && !creating}
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {TRIGGER_HINT[draft.trigger]}
              </p>
            </div>

            <div className="field">
              <label>Template</label>
              <select
                value={draft.templateId}
                onChange={(e) =>
                  setDraft({ ...draft, templateId: e.target.value })
                }
                disabled={!canEdit && !creating}
                required
              >
                <option value="">Select a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: canEdit || creating ? "pointer" : "default",
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
                disabled={!canEdit && !creating}
                style={{ width: "auto" }}
              />
              <span>Active (send this email when the event fires)</span>
            </label>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 16,
              }}
            >
              {(canEdit || creating) && (
                <button className="btn" type="submit" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : creating
                      ? "Create automation"
                      : "Save changes"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
