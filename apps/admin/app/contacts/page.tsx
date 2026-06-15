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
  AudienceFieldDTO,
  ContactDTO,
  ContactListDTO,
  ContactStatus,
  SegmentDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

// Contact status options (mirrors the ContactStatus enum) + a label/badge map.
const STATUSES: ContactStatus[] = [
  "SUBSCRIBED",
  "PENDING",
  "UNSUBSCRIBED",
  "CLEANED",
];
const STATUS_LABEL: Record<ContactStatus, string> = {
  SUBSCRIBED: "Subscribed",
  PENDING: "Pending",
  UNSUBSCRIBED: "Unsubscribed",
  CLEANED: "Cleaned",
};
const STATUS_BADGE: Record<ContactStatus, string> = {
  SUBSCRIBED: "badge--ok",
  PENDING: "badge--warn",
  UNSUBSCRIBED: "badge--neutral",
  CLEANED: "badge--danger",
};

const PAGE_SIZE = 50;

// Editor state for the contact create/edit modal.
type ContactDraft = {
  email: string;
  firstName: string;
  lastName: string;
  status: ContactStatus;
  tags: string; // comma-separated in the form
};

function draftFromContact(c: ContactDTO): ContactDraft {
  return {
    email: c.email,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    status: c.status,
    tags: c.tags.join(", "),
  };
}
function emptyDraft(): ContactDraft {
  return {
    email: "",
    firstName: "",
    lastName: "",
    status: "SUBSCRIBED",
    tags: "",
  };
}
function tagsFromString(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function ContactsPage() {
  const { can, loading: authLoading } = useAdminAuth();

  // ----- audiences (left rail) -----
  const [audiences, setAudiences] = useState<AudienceDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingAudiences, setLoadingAudiences] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ----- contacts (right, table) -----
  const [list, setList] = useState<ContactListDTO | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  // filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContactStatus | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(1);

  // ----- contact editor modal -----
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(emptyDraft());
  const [savingContact, setSavingContact] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // ----- side panels (fields + segments) -----
  const [fields, setFields] = useState<AudienceFieldDTO[]>([]);
  const [segments, setSegments] = useState<SegmentDTO[]>([]);

  const canCreate = can("contacts", "create");
  const canEdit = can("contacts", "edit");
  const canDelete = can("contacts", "delete");

  const selected = useMemo(
    () => audiences.find((a) => a.id === selectedId) ?? null,
    [audiences, selectedId],
  );

  // ---- loaders ----
  const loadAudiences = useCallback(async (keepSelection = true) => {
    setLoadingAudiences(true);
    setError(null);
    try {
      const rows = await api.listAudiences();
      setAudiences(rows);
      setSelectedId((prev) => {
        if (keepSelection && prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load audiences",
      );
    } finally {
      setLoadingAudiences(false);
    }
  }, []);

  const loadContacts = useCallback(
    async (audienceId: string) => {
      setLoadingContacts(true);
      setContactsError(null);
      try {
        const res = await api.listContacts(audienceId, {
          status: statusFilter || undefined,
          tag: tagFilter || undefined,
          q: debouncedSearch || undefined,
          page,
          pageSize: PAGE_SIZE,
        });
        setList(res);
      } catch (err) {
        setContactsError(
          err instanceof ApiError ? err.message : "Failed to load contacts",
        );
        setList(null);
      } finally {
        setLoadingContacts(false);
      }
    },
    [statusFilter, tagFilter, debouncedSearch, page],
  );

  const loadPanels = useCallback(async (audienceId: string) => {
    try {
      const [f, s] = await Promise.all([
        api.listAudienceFields(audienceId),
        api.listSegments(audienceId),
      ]);
      setFields(f);
      setSegments(s);
    } catch {
      setFields([]);
      setSegments([]);
    }
  }, []);

  // Initial load (once auth resolves + permission present).
  useEffect(() => {
    if (authLoading || !can("contacts", "read")) return;
    loadAudiences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Debounce the search box (250ms) and reset to page 1 on a new query.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever a non-search filter changes.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, tagFilter, selectedId]);

  // Fetch contacts + side panels whenever the selection or filters change.
  useEffect(() => {
    if (!selectedId) {
      setList(null);
      setFields([]);
      setSegments([]);
      return;
    }
    loadContacts(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, statusFilter, tagFilter, debouncedSearch, page]);

  useEffect(() => {
    if (selectedId) loadPanels(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // After a mutation: refresh the contact list, the audience counts, and panels.
  async function refreshAll() {
    if (selectedId) {
      await Promise.all([loadContacts(selectedId), loadPanels(selectedId)]);
    }
    await loadAudiences();
  }

  // ---- audience actions ----
  async function createAudience() {
    const name = await dialog.prompt({
      message: "New audience name",
      placeholder: "e.g. Newsletter",
      confirmLabel: "Create",
    });
    if (!name || !name.trim()) return;
    try {
      const created = await api.createAudience({ name: name.trim() });
      await loadAudiences(false);
      setSelectedId(created.id);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create audience",
      );
    }
  }

  async function makeDefault(a: AudienceDTO) {
    if (a.isDefault) return;
    try {
      await api.updateAudience(a.id, { isDefault: true });
      await loadAudiences();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to set default",
      );
    }
  }

  async function renameAudience(a: AudienceDTO) {
    const name = await dialog.prompt({
      message: "Rename audience",
      defaultValue: a.name,
      confirmLabel: "Save",
    });
    if (!name || !name.trim() || name.trim() === a.name) return;
    try {
      await api.updateAudience(a.id, { name: name.trim() });
      await loadAudiences();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to rename");
    }
  }

  async function deleteAudience(a: AudienceDTO) {
    if (a.isDefault) {
      await dialog.notify(
        "This is the default audience. Make another audience the default before deleting it.",
      );
      return;
    }
    const ok = await dialog.confirm({
      message: `Delete audience "${a.name}"? Its ${a.contactCount} contact(s), fields and segments are removed too.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteAudience(a.id);
      await loadAudiences(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  // ---- contact editor ----
  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setEditorError(null);
    setEditorOpen(true);
  }
  function openEdit(c: ContactDTO) {
    setEditingId(c.id);
    setDraft(draftFromContact(c));
    setEditorError(null);
    setEditorOpen(true);
  }
  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
  }

  async function saveContact(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setSavingContact(true);
    setEditorError(null);
    try {
      if (editingId) {
        await api.updateContact(editingId, {
          email: draft.email.trim(),
          firstName: draft.firstName.trim() || null,
          lastName: draft.lastName.trim() || null,
          status: draft.status,
          tags: tagsFromString(draft.tags),
        });
      } else {
        await api.createContact(selectedId, {
          email: draft.email.trim(),
          firstName: draft.firstName.trim() || undefined,
          lastName: draft.lastName.trim() || undefined,
          status: draft.status,
          tags: tagsFromString(draft.tags),
        });
      }
      closeEditor();
      await refreshAll();
    } catch (err) {
      setEditorError(
        err instanceof ApiError ? err.message : "Failed to save contact",
      );
    } finally {
      setSavingContact(false);
    }
  }

  async function deleteContact(c: ContactDTO) {
    const ok = await dialog.confirm({
      message: `Delete contact "${c.email}"?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteContact(c.id);
      await refreshAll();
    } catch (err) {
      setContactsError(
        err instanceof ApiError ? err.message : "Failed to delete contact",
      );
    }
  }

  // Click a tag chip in the table to filter by it.
  function filterByTag(tag: string) {
    setTagFilter(tag);
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("contacts", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Contacts</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Contacts</h1>
          <p className="subtitle">
            Your in-house audiences and contacts — the system of record that
            replaces Mailchimp. Pick an audience to manage its contacts, custom
            fields and saved segments.
          </p>
        </div>
        {canCreate && (
          <button className="btn" onClick={createAudience}>
            + Add audience
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 280px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ---------------- Left: audiences ---------------- */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-head">
            <h2 style={{ fontSize: 16 }}>Audiences</h2>
          </div>
          {loadingAudiences ? (
            <p className="muted">Loading…</p>
          ) : audiences.length === 0 ? (
            <p className="muted">
              No audiences yet.{canCreate ? " Add one to begin." : ""}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {audiences.map((a) => {
                const active = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className="nav-link"
                    style={{
                      textAlign: "left",
                      width: "100%",
                      cursor: "pointer",
                      background: active ? "var(--surface-hover)" : "transparent",
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
                        {a.name}
                      </span>
                      {a.isDefault && (
                        <span className="badge badge--violet">Default</span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {a.contactCount} contact{a.contactCount === 1 ? "" : "s"} ·{" "}
                      {a.subscribedCount} subscribed
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (canEdit || canDelete) && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px solid var(--border)",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {canEdit && (
                <>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => renameAudience(selected)}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => makeDefault(selected)}
                    disabled={selected.isDefault}
                    title={
                      selected.isDefault
                        ? "Already the default audience"
                        : "Make this the default audience"
                    }
                  >
                    Set default
                  </button>
                </>
              )}
              {canDelete && (
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => deleteAudience(selected)}
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>

        {/* ---------------- Right: selected audience ---------------- */}
        <div style={{ minWidth: 0 }}>
          {!selected ? (
            <div className="card" style={{ margin: 0 }}>
              <p className="muted">
                Select an audience on the left to manage its contacts.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Contacts table */}
              <div className="card" style={{ margin: 0 }}>
                <div className="card-head">
                  <h2 style={{ fontSize: 16 }}>
                    Contacts{" "}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      in {selected.name}
                    </span>
                  </h2>
                  {canCreate && (
                    <button className="btn btn--sm" onClick={openCreate}>
                      + Add contact
                    </button>
                  )}
                </div>

                {/* filter toolbar */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 14,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search email or name…"
                    style={{ minWidth: 220 }}
                    aria-label="Search contacts"
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as ContactStatus | "")
                    }
                    aria-label="Filter by status"
                  >
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                    aria-label="Filter by tag"
                  >
                    <option value="">All tags</option>
                    {/* tags discovered from segments + the current page's contacts */}
                    {tagOptions(list, segments, tagFilter).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {(statusFilter || tagFilter || debouncedSearch) && (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setStatusFilter("");
                        setTagFilter("");
                        setSearch("");
                      }}
                    >
                      Clear
                    </button>
                  )}
                  {list && (
                    <span className="muted" style={{ fontSize: 13 }}>
                      {list.total} match{list.total === 1 ? "" : "es"}
                    </span>
                  )}
                </div>

                {contactsError && <p className="error">{contactsError}</p>}

                {loadingContacts ? (
                  <p className="muted">Loading…</p>
                ) : !list || list.items.length === 0 ? (
                  <p className="muted">No contacts match.</p>
                ) : (
                  <>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Email</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Tags</th>
                            <th>Source</th>
                            <th>Added</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.items.map((c) => (
                            <tr key={c.id}>
                              <td>{c.email}</td>
                              <td className="muted">
                                {[c.firstName, c.lastName]
                                  .filter(Boolean)
                                  .join(" ") || "—"}
                              </td>
                              <td>
                                <span
                                  className={`badge ${STATUS_BADGE[c.status]}`}
                                >
                                  {STATUS_LABEL[c.status]}
                                </span>
                              </td>
                              <td>
                                {c.tags.length === 0 ? (
                                  <span className="muted">—</span>
                                ) : (
                                  <div className="chips">
                                    {c.tags.map((t) => (
                                      <button
                                        key={t}
                                        className="chip"
                                        onClick={() => filterByTag(t)}
                                        title="Filter by this tag"
                                        style={{
                                          border: "none",
                                          cursor: "pointer",
                                        }}
                                      >
                                        {t}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td className="muted" style={{ fontSize: 12 }}>
                                {c.source}
                              </td>
                              <td className="muted" style={{ fontSize: 12 }}>
                                {new Date(c.createdAt).toLocaleDateString()}
                              </td>
                              <td>
                                <div className="row-actions">
                                  {canEdit && (
                                    <button
                                      className="btn btn--ghost btn--sm"
                                      onClick={() => openEdit(c)}
                                    >
                                      Edit
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      className="btn btn--danger btn--sm"
                                      onClick={() => deleteContact(c)}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {totalPages > 1 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                          gap: 10,
                          marginTop: 14,
                        }}
                      >
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          ← Prev
                        </button>
                        <span className="muted" style={{ fontSize: 13 }}>
                          Page {page} of {totalPages}
                        </span>
                        <button
                          className="btn btn--ghost btn--sm"
                          disabled={page >= totalPages}
                          onClick={() =>
                            setPage((p) => Math.min(totalPages, p + 1))
                          }
                        >
                          Next →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Segments + Fields panels */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 20,
                }}
              >
                <SegmentsPanel
                  audience={selected}
                  segments={segments}
                  canEdit={canEdit}
                  canCreate={canCreate}
                  canDelete={canDelete}
                  onChanged={() => loadPanels(selected.id)}
                  onApply={(filter) => {
                    setStatusFilter(filter.status ?? "");
                    setTagFilter(filter.anyTags?.[0] ?? filter.allTags?.[0] ?? "");
                    setSearch(filter.search ?? "");
                  }}
                />
                <FieldsPanel
                  audience={selected}
                  fields={fields}
                  canEdit={canEdit}
                  onChanged={() => loadPanels(selected.id)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Contact editor modal ---------------- */}
      {editorOpen && (
        <div className="modal-overlay" onClick={closeEditor}>
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <div className="modal-header">
              <h2>{editingId ? "Edit contact" : "New contact"}</h2>
              <button className="modal-close" onClick={closeEditor}>
                ×
              </button>
            </div>
            <form onSubmit={saveContact}>
              <div className="modal-body">
                {editorError && <p className="error">{editorError}</p>}
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) =>
                      setDraft({ ...draft, email: e.target.value })
                    }
                    required
                    autoFocus
                  />
                </div>
                <div className="form-row">
                  <div className="field">
                    <label>First name</label>
                    <input
                      value={draft.firstName}
                      onChange={(e) =>
                        setDraft({ ...draft, firstName: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Last name</label>
                    <input
                      value={draft.lastName}
                      onChange={(e) =>
                        setDraft({ ...draft, lastName: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        status: e.target.value as ContactStatus,
                      })
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>
                    Tags <span className="muted">(comma-separated)</span>
                  </label>
                  <input
                    value={draft.tags}
                    onChange={(e) =>
                      setDraft({ ...draft, tags: e.target.value })
                    }
                    placeholder="e.g. lead, webinar"
                  />
                </div>
                {fields.length > 0 && (
                  <p className="muted" style={{ fontSize: 12 }}>
                    Custom fields for this audience:{" "}
                    {fields.map((f) => f.tag).join(", ")}.
                  </p>
                )}
              </div>
              <div
                className="modal-header"
                style={{ borderTop: "1px solid var(--border)", borderBottom: "none" }}
              >
                <span />
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeEditor}
                  >
                    Cancel
                  </button>
                  <button className="btn" type="submit" disabled={savingContact}>
                    {savingContact
                      ? "Saving…"
                      : editingId
                        ? "Save changes"
                        : "Add contact"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Collect a sorted, de-duped tag list from the loaded segments' filters + the
// current page's contacts (so the dropdown offers meaningful choices). The
// active filter value is always included so it stays selectable.
function tagOptions(
  list: ContactListDTO | null,
  segments: SegmentDTO[],
  active: string,
): string[] {
  const set = new Set<string>();
  if (active) set.add(active);
  for (const s of segments) {
    for (const t of s.filter.anyTags ?? []) set.add(t);
    for (const t of s.filter.allTags ?? []) set.add(t);
  }
  for (const c of list?.items ?? []) for (const t of c.tags) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ---------------- Segments panel ----------------
function SegmentsPanel({
  audience,
  segments,
  canEdit,
  canCreate,
  canDelete,
  onChanged,
  onApply,
}: {
  audience: AudienceDTO;
  segments: SegmentDTO[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onApply: (filter: SegmentDTO["filter"]) => void;
}) {
  const [err, setErr] = useState<string | null>(null);

  // Create a segment from the current quick-filter prompt. Keep it simple: name
  // + an optional status + an optional any-tag list (covers the common cases and
  // exercises the create endpoint).
  async function create() {
    const name = await dialog.prompt({
      message: "Segment name",
      placeholder: "e.g. Active leads",
      confirmLabel: "Next",
    });
    if (!name || !name.trim()) return;
    const tags = await dialog.prompt({
      message: `Tags for "${name.trim()}" (comma-separated, optional — matches ANY)`,
      placeholder: "e.g. lead, webinar",
      confirmLabel: "Create",
    });
    if (tags === null) return; // cancelled
    const anyTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      await api.createSegment(audience.id, {
        name: name.trim(),
        filter: { status: "SUBSCRIBED", ...(anyTags.length ? { anyTags } : {}) },
      });
      setErr(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to create segment");
    }
  }

  async function rename(s: SegmentDTO) {
    const name = await dialog.prompt({
      message: "Rename segment",
      defaultValue: s.name,
      confirmLabel: "Save",
    });
    if (!name || !name.trim() || name.trim() === s.name) return;
    try {
      await api.updateSegment(s.id, { name: name.trim() });
      setErr(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to rename segment");
    }
  }

  async function remove(s: SegmentDTO) {
    const ok = await dialog.confirm({
      message: `Delete segment "${s.name}"?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteSegment(s.id);
      setErr(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to delete segment");
    }
  }

  // Human-readable summary of a segment's filter.
  function summarize(f: SegmentDTO["filter"]): string {
    const parts: string[] = [];
    if (f.status) parts.push(STATUS_LABEL[f.status]);
    if (f.anyTags?.length) parts.push(`any of: ${f.anyTags.join(", ")}`);
    if (f.allTags?.length) parts.push(`all of: ${f.allTags.join(", ")}`);
    if (f.search) parts.push(`“${f.search}”`);
    return parts.length ? parts.join(" · ") : "All contacts";
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-head">
        <h2 style={{ fontSize: 16 }}>Segments</h2>
        {canCreate && (
          <button className="btn btn--sm" onClick={create}>
            + New
          </button>
        )}
      </div>
      <p className="subtitle" style={{ fontSize: 12, marginBottom: 10 }}>
        Saved filters over this audience (the campaign target shape). Click a
        segment to apply it to the table.
      </p>
      {err && <p className="error">{err}</p>}
      {segments.length === 0 ? (
        <p className="muted">No segments yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {segments.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
              }}
            >
              <button
                onClick={() => onApply(s.filter)}
                title="Apply this segment to the table"
                style={{
                  border: "none",
                  background: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  padding: 0,
                  flex: 1,
                  minWidth: 0,
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {s.name}
                  {typeof s.contactCount === "number" && (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {" "}
                      · {s.contactCount}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {summarize(s.filter)}
                </div>
              </button>
              <div className="row-actions">
                {canEdit && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => rename(s)}
                  >
                    Rename
                  </button>
                )}
                {canDelete && (
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={() => remove(s)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Fields panel ----------------
function FieldsPanel({
  audience,
  fields,
  canEdit,
  onChanged,
}: {
  audience: AudienceDTO;
  fields: AudienceFieldDTO[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [tag, setTag] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!tag.trim() || !label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.upsertAudienceField(audience.id, {
        tag: tag.trim(),
        label: label.trim(),
        type,
        required,
      });
      setTag("");
      setLabel("");
      setType("text");
      setRequired(false);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed to save field");
    } finally {
      setBusy(false);
    }
  }

  async function remove(f: AudienceFieldDTO) {
    const ok = await dialog.confirm({
      message: `Delete field "${f.label}" (${f.tag})?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteAudienceField(audience.id, f.tag);
      setErr(null);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed to delete field");
    }
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-head">
        <h2 style={{ fontSize: 16 }}>Fields</h2>
      </div>
      <p className="subtitle" style={{ fontSize: 12, marginBottom: 10 }}>
        Custom merge fields (like Mailchimp merge tags). <code>EMAIL</code> is
        implicit. Tags are uppercased.
      </p>
      {err && <p className="error">{err}</p>}
      {fields.length === 0 ? (
        <p className="muted" style={{ marginBottom: 10 }}>
          No custom fields yet.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Label</th>
                <th>Type</th>
                <th>Req.</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.tag}>
                  <td>
                    <code style={{ fontSize: 12 }}>{f.tag}</code>
                  </td>
                  <td>{f.label}</td>
                  <td className="muted">{f.type}</td>
                  <td className="muted">{f.required ? "Yes" : "No"}</td>
                  {canEdit && (
                    <td>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => remove(f)}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={add}>
          <div className="form-row">
            <div className="field">
              <label>Tag</label>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value.toUpperCase())}
                placeholder="FNAME"
              />
            </div>
            <div className="field">
              <label>Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="First Name"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="text">text</option>
                <option value="number">number</option>
                <option value="date">date</option>
                <option value="phone">phone</option>
                <option value="address">address</option>
              </select>
            </div>
            <div className="field">
              <label>Required</label>
              <select
                value={required ? "yes" : "no"}
                onChange={(e) => setRequired(e.target.value === "yes")}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>
          <button
            className="btn btn--sm"
            type="submit"
            disabled={busy || !tag.trim() || !label.trim()}
          >
            {busy ? "Saving…" : "Add / update field"}
          </button>
        </form>
      )}
    </div>
  );
}
