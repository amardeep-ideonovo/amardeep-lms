"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AudienceDTO,
  CampaignCadence,
  CampaignDTO,
  CampaignStatus,
  EmailTemplateDTO,
  SegmentDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

// Editor draft. runAt is held as a value for <input type="datetime-local">
// (local wall-clock, no tz suffix) and converted to/from ISO at the edges.
type Draft = {
  name: string;
  templateId: string;
  audienceId: string;
  segmentId: string;
  cadence: CampaignCadence;
  runAtLocal: string;
  cron: string;
};

function emptyDraft(): Draft {
  return {
    name: "",
    templateId: "",
    audienceId: "",
    segmentId: "",
    cadence: "ONCE",
    runAtLocal: defaultRunAt(),
    cron: "0 9 * * 1",
  };
}

// A sensible default send time: ~1 hour from now, rounded to the minute, in the
// `datetime-local` format (YYYY-MM-DDTHH:mm) the input expects.
function defaultRunAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

// Date -> "YYYY-MM-DDTHH:mm" in LOCAL time (what datetime-local shows/returns).
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// ISO (UTC) -> local datetime-local value for editing an existing campaign.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return defaultRunAt();
  const d = new Date(iso);
  if (isNaN(d.getTime())) return defaultRunAt();
  return toLocalInput(d);
}

function draftFromCampaign(c: CampaignDTO): Draft {
  return {
    name: c.name,
    templateId: c.templateId,
    audienceId: c.audienceId,
    segmentId: c.segmentId ?? "",
    cadence: c.cadence,
    runAtLocal: isoToLocalInput(c.runAt),
    cron: c.cron ?? "0 9 * * 1",
  };
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENDING: "Sending",
  SENT: "Sent",
  PAUSED: "Paused",
};
const STATUS_CLASS: Record<CampaignStatus, string> = {
  DRAFT: "badge badge--draft",
  SCHEDULED: "badge badge--violet",
  SENDING: "badge badge--info",
  SENT: "badge badge--ok",
  PAUSED: "badge badge--warn",
};

