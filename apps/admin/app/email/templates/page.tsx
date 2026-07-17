"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { EmailTemplateDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAppBrand } from "@/lib/app-brand";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

// Editor draft. MJML + subject are Handlebars sources; `variables` is edited as
// a comma-separated string in the form and split on save.
type Draft = {
  name: string;
  subject: string;
  mjml: string;
  variablesCsv: string;
  category: string;
};

function draftFromTemplate(t: EmailTemplateDTO): Draft {
  return {
    name: t.name,
    subject: t.subject,
    mjml: t.mjml,
    variablesCsv: t.variables.join(", "),
    category: t.category ?? "",
  };
}

// A tasteful default MJML scaffold for a brand-new template, so the editor
// isn't a blank box. Uses the same violet accent as the system welcome mail.
const STARTER_MJML = `<mjml>
  <mj-body background-color="#f5f3fc">
    <mj-section background-color="#ffffff" border-radius="16px" padding="8px">
      <mj-column padding="24px">
        <mj-text font-size="22px" font-weight="700" color="#251f3d">
          Hello {{firstName}}
        </mj-text>
        <mj-text font-size="15px" line-height="1.7" color="#5a5470">
          Write your message here. Use {{handlebars}} placeholders for any
          variables you declare below.
        </mj-text>
        <mj-button href="{{url}}" background-color="#2f9d8e" border-radius="10px">
          Call to action
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

function emptyDraft(): Draft {
  return {
    name: "",
    subject: "Hello {{firstName}}",
    mjml: STARTER_MJML,
    variablesCsv: "firstName, url",
    category: "",
  };
}

function csvToList(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(",")) {
    const v = raw.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// Build a sample vars object from declared names, so Preview / Test send show
// something representative without the admin hand-typing JSON. `url` gets a real
// URL; everything else gets a humanized placeholder ("First name" → from FNAME).
// Brand-ish vars use THIS instance's AppConfig title so previews and test sends
// never leak another instance's brand.
function sampleVars(
  names: string[],
  brand: string | null
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const lower = n.toLowerCase();
    if (lower === "url" || lower.endsWith("url")) {
      out[n] = "https://example.com";
    } else if (lower.includes("first")) {
      out[n] = "Jane";
    } else if (lower.includes("last")) {
      out[n] = "Doe";
    } else if (lower.includes("brand") || lower.includes("site")) {
      out[n] = brand ?? "Your Academy";
    } else if (lower.includes("name")) {
      // Placeholder-by-convention, like the reserved example.com below — a
      // real person's name here would be borrowed identity in a preview the
      // admin can also send as a test email.
      out[n] = "Jane Doe";
    } else if (lower.includes("email")) {
      out[n] = "jane@example.com";
    } else {
      out[n] = `{${n}}`;
    }
  }
  return out;
}

export default function EmailTemplatesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  // This instance's brand for sample template vars (preview + test send).
  const brand = useAppBrand();

  const [templates, setTemplates] = useState<EmailTemplateDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // editor: which template is selected ("new" = creating); the working draft.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // preview: the rendered HTML shown in the iframe, plus the resolved subject.
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string>("");
  const [previewing, setPreviewing] = useState(false);

  const canCreate = can("email", "create");
  const canEdit = can("email", "edit");
  const canDelete = can("email", "delete");

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  // Reload the list. If the currently-selected template vanished (e.g. deleted),
  // drop the selection so the editor closes; otherwise leave it untouched (the
  // editor keeps the live draft — list rows are just a navigator).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listEmailTemplates();
      setTemplates(rows);
      setSelectedId((prev) =>
        prev && !rows.some((r) => r.id === prev) ? null : prev,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load templates",
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

  // Open an existing template in the editor.
  function openEdit(t: EmailTemplateDTO) {
    setCreating(false);
    setSelectedId(t.id);
    setDraft(draftFromTemplate(t));
    setEditorError(null);
    setPreviewHtml(null);
    setPreviewSubject("");
  }

  // Start a fresh (custom) template.
  function openCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft());
    setEditorError(null);
    setPreviewHtml(null);
    setPreviewSubject("");
  }

  function closeEditor() {
    setCreating(false);
    setSelectedId(null);
    setPreviewHtml(null);
    setPreviewSubject("");
  }

  const editorOpen = creating || !!selected;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setEditorError(null);
    const variables = csvToList(draft.variablesCsv);
    try {
      if (creating) {
        const created = await api.createEmailTemplate({
          name: draft.name.trim(),
          subject: draft.subject,
          mjml: draft.mjml,
          variables,
          category: draft.category.trim() || undefined,
        });
        await load();
        openEdit(created);
      } else if (selected) {
        const updated = await api.updateEmailTemplate(selected.id, {
          name: draft.name.trim(),
          subject: draft.subject,
          mjml: draft.mjml,
          variables,
          category: draft.category.trim() || undefined,
        });
        await load();
        setDraft(draftFromTemplate(updated));
      }
    } catch (err) {
      setEditorError(
        err instanceof ApiError ? err.message : "Failed to save template",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: EmailTemplateDTO) {
    if (t.isSystem) {
      await dialog.notify(
        `"${t.name}" is a system template (sent automatically) and can't be deleted. You can still edit its content.`,
      );
      return;
    }
    const ok = await dialog.confirm({
      message: `Delete template "${t.name}"?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteEmailTemplate(t.id);
      if (selectedId === t.id) closeEditor();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  // Render the CURRENT draft (ad-hoc; no save required) with sample vars and
  // show the HTML in the iframe.
  async function preview() {
    setPreviewing(true);
    setEditorError(null);
    try {
      const res = await api.previewEmailTemplate({
        subject: draft.subject,
        mjml: draft.mjml,
        vars: sampleVars(csvToList(draft.variablesCsv), brand),
      });
      setPreviewHtml(res.html);
      setPreviewSubject(res.subject);
    } catch (err) {
      setPreviewHtml(null);
      setEditorError(
        err instanceof ApiError
          ? err.message
          : "Preview failed — check your MJML.",
      );
    } finally {
      setPreviewing(false);
    }
  }

  // Send a real test of the SAVED template. Only meaningful for an existing row
  // (a brand-new draft must be saved first to get an id).
  async function testSend() {
    if (!selected) {
      await dialog.notify("Save the template first, then send a test.");
      return;
    }
    const to = await dialog.prompt({
      message: "Send a test of this template to which email address?",
      placeholder: "you@example.com",
      confirmLabel: "Send test",
    });
    if (!to || !to.trim()) return;
    try {
      const res = await api.testSendEmailTemplate(selected.id, {
        to: to.trim(),
        vars: sampleVars(selected.variables, brand),
      });
      if (res.status === "SENT") {
        await dialog.notify(`Test sent to ${res.to}.`);
      } else {
        await dialog.notify(
          `Test ${res.status.toLowerCase()}${
            res.error ? `: ${res.error}` : ""
          }. Check your email/SMTP settings under Settings → Email.`,
        );
      }
    } catch (err) {
      await dialog.notify(
        err instanceof ApiError ? err.message : "Failed to send test",
      );
    }
  }

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("email", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Email</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Email templates</h1>
          <p className="subtitle">
            Reusable email templates built with MJML (responsive, client-safe
            markup) and <code>{"{{handlebars}}"}</code> merge variables. System
            templates (like the signup welcome) are sent automatically; add your
            own for campaigns and automations.
          </p>
        </div>
        {canCreate && (
          <div className="row-actions">
            <button className="btn" onClick={openCreate}>
              + New template
            </button>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 300px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ---------------- Left: template list ---------------- */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <h2 style={{ fontSize: 16 }}>Templates</h2>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="muted">
              No templates yet.{canCreate ? " Create one to begin." : ""}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {templates.map((t) => {
                const active = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    onClick={() => openEdit(t)}
                    className="nav-link"
                    style={{
                      textAlign: "left",
                      width: "100%",
                      cursor: "pointer",
                      background: active
                        ? "var(--surface-hover)"
                        : "transparent",
                      border: active
                        ? "1px solid var(--border-strong)"
                        : "1px solid transparent",
                      display: "block",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.name}
                      </span>
                      {t.isSystem && (
                        <span className="badge badge--violet">System</span>
                      )}
                    </div>
                    <div
                      className="muted"
                      style={{ fontSize: 12, marginTop: 2 }}
                    >
                      {t.category || "custom"}
                      {t.variables.length > 0 &&
                        ` · ${t.variables.length} var${
                          t.variables.length === 1 ? "" : "s"
                        }`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ---------------- Right: editor ---------------- */}
        <div style={{ minWidth: 0 }}>
          {!editorOpen ? (
            <div className="card" style={{ margin: 0 }}>
              <p className="muted">
                Select a template on the left to edit it
                {canCreate ? ", or create a new one" : ""}.
              </p>
            </div>
          ) : (
            <form className="card" style={{ margin: 0 }} onSubmit={save}>
              <div className="card-head">
                <h2 style={{ fontSize: 16 }}>
                  {creating
                    ? "New template"
                    : selected?.isSystem
                      ? `Editing system template: ${selected?.name}`
                      : `Editing: ${selected?.name}`}
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

              <div className="form-row">
                <div className="field">
                  <label>Name</label>
                  <input
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    placeholder="e.g. Monthly newsletter"
                    required
                    disabled={!canEdit && !creating}
                  />
                </div>
                <div className="field">
                  <label>
                    Category <span className="muted">(optional)</span>
                  </label>
                  <input
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({ ...draft, category: e.target.value })
                    }
                    placeholder="e.g. marketing"
                    disabled={!canEdit && !creating}
                  />
                </div>
              </div>

              <div className="field">
                <label>
                  Subject{" "}
                  <span className="muted">(Handlebars — e.g. {"{{brand}}"})</span>
                </label>
                <input
                  value={draft.subject}
                  onChange={(e) =>
                    setDraft({ ...draft, subject: e.target.value })
                  }
                  required
                  disabled={!canEdit && !creating}
                />
              </div>

              <div className="field">
                <label>
                  Variables{" "}
                  <span className="muted">
                    (comma-separated merge-var names)
                  </span>
                </label>
                <input
                  value={draft.variablesCsv}
                  onChange={(e) =>
                    setDraft({ ...draft, variablesCsv: e.target.value })
                  }
                  placeholder="firstName, brand, url"
                  disabled={!canEdit && !creating}
                />
              </div>

              <div className="field">
                <label>
                  MJML source{" "}
                  <span className="muted">
                    (
                    <a
                      href="https://documentation.mjml.io/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      MJML
                    </a>{" "}
                    + Handlebars placeholders)
                  </span>
                </label>
                <textarea
                  value={draft.mjml}
                  onChange={(e) =>
                    setDraft({ ...draft, mjml: e.target.value })
                  }
                  rows={16}
                  spellCheck={false}
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    lineHeight: 1.5,
                    width: "100%",
                    resize: "vertical",
                  }}
                  required
                  disabled={!canEdit && !creating}
                />
              </div>

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
                        ? "Create template"
                        : "Save changes"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={preview}
                  disabled={previewing}
                >
                  {previewing ? "Rendering…" : "Preview"}
                </button>
                {!creating && selected && canEdit && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={testSend}
                  >
                    Send test…
                  </button>
                )}
                {!creating && selected && !selected.isSystem && canDelete && (
                  <button
                    type="button"
                    className="btn btn--danger"
                    style={{ marginLeft: "auto" }}
                    onClick={() => remove(selected)}
                  >
                    Delete
                  </button>
                )}
              </div>

              {/* ---------------- Preview ---------------- */}
              {previewHtml !== null && (
                <div style={{ marginTop: 18 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <h3 style={{ fontSize: 14, margin: 0 }}>Preview</h3>
                    <span className="muted" style={{ fontSize: 13 }}>
                      Subject: {previewSubject || "—"}
                    </span>
                  </div>
                  <iframe
                    title="Email preview"
                    srcDoc={previewHtml}
                    sandbox=""
                    style={{
                      width: "100%",
                      height: 520,
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      background: "#fff",
                    }}
                  />
                  <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Rendered with sample values for{" "}
                    {csvToList(draft.variablesCsv).length > 0
                      ? csvToList(draft.variablesCsv).join(", ")
                      : "your variables"}
                    .
                  </p>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
