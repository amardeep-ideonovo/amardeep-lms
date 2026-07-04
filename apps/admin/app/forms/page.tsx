"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import type {
  FormAdminRow,
  FormFieldDef,
  FormFieldType,
  FormStatus,
  FormSubmissionDTO,
  AudienceDTO,
  AudienceFieldDTO,
  CreateFormInput,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

// Escape one CSV cell (quote if it contains a comma/quote/newline).
function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Human-readable cell value for the on-screen table (booleans → Yes/No).
function cellText(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return v === undefined || v === null ? "" : String(v);
}

// Build + download a CSV of a form's submissions. Columns come from the form's
// own field definitions (stable order) plus the email + subscribe status + date.
function exportSubmissionsCsv(form: FormAdminRow, rows: FormSubmissionDTO[]) {
  const fieldNames = form.fields.map((f) => f.name);
  const header = [
    "Submitted at",
    "Email",
    ...form.fields.map((f) => f.label || f.name),
    "Subscribe status",
  ];
  const lines = [
    header,
    ...rows.map((r) => [
      r.createdAt,
      r.email ?? "",
      ...fieldNames.map((n) => r.data?.[n] ?? ""),
      r.subscribeStatus ?? "",
    ]),
  ];
  const csv = lines.map((cols) => cols.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${form.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-submissions.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const FIELD_TYPES: FormFieldType[] = [
  "text",
  "email",
  "textarea",
  "phone",
  "number",
  "checkbox",
  "select",
];

// Fallback merge tags when an audience has no custom fields yet (so mapping still
// works). EMAIL is always offered explicitly here — the audience fields endpoint
// treats it as implicit and never returns it.
const FALLBACK_MERGE: AudienceFieldDTO[] = [
  { tag: "EMAIL", label: "Email Address", type: "email", required: true },
  { tag: "FNAME", label: "First Name", type: "text", required: false },
  { tag: "LNAME", label: "Last Name", type: "text", required: false },
  { tag: "PHONE", label: "Phone", type: "phone", required: false },
];

// The implicit email merge tag, always available to map a field to.
const EMAIL_MERGE: AudienceFieldDTO = {
  tag: "EMAIL",
  label: "Email Address",
  type: "email",
  required: true,
};

const uid = () => Math.random().toString(36).slice(2, 9);
const slugifyKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3000";
const WEB_URL =
  process.env.NEXT_PUBLIC_WEB_URL?.replace(/\/$/, "") || "http://localhost:3002";

// Read-only render of one field for the live preview canvas.
function previewField(fld: FormFieldDef) {
  const base: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    width: "100%",
    font: "inherit",
    background: "var(--surface-2)",
  };
  if (fld.type === "textarea")
    return (
      <textarea disabled placeholder={fld.placeholder} style={{ ...base, minHeight: 56 }} />
    );
  if (fld.type === "checkbox")
    return (
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
        <input type="checkbox" disabled /> {fld.label}
        {fld.required ? " *" : ""}
      </label>
    );
  if (fld.type === "select")
    return (
      <select disabled style={base}>
        <option>{fld.placeholder || "Select…"}</option>
        {(fld.options ?? []).map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  const t =
    fld.type === "email"
      ? "email"
      : fld.type === "phone"
      ? "tel"
      : fld.type === "number"
      ? "number"
      : "text";
  return <input disabled type={t} placeholder={fld.placeholder} style={base} />;
}

type EditorState = {
  name: string;
  fields: FormFieldDef[];
  audienceId: string;
  audienceName: string;
  doubleOptIn: boolean;
  updateExisting: boolean;
  tags: string;
  successMessage: string;
  redirectUrl: string;
  afterSubmit: "message" | "redirect";
  status: FormStatus;
};

function newForm(): EditorState {
  return {
    name: "Untitled form",
    fields: [
      { id: uid(), type: "email", label: "Email", name: "email", required: true, mergeTag: "EMAIL" },
      { id: uid(), type: "text", label: "Name", name: "name", required: false, mergeTag: "FNAME" },
    ],
    audienceId: "",
    audienceName: "",
    doubleOptIn: false, // default: No
    updateExisting: true, // default: Yes
    tags: "",
    successMessage: "Thanks! You're subscribed.",
    redirectUrl: "",
    afterSubmit: "message",
    status: "ACTIVE",
  };
}

export default function FormsPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [forms, setForms] = useState<FormAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditorState>(newForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [audiences, setAudiences] = useState<AudienceDTO[]>([]);
  const [audiencesError, setAudiencesError] = useState<string | null>(null);
  const [mergeFields, setMergeFields] = useState<AudienceFieldDTO[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Entries (submissions) viewer modal state.
  const [entriesForm, setEntriesForm] = useState<FormAdminRow | null>(null);
  const [entries, setEntries] = useState<FormSubmissionDTO[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  async function openEntries(f: FormAdminRow) {
    setEntriesForm(f);
    setEntries([]);
    setEntriesError(null);
    setEntriesLoading(true);
    try {
      setEntries(await api.listFormSubmissions(f.id));
    } catch (err) {
      setEntriesError(
        err instanceof ApiError ? err.message : "Failed to load submissions"
      );
    } finally {
      setEntriesLoading(false);
    }
  }
  function closeEntries() {
    setEntriesForm(null);
    setEntries([]);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setForms(await api.listForms());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load forms");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (authLoading || !can("forms", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Fetch the in-house audience list (and merge fields for a chosen audience).
  // On error (e.g. forbidden) we keep the picker usable with just the default
  // audience option, with a plain error text.
  const loadAudiences = useCallback(async () => {
    setAudiencesError(null);
    try {
      setAudiences(await api.listAudiences());
    } catch {
      setAudiences([]);
      setAudiencesError(
        "Could not load audiences — new submissions still go to the default audience."
      );
    }
  }, []);

  // Merge tags come from the chosen audience's in-house fields. EMAIL is implicit
  // (never returned by the fields endpoint) so we always prepend it. With no
  // audience selected, fall back to the static list so mapping still works.
  const loadMergeFields = useCallback(async (audienceId: string) => {
    if (!audienceId) {
      setMergeFields([]);
      return;
    }
    try {
      const fields = await api.listFormMergeFields(audienceId);
      setMergeFields([EMAIL_MERGE, ...fields.filter((f) => f.tag !== "EMAIL")]);
    } catch {
      setMergeFields([]);
    }
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(newForm());
    setFormError(null);
    setMergeFields([]);
    setMode("edit");
    loadAudiences();
  }

  async function openEdit(id: string) {
    setFormError(null);
    setMode("edit");
    loadAudiences();
    try {
      const f = await api.getForm(id);
      setEditingId(f.id);
      setForm({
        name: f.name,
        fields: f.fields,
        audienceId: f.audienceId ?? "",
        audienceName: f.audienceName ?? "",
        doubleOptIn: f.doubleOptIn,
        updateExisting: f.updateExisting,
        tags: f.tags.join(", "),
        successMessage: f.successMessage ?? "",
        redirectUrl: f.redirectUrl ?? "",
        afterSubmit: f.redirectUrl ? "redirect" : "message",
        status: f.status,
      });
      if (f.audienceId) loadMergeFields(f.audienceId);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to load form");
    }
  }

  function backToList() {
    setMode("list");
    setEditingId(null);
    load();
  }

  function onSelectAudience(id: string) {
    const a = audiences.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      audienceId: id,
      audienceName: a?.name ?? "",
    }));
    loadMergeFields(id);
  }

  // ----- field builder -----
  function addField() {
    setForm((f) => ({
      ...f,
      fields: [
        ...f.fields,
        { id: uid(), type: "text", label: "New field", name: `field_${f.fields.length + 1}`, required: false, mergeTag: "" },
      ],
    }));
  }
  function patchField(i: number, patch: Partial<FormFieldDef>) {
    setForm((f) => ({
      ...f,
      fields: f.fields.map((fld, idx) => (idx === i ? { ...fld, ...patch } : fld)),
    }));
  }
  function removeField(i: number) {
    setForm((f) => ({ ...f, fields: f.fields.filter((_, idx) => idx !== i) }));
  }
  function moveField(i: number, dir: -1 | 1) {
    setForm((f) => {
      const next = [...f.fields];
      const j = i + dir;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, fields: next };
    });
  }
  // Move a field to an arbitrary index (drag-and-drop on the preview canvas).
  function reorder(from: number, to: number) {
    setForm((f) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= f.fields.length ||
        to >= f.fields.length
      )
        return f;
      const next = [...f.fields];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return { ...f, fields: next };
    });
  }
  function copyText(t: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard)
      navigator.clipboard.writeText(t).catch(() => {});
  }

  function buildPayload(): CreateFormInput {
    return {
      name: form.name.trim() || "Untitled form",
      fields: form.fields,
      audienceId: form.audienceId || undefined,
      doubleOptIn: form.doubleOptIn,
      updateExisting: form.updateExisting,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      successMessage: form.successMessage.trim() || undefined,
      // Clear the redirect when "show message" is chosen so the message shows;
      // set it (and message stays as a stored fallback) when "redirect" is chosen.
      redirectUrl:
        form.afterSubmit === "redirect" ? form.redirectUrl.trim() || "" : "",
      status: form.status,
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) await api.updateForm(editingId, buildPayload());
      else await api.createForm(buildPayload());
      backToList();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to save form");
    } finally {
      setSaving(false);
    }
  }

  async function remove(f: FormAdminRow) {
    if (
      !(await dialog.confirm({
        message: `Delete "${f.name}"? Its submissions are removed too.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api.deleteForm(f.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete form");
    }
  }

  function copyId(id: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(id).catch(() => {});
    }
  }

  const mergeOptions = mergeFields.length ? mergeFields : FALLBACK_MERGE;

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("forms", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Forms</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  // ---------------- list view ----------------
  if (mode === "list") {
    return (
      <div>
        <div className="page-header with-action">
          <div>
            <h1>Forms</h1>
            <p className="subtitle">
              Build forms linked to an audience. Submissions subscribe the person
              to that audience and are stored here too. Embed a form with its id
              (Puck “Form” block, the <code>&lt;FormEmbed&gt;</code>{" "}
              component, or <code>/forms/&lt;id&gt;</code>).
            </p>
          </div>
          <button className="btn" onClick={openCreate}>
            + Add new form
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="card">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : forms.length === 0 ? (
            <p className="muted">No forms yet. Click “Add new form” to start.</p>
          ) : (
            <div className="table-wrap"><table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Audience</th>
                  <th>Fields</th>
                  <th>Submissions</th>
                  <th>Status</th>
                  <th>Embed id</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {forms.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td className="muted">{f.audienceName ?? "Default (Members)"}</td>
                    <td className="muted">{f.fields.length}</td>
                    <td className="muted">{f.submissionCount}</td>
                    <td>
                      <span
                        className={
                          f.status === "ACTIVE"
                            ? "badge badge--published"
                            : "badge badge--draft"
                        }
                      >
                        {f.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <code style={{ fontSize: 12 }}>{f.id}</code>{" "}
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => copyId(f.id)}
                        title="Copy form id"
                      >
                        Copy
                      </button>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => openEntries(f)}
                        >
                          Entries ({f.submissionCount})
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => openEdit(f.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => remove(f)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        {entriesForm && (
          <div
            onClick={closeEntries}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15,23,42,0.45)",
              zIndex: 1000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--surface)",
                borderRadius: 12,
                width: "min(900px, 96vw)",
                maxHeight: "86vh",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 16px 48px rgba(15,23,42,0.3)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <strong>{entriesForm.name}</strong>{" "}
                  <span className="muted">
                    — {entries.length} submission
                    {entries.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={entries.length === 0}
                    onClick={() => exportSubmissionsCsv(entriesForm, entries)}
                  >
                    Export CSV
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={closeEntries}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div style={{ overflow: "auto", padding: 18 }}>
                {entriesLoading ? (
                  <p className="muted">Loading…</p>
                ) : entriesError ? (
                  <p className="error">{entriesError}</p>
                ) : entries.length === 0 ? (
                  <p className="muted">No submissions yet.</p>
                ) : (
                  <div className="table-wrap"><table className="table">
                    <thead>
                      <tr>
                        <th>Submitted</th>
                        <th>Email</th>
                        {entriesForm.fields.map((f) => (
                          <th key={f.id}>{f.label || f.name}</th>
                        ))}
                        <th>Subscribe status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((r) => (
                        <tr key={r.id}>
                          <td className="muted">
                            {new Date(r.createdAt).toLocaleString()}
                          </td>
                          <td>{r.email ?? "—"}</td>
                          {entriesForm.fields.map((f) => (
                            <td key={f.id}>{cellText(r.data?.[f.name])}</td>
                          ))}
                          <td className="muted">{r.subscribeStatus ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------- editor view ----------------
  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>{editingId ? "Edit form" : "New form"}</h1>
          <p className="subtitle">
            Map each field to an audience merge tag. The field mapped to{" "}
            <code>EMAIL</code> is the subscriber’s email.
          </p>
        </div>
        <button className="btn btn--ghost" onClick={backToList}>
          ← Back to forms
        </button>
      </div>

      {formError && <p className="error">{formError}</p>}

      <form onSubmit={save}>
        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 440px", minWidth: 0 }}>
        <div className="card">
          <div className="field">
            <label>Form name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label>Audience</label>
            <select
              value={form.audienceId}
              onChange={(e) => onSelectAudience(e.target.value)}
            >
              <option value="">— None (use the default audience) —</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.isDefault ? " (default)" : ""} ({a.subscribedCount})
                </option>
              ))}
            </select>
            {audiencesError ? (
              <p className="muted" style={{ marginTop: 4 }}>
                {audiencesError}
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 4 }}>
                Submissions subscribe the person to this audience. Leave on “None”
                to use the default “Members” audience.
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Fields</h2>
            <button type="button" className="btn btn--sm" onClick={addField}>
              + Add field
            </button>
          </div>
          {form.fields.length === 0 && (
            <p className="muted">No fields yet — add one.</p>
          )}
          {form.fields.map((fld, i) => (
            <div
              key={fld.id}
              className="card"
              style={{ background: "var(--bg)" }}
            >
              <div className="form-row">
                <div className="field">
                  <label>Label</label>
                  <input
                    value={fld.label}
                    onChange={(e) =>
                      patchField(i, {
                        label: e.target.value,
                        // keep key in sync if it was auto-derived
                        name:
                          fld.name === slugifyKey(fld.label)
                            ? slugifyKey(e.target.value)
                            : fld.name,
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>Key</label>
                  <input
                    value={fld.name}
                    onChange={(e) =>
                      patchField(i, { name: slugifyKey(e.target.value) })
                    }
                  />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select
                    value={fld.type}
                    onChange={(e) =>
                      patchField(i, { type: e.target.value as FormFieldType })
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="field">
                  <label>Audience field</label>
                  <select
                    value={fld.mergeTag ?? ""}
                    onChange={(e) => patchField(i, { mergeTag: e.target.value })}
                  >
                    <option value="">— not synced —</option>
                    {mergeOptions.map((m) => (
                      <option key={m.tag} value={m.tag}>
                        {m.label} ({m.tag})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Required</label>
                  <select
                    value={fld.required ? "yes" : "no"}
                    onChange={(e) =>
                      patchField(i, { required: e.target.value === "yes" })
                    }
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>
                {fld.type === "select" && (
                  <div className="field">
                    <label>Options (comma-separated)</label>
                    <input
                      value={(fld.options ?? []).join(", ")}
                      onChange={(e) =>
                        patchField(i, {
                          options: e.target.value
                            .split(",")
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => moveField(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => moveField(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={() => removeField(i)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Subscribe behaviour</h2>
          <div className="form-row">
            <div className="field">
              <label>Use double opt-in?</label>
              <select
                value={form.doubleOptIn ? "yes" : "no"}
                onChange={(e) =>
                  setForm({ ...form, doubleOptIn: e.target.value === "yes" })
                }
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div className="field">
              <label>Update existing subscribers?</label>
              <select
                value={form.updateExisting ? "yes" : "no"}
                onChange={(e) =>
                  setForm({ ...form, updateExisting: e.target.value === "yes" })
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>
              Subscriber tags <span className="muted">(comma-separated)</span>
            </label>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="e.g. lead, webinar"
            />
          </div>
        </div>

        <div className="card">
          <h2>After submit</h2>
          <div className="field">
            <label>When the form is submitted</label>
            <select
              value={form.afterSubmit}
              onChange={(e) =>
                setForm({
                  ...form,
                  afterSubmit: e.target.value as "message" | "redirect",
                })
              }
            >
              <option value="message">Show a thank-you message</option>
              <option value="redirect">Redirect to another page (URL)</option>
            </select>
          </div>

          {form.afterSubmit === "message" ? (
            <div className="field">
              <label>Thank-you message</label>
              <textarea
                value={form.successMessage}
                onChange={(e) =>
                  setForm({ ...form, successMessage: e.target.value })
                }
                style={{ minHeight: 60 }}
                placeholder="Thanks! You're subscribed."
              />
            </div>
          ) : (
            <div className="field">
              <label>Redirect URL</label>
              <input
                value={form.redirectUrl}
                onChange={(e) =>
                  setForm({ ...form, redirectUrl: e.target.value })
                }
                placeholder="https://example.com/thank-you"
              />
              <p className="muted" style={{ marginTop: 4 }}>
                The visitor is sent here after a successful submit — use a full
                URL (including https://).
              </p>
            </div>
          )}

          <div className="field">
            <label>Status</label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as FormStatus })
              }
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>
          </div>

          <div
            style={{
              flex: "1 1 360px",
              minWidth: 0,
              position: "sticky",
              top: 16,
              alignSelf: "flex-start",
            }}
          >
            <div className="card">
              <div className="card-head">
                <h2>Live preview</h2>
                <span className="muted" style={{ fontSize: 12 }}>
                  drag ⠿ to reorder
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {form.fields.length === 0 && (
                  <p className="muted">Add fields to see them here.</p>
                )}
                {form.fields.map((fld, i) => (
                  <div
                    key={fld.id}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) reorder(dragIndex, i);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background:
                        dragIndex === i
                          ? "var(--surface-hover)"
                          : "var(--surface-2)",
                    }}
                  >
                    <span
                      title="Drag to reorder"
                      style={{
                        cursor: "grab",
                        color: "var(--muted)",
                        userSelect: "none",
                        paddingTop: fld.type === "checkbox" ? 0 : 22,
                      }}
                    >
                      ⠿
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {fld.type !== "checkbox" && (
                        <label
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            display: "block",
                            marginBottom: 4,
                          }}
                        >
                          {fld.label}
                          {fld.required ? " *" : ""}
                        </label>
                      )}
                      {previewField(fld)}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  disabled
                  className="btn"
                  style={{ alignSelf: "flex-start", opacity: 0.7 }}
                >
                  Submit
                </button>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  {form.afterSubmit === "redirect"
                    ? `On submit → redirect to ${form.redirectUrl || "(set a URL)"}`
                    : `On submit → “${form.successMessage || "Thanks!"}”`}
                </p>
              </div>
            </div>

            <div className="card">
              <h2>Embed code</h2>
              {editingId ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    {
                      label: "Paste anywhere (script)",
                      code: `<script src="${API_URL}/forms/${editingId}/embed.js"></script>`,
                    },
                    { label: "Page builder — Form block id", code: editingId },
                    {
                      label: "React component",
                      code: `<FormEmbed formId="${editingId}" />`,
                    },
                    { label: "Direct link", code: `${WEB_URL}/forms/${editingId}` },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="card-head" style={{ marginBottom: 4 }}>
                        <label style={{ fontSize: 13, fontWeight: 500 }}>
                          {row.label}
                        </label>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => copyText(row.code)}
                        >
                          Copy
                        </button>
                      </div>
                      <code
                        style={{
                          display: "block",
                          padding: "8px 10px",
                          background: "var(--bg)",
                          borderRadius: 6,
                          fontSize: 12,
                          wordBreak: "break-all",
                        }}
                      >
                        {row.code}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Save the form to get its embed code.</p>
              )}
            </div>
          </div>
        </div>

        <div className="row-actions" style={{ marginTop: 16 }}>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create form"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={backToList}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