const CADENCE_LABEL: Record<CampaignCadence, string> = {
  ONCE: "Once",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  CRON: "Custom (cron)",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function CampaignsPage() {
  const { can, loading: authLoading } = useAdminAuth();

  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateDTO[]>([]);
  const [audiences, setAudiences] = useState<AudienceDTO[]>([]);
  const [segments, setSegments] = useState<SegmentDTO[]>([]);
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
    () => campaigns.find((c) => c.id === selectedId) ?? null,
    [campaigns, selectedId],
  );
  const editorOpen = creating || !!selected;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, t, a] = await Promise.all([
        api.listCampaigns(),
        api.listEmailTemplates(),
        api.listAudiences(),
      ]);
      setCampaigns(c);
      setTemplates(t);
      setAudiences(a);
      setSelectedId((prev) =>
        prev && !c.some((row) => row.id === prev) ? null : prev,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load campaigns",
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

  // Segments are scoped to the chosen audience — refetch whenever it changes.
  // A stale segment selection is cleared if it doesn't belong to the new list.
  useEffect(() => {
    let cancelled = false;
    const audienceId = draft.audienceId;
    if (!audienceId) {
      setSegments([]);
      return;
    }
    api
      .listSegments(audienceId)
      .then((rows) => {
        if (cancelled) return;
        setSegments(rows);
        setDraft((d) =>
          d.segmentId && !rows.some((s) => s.id === d.segmentId)
            ? { ...d, segmentId: "" }
            : d,
        );
      })
      .catch(() => {
        if (!cancelled) setSegments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.audienceId]);

  function openEdit(c: CampaignDTO) {
    setCreating(false);
    setSelectedId(c.id);
    setDraft(draftFromCampaign(c));
    setEditorError(null);
  }

  function openCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraft({
      ...emptyDraft(),
      // Preselect the first template/audience so the form is usable immediately.
      templateId: templates[0]?.id ?? "",
      audienceId: audiences.find((a) => a.isDefault)?.id ?? audiences[0]?.id ?? "",
    });
    setEditorError(null);
  }

  function closeEditor() {
    setCreating(false);
    setSelectedId(null);
    setEditorError(null);
  }

  // Build the API body from the draft. runAt is only meaningful for non-CRON
  // cadences; cron only for CRON. We send both keys explicitly (with null to
  // clear) so switching cadence updates the stored shape.
  function draftToInput() {
    const isCron = draft.cadence === "CRON";
    const runAtIso =
      !isCron && draft.runAtLocal
        ? new Date(draft.runAtLocal).toISOString()
        : null;
    return {
      name: draft.name.trim() || "Untitled campaign",
      templateId: draft.templateId,
      audienceId: draft.audienceId,
      segmentId: draft.segmentId || null,
      cadence: draft.cadence,
      runAt: runAtIso,
      cron: isCron ? draft.cron.trim() : null,
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.templateId) {
      setEditorError("Pick a template.");
      return;
    }
    if (!draft.audienceId) {
      setEditorError("Pick an audience.");
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      if (creating) {
        const created = await api.createCampaign(draftToInput());
        await load();
        openEdit(created);
      } else if (selected) {
        const updated = await api.updateCampaign(selected.id, draftToInput());
        await load();
        setDraft(draftFromCampaign(updated));
      }
    } catch (err) {
      setEditorError(
        err instanceof ApiError ? err.message : "Failed to save campaign",
      );
    } finally {
      setSaving(false);
    }
  }

  // Row actions (schedule / pause / resume). Each refreshes the list and, when
  // the acted-on campaign is open in the editor, re-syncs the draft.
  async function runAction(
    c: CampaignDTO,
    fn: () => Promise<CampaignDTO>,
  ) {
    setBusyId(c.id);
    setError(null);
    try {
      const updated = await fn();
      await load();
      if (selectedId === c.id) setDraft(draftFromCampaign(updated));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: CampaignDTO) {
    const ok = await dialog.confirm({
      message: `Delete campaign "${c.name}"? This can't be undone.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteCampaign(c.id);
      if (selectedId === c.id) closeEditor();
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
          <h1>Campaigns</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  const templateName = (id: string) =>
    templates.find((t) => t.id === id)?.name ?? "—";
  const audienceName = (id: string) =>
    audiences.find((a) => a.id === id)?.name ?? "—";

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Campaigns</h1>
          <p className="subtitle">
            Scheduled email broadcasts to an audience (optionally a saved
            segment). Send once at a set time, or repeat weekly, monthly, or on a
            custom cron schedule. A built-in scheduler dispatches due campaigns
            every minute.
          </p>
        </div>
        {canCreate && (
          <div className="row-actions">
            <button className="btn" onClick={openCreate}>
              + New campaign
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
        {/* ---------------- Left: campaign list ---------------- */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <h2 style={{ fontSize: 16 }}>All campaigns</h2>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : campaigns.length === 0 ? (
            <p className="muted">
              No campaigns yet.{canCreate ? " Create one to begin." : ""}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Cadence</th>
                    <th>Next run</th>
                    <th style={{ textAlign: "right" }}>Sent</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const active = c.id === selectedId;
                    const busy = busyId === c.id;
                    return (
                      <tr
                        key={c.id}
                        style={
                          active
                            ? { background: "var(--surface-hover)" }
                            : undefined
                        }
                      >
                        <td>
                          <button
                            className="linklike"
                            onClick={() => openEdit(c)}
                            style={{ fontWeight: 600 }}
                          >
                            {c.name}
                          </button>
                          <div
                            className="muted"
                            style={{ fontSize: 12, marginTop: 2 }}
                          >
                            {templateName(c.templateId)} ·{" "}
                            {audienceName(c.audienceId)}
                          </div>
                        </td>
                        <td>
                          <span className={STATUS_CLASS[c.status]}>
                            {STATUS_LABEL[c.status]}
                          </span>
                        </td>
                        <td>{CADENCE_LABEL[c.cadence]}</td>
                        <td>{fmt(c.nextRunAt)}</td>
                        <td style={{ textAlign: "right" }}>{c.sentCount}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {canEdit &&
                            (c.status === "DRAFT" || c.status === "SENT") && (
                              <button
                                className="btn btn--sm"
                                disabled={busy}
                                onClick={() =>
                                  runAction(c, () => api.scheduleCampaign(c.id))
                                }
                              >
                                {busy ? "…" : "Schedule"}
                              </button>
                            )}
                          {canEdit && c.status === "SCHEDULED" && (
                            <button
                              className="btn btn--ghost btn--sm"
                              disabled={busy}
                              onClick={() =>
                                runAction(c, () => api.pauseCampaign(c.id))
                              }
                            >
                              {busy ? "…" : "Pause"}
                            </button>
                          )}
                          {canEdit && c.status === "PAUSED" && (
                            <button
                              className="btn btn--sm"
                              disabled={busy}
                              onClick={() =>
                                runAction(c, () => api.scheduleCampaign(c.id))
                              }
                            >
                              {busy ? "…" : "Resume"}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="btn btn--danger btn--sm"
                              style={{ marginLeft: 6 }}
                              onClick={() => remove(c)}
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
                {creating ? "New campaign" : `Editing: ${selected?.name}`}
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

            {!creating && selected && selected.status !== "DRAFT" && (
              <p className="muted" style={{ fontSize: 13 }}>
                This campaign is {STATUS_LABEL[selected.status].toLowerCase()}.
                Edits to a scheduled campaign re-arm its next run.
              </p>
            )}

            <div className="field">
              <label>Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. June newsletter"
                required
                disabled={!canEdit && !creating}
              />
            </div>

            <div className="form-row">
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
              <div className="field">
                <label>Audience</label>
                <select
                  value={draft.audienceId}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      audienceId: e.target.value,
                      segmentId: "",
                    })
                  }
                  disabled={!canEdit && !creating}
                  required
                >
                  <option value="">Select an audience…</option>
                  {audiences.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.subscribedCount} subscribed)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>
                Segment <span className="muted">(optional — narrows the audience)</span>
              </label>
              <select
                value={draft.segmentId}
                onChange={(e) =>
                  setDraft({ ...draft, segmentId: e.target.value })
                }
                disabled={(!canEdit && !creating) || segments.length === 0}
              >
                <option value="">Whole audience</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {typeof s.contactCount === "number"
                      ? ` (${s.contactCount})`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="field">
                <label>Cadence</label>
                <select
                  value={draft.cadence}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cadence: e.target.value as CampaignCadence,
                    })
                  }
                  disabled={!canEdit && !creating}
                >
                  {(
                    ["ONCE", "WEEKLY", "MONTHLY", "CRON"] as CampaignCadence[]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {CADENCE_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              {draft.cadence !== "CRON" ? (
                <div className="field">
                  <label>
                    {draft.cadence === "ONCE" ? "Send at" : "First run"}
                  </label>
                  <input
                    type="datetime-local"
                    value={draft.runAtLocal}
                    onChange={(e) =>
                      setDraft({ ...draft, runAtLocal: e.target.value })
                    }
                    disabled={!canEdit && !creating}
                  />
                </div>
              ) : (
                <div className="field">
                  <label>
                    Cron expression{" "}
                    <span className="muted">(min hour dom mon dow)</span>
                  </label>
                  <input
                    value={draft.cron}
                    onChange={(e) =>
                      setDraft({ ...draft, cron: e.target.value })
                    }
                    placeholder="0 9 * * 1"
                    spellCheck={false}
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                    disabled={!canEdit && !creating}
                  />
                </div>
              )}
            </div>

            {draft.cadence === "WEEKLY" || draft.cadence === "MONTHLY" ? (
              <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
                Recurs every {draft.cadence === "WEEKLY" ? "7 days" : "month"}{" "}
                after the first run.
              </p>
            ) : null}

            {!creating && selected && (
              <div
                className="muted"
                style={{ fontSize: 13, marginTop: 4, marginBottom: 8 }}
              >
                Status:{" "}
                <span className={STATUS_CLASS[selected.status]}>
                  {STATUS_LABEL[selected.status]}
                </span>{" "}
                · Sent {selected.sentCount} · Next run {fmt(selected.nextRunAt)} ·
                Last run {fmt(selected.lastRunAt)}
              </div>
            )}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 4,
              }}
            >
              {(canEdit || creating) && (
                <button className="btn" type="submit" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : creating
                      ? "Create campaign"
                      : "Save changes"}
                </button>
              )}
              {!creating &&
                selected &&
                canEdit &&
                (selected.status === "DRAFT" ||
                  selected.status === "SENT") && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busyId === selected.id}
                    onClick={() =>
                      runAction(selected, () =>
                        api.scheduleCampaign(selected.id),
                      )
                    }
                  >
                    Schedule
                  </button>
                )}
              {!creating &&
                selected &&
                canEdit &&
                selected.status === "SCHEDULED" && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busyId === selected.id}
                    onClick={() =>
                      runAction(selected, () => api.pauseCampaign(selected.id))
                    }
                  >
                    Pause
                  </button>
                )}
              {!creating &&
                selected &&
                canEdit &&
                selected.status === "PAUSED" && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busyId === selected.id}
                    onClick={() =>
                      runAction(selected, () =>
                        api.scheduleCampaign(selected.id),
                      )
                    }
                  >
                    Resume
                  </button>
                )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
