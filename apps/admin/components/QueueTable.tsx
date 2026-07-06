"use client";

// QueueTable — a reusable "WEB QUEUE" table (Slack-Lists / Airtable style),
// extracted from app/projects/lists/page.tsx so it can be dropped into BOTH the
// standalone Lists page AND a channel's List tabs (app/projects/page.tsx).
//
// COLUMNS are user-defined typed fields (ChatListFieldDTO); ROWS are items
// (ChatListItemDTO) whose `values` map is keyed by field id. Every cell renders
// + edits per the field's type and persists via updateItemValues / updateListItem.
// A per-item 💬 thread opens an item-detail card. Admin-only; the caller passes
// the resolved `projects` RBAC capabilities.
//
// The component is SELF-LOADING: give it a `listId` and it fetches the list
// detail (via api.listLists), keeps it fresh over the realtime socket + a slow
// poll, and owns the item-detail card. The parent only supplies the roster, the
// name resolver, the capability flags, and an onError sink — plus an optional
// onListLoaded callback (so a parent that wants the loaded list, e.g. for tab
// counts, can read it without a second fetch).

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChatFieldType,
  ChatListDTO,
  ChatListFieldDTO,
  ChatListFieldOptionInput,
  ChatListItemCommentDTO,
  ChatListItemDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { dialog } from "@/components/DialogProvider";
import {
  AdminLite,
  NameResolver,
  formatTime,
  initials,
} from "@/lib/projects";
import {
  getProjectsSocket,
  joinChannel,
  leaveChannel,
  onChatListUpdate,
} from "@/lib/projectsSocket";

// Slow catch-all refresh for stand-alone lists (no channel socket room) and
// missed socket events. Channel-scoped lists also refresh on `chat:list:update`.
const LIST_POLL_MS = 10_000;

// ----------------------------------------------------------------------------
// Field-type metadata + a small swatch palette (reuses the violet design
// language; these are the only chip colors offered for SELECT options).
// ----------------------------------------------------------------------------
const FIELD_TYPES: { type: ChatFieldType; label: string }[] = [
  { type: "TEXT", label: "Text" },
  { type: "LONG_TEXT", label: "Long text" },
  { type: "SELECT", label: "Select" },
  { type: "MULTI_SELECT", label: "Multi-select" },
  { type: "PERSON", label: "Person" },
  { type: "MULTI_PERSON", label: "People (multiple)" },
  { type: "DATE", label: "Date" },
  { type: "URL", label: "Link" },
  { type: "NUMBER", label: "Number" },
  { type: "CHECKBOX", label: "Checkbox" },
  { type: "SECRET", label: "Secret" },
];

// Swatch palette — drawn from the Ink Hero token hues so options stay on-brand.
const SWATCHES = [
  "#3cc4b2", // teal (accent)
  "#f7a01e", // music amber
  "#9046c8", // cooking purple
  "#43a565", // photo green
  "#e04848", // film red
  "#4a76d0", // dance blue
  "#27a596", // comedy sea
  "#8b87a3", // muted
];

// Render an option's chip color: explicit color → tinted chip; otherwise muted.
function chipStyle(color?: string | null): React.CSSProperties {
  if (!color) return {};
  return {
    background: hexToRgba(color, 0.16),
    color,
  };
}
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Coerce an unknown stored value into a string for text-ish cells/search.
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v) return [v];
  return [];
}

// ============================================================================
// QueueTable — self-loading wrapper around the table + item-detail card.
// ============================================================================
export default function QueueTable({
  listId,
  roster,
  resolveName,
  meId,
  canCreate,
  canEdit,
  canDelete,
  onError,
  onListLoaded,
}: {
  listId: string;
  roster: AdminLite[];
  resolveName: NameResolver;
  meId: string | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onError: (msg: string) => void;
  // Optional: hand the parent the freshly-loaded list (e.g. for tab counts).
  onListLoaded?: (list: ChatListDTO) => void;
}) {
  const [list, setList] = useState<ChatListDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  // Keep the loaded-callback in a ref so the loader isn't re-created when the
  // parent passes a fresh closure each render.
  const onLoadedRef = useRef(onListLoaded);
  onLoadedRef.current = onListLoaded;

  // There is no single-list GET endpoint — listLists returns every list (with
  // full items + fields), so we fetch and pick ours by id. Cheap for the team
  // tool's scale and keeps the API surface unchanged.
  const load = useCallback(async () => {
    try {
      const rows = await api.listLists();
      const found = rows.find((l) => l.id === listId) ?? null;
      setList(found);
      if (found) onLoadedRef.current?.(found);
      if (!found) onError("This list no longer exists.");
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to load list");
    } finally {
      setLoading(false);
    }
  }, [listId, onError]);

  // Reset + reload when the target list changes.
  useEffect(() => {
    setLoading(true);
    setOpenItemId(null);
    load();
  }, [load]);

  // Realtime: refresh on `chat:list:update` for THIS list. (Stand-alone lists
  // with no channel fall back to the slow poll below.)
  useEffect(() => {
    getProjectsSocket();
    const off = onChatListUpdate((evt) => {
      if (evt.listId === listId) load();
    });
    return off;
  }, [listId, load]);

  // Join the list's channel room (if channel-scoped) so the socket delivers
  // `chat:list:update` for it.
  const channelId = list?.channelId ?? null;
  useEffect(() => {
    if (!channelId) return;
    joinChannel(channelId);
    return () => leaveChannel(channelId);
  }, [channelId]);

  // Slow catch-all poll (covers stand-alone lists + missed socket events).
  useEffect(() => {
    const t = setInterval(() => load(), LIST_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !list) return <p className="muted">Loading…</p>;
  if (!list)
    return (
      <div className="card" style={{ margin: 0 }}>
        <p className="muted">List unavailable.</p>
      </div>
    );

  const openItem = list.items.find((it) => it.id === openItemId) ?? null;

  return (
    <>
      <ListTable
        list={list}
        roster={roster}
        resolveName={resolveName}
        search={search}
        onSearch={setSearch}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onChanged={load}
        onOpenItem={setOpenItemId}
        onError={onError}
      />
      {openItem && (
        <ItemDetailCard
          item={openItem}
          list={list}
          meId={meId}
          roster={roster}
          resolveName={resolveName}
          canEdit={canEdit}
          onClose={() => setOpenItemId(null)}
          onChanged={load}
          onError={onError}
        />
      )}
    </>
  );
}

// ============================================================================
// The table
// ============================================================================
function ListTable({
  list,
  roster,
  resolveName,
  search,
  onSearch,
  canCreate,
  canEdit,
  canDelete,
  onChanged,
  onOpenItem,
  onError,
}: {
  list: ChatListDTO;
  roster: AdminLite[];
  resolveName: NameResolver;
  search: string;
  onSearch: (s: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onOpenItem: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const fields = useMemo(
    () => [...list.fields].sort((a, b) => a.position - b.position),
    [list.fields],
  );

  const items = useMemo(
    () => [...list.items].sort((a, b) => a.position - b.position),
    [list.items],
  );

  // Client-side search: title + any text-ish field value.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      if (it.title.toLowerCase().includes(q)) return true;
      return fields.some((f) => {
        if (f.type === "SECRET") return false; // never search secrets
        const raw = it.values[f.id];
        if (f.type === "SELECT") {
          const opt = f.options.find((o) => o.id === raw);
          return (opt?.label ?? "").toLowerCase().includes(q);
        }
        if (f.type === "MULTI_SELECT") {
          return asStringArray(raw).some((id) =>
            (f.options.find((o) => o.id === id)?.label ?? "")
              .toLowerCase()
              .includes(q),
          );
        }
        if (f.type === "PERSON")
          return resolveName(asText(raw)).toLowerCase().includes(q);
        if (f.type === "MULTI_PERSON")
          return asStringArray(raw).some((id) =>
            resolveName(id).toLowerCase().includes(q),
          );
        return asText(raw).toLowerCase().includes(q);
      });
    });
  }, [items, fields, search, resolveName]);

  // ---- mutations ----
  async function persistValue(item: ChatListItemDTO, fieldId: string, value: unknown) {
    try {
      await api.updateItemValues(item.id, { [fieldId]: value });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save");
    }
  }
  async function persistTitle(item: ChatListItemDTO, title: string) {
    const t = title.trim();
    if (!t || t === item.title) return;
    try {
      await api.updateListItem(item.id, { title: t });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to rename item");
    }
  }
  async function addItem(title: string) {
    const t = title.trim();
    if (!t) return;
    try {
      await api.createListItem(list.id, { title: t });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to add item");
    }
  }
  async function deleteItem(item: ChatListItemDTO) {
    const ok = await dialog.confirm({
      message: `Delete "${item.title}"?`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteListItem(item.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to delete item");
    }
  }

  // Total columns: leading title + each field + trailing actions/+col.
  const colCount = fields.length + 2;

  return (
    <div className="pj-tbl-wrap">
      {/* header bar: "All items" + search */}
      <div className="pj-tbl-bar">
        <span className="pj-tbl-viewname">All items</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {filtered.length}
          {filtered.length !== items.length ? ` / ${items.length}` : ""}
        </span>
        <input
          className="pj-tbl-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search items…"
          aria-label="Search items"
        />
      </div>

      <div className="pj-tbl-scroll">
        <table className="pj-tbl">
          <thead>
            <tr>
              <th className="pj-tbl-th pj-tbl-th--title">Name</th>
              {fields.map((f) => (
                <ColumnHeader
                  key={f.id}
                  field={f}
                  listId={list.id}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onChanged={onChanged}
                  onError={onError}
                />
              ))}
              <th className="pj-tbl-th pj-tbl-th--add">
                {canCreate ? (
                  <AddColumnButton
                    listId={list.id}
                    onChanged={onChanged}
                    onError={onError}
                  />
                ) : (
                  ""
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td className="pj-tbl-empty" colSpan={colCount}>
                  {items.length === 0
                    ? "No items yet."
                    : "No items match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((it) => (
                <tr key={it.id} className="pj-tbl-row">
                  {/* Title cell + 💬 + open + delete */}
                  <td className="pj-tbl-td pj-tbl-td--title">
                    <div className="pj-tbl-titlecell">
                      <TitleCell
                        item={it}
                        canEdit={canEdit}
                        onSave={(t) => persistTitle(it, t)}
                      />
                      <button
                        className="pj-tbl-comments"
                        title="Open item & comments"
                        onClick={() => onOpenItem(it.id)}
                      >
                        💬 {it.commentCount}
                      </button>
                      {canDelete && (
                        <button
                          className="pj-tbl-rowdel"
                          title="Delete item"
                          onClick={() => deleteItem(it)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                  {fields.map((f) => (
                    <td key={f.id} className="pj-tbl-td">
                      <Cell
                        field={f}
                        value={it.values[f.id]}
                        roster={roster}
                        resolveName={resolveName}
                        canEdit={canEdit}
                        onSave={(v) => persistValue(it, f.id, v)}
                      />
                    </td>
                  ))}
                  <td className="pj-tbl-td" />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canCreate && <AddRow onAdd={addItem} />}
    </div>
  );
}

// ---- "+ Add item" row ----
function AddRow({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    await onAdd(title);
    setTitle("");
    setBusy(false);
  }
  return (
    <form className="pj-tbl-addrow" onSubmit={submit}>
      <span className="pj-tbl-plus">+</span>
      <input
        className="pj-tbl-addinput"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add item…"
        aria-label="New item title"
      />
      <button className="btn btn--sm" type="submit" disabled={busy || !title.trim()}>
        {busy ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

// ============================================================================
// Column header (rename + delete)
// ============================================================================
function ColumnHeader({
  field,
  canEdit,
  canDelete,
  onChanged,
  onError,
}: {
  field: ChatListFieldDTO;
  listId: string;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useOutsideClose<HTMLDivElement>(() => setMenuOpen(false));

  async function rename() {
    setMenuOpen(false);
    const name = await dialog.prompt({
      message: "Rename column",
      defaultValue: field.name,
      confirmLabel: "Save",
    });
    if (!name || !name.trim() || name.trim() === field.name) return;
    try {
      await api.updateField(field.id, { name: name.trim() });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to rename column");
    }
  }
  async function remove() {
    setMenuOpen(false);
    const ok = await dialog.confirm({
      message: `Delete column "${field.name}"? Its values are removed from every item.`,
      danger: true,
      confirmLabel: "Delete column",
    });
    if (!ok) return;
    try {
      await api.deleteField(field.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to delete column");
    }
  }

  const typeLabel = FIELD_TYPES.find((t) => t.type === field.type)?.label ?? field.type;
  const canMenu = canEdit || canDelete;

  return (
    <th className="pj-tbl-th">
      <div className="pj-tbl-th-inner" ref={wrapRef}>
        <span className="pj-tbl-th-name" title={`${field.name} · ${typeLabel}`}>
          {field.name}
        </span>
        {canMenu && (
          <>
            <button
              className="pj-tbl-th-menu"
              title="Column options"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="pj-menu">
                {canEdit && (
                  <button className="pj-menu-item" onClick={rename}>
                    Rename
                  </button>
                )}
                {canDelete && (
                  <button
                    className="pj-menu-item pj-menu-item--danger"
                    onClick={remove}
                  >
                    Delete column
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </th>
  );
}

// ============================================================================
// "+ Add column" popover
// ============================================================================
function AddColumnButton({
  listId,
  onChanged,
  onError,
}: {
  listId: string;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ChatFieldType>("TEXT");
  const [options, setOptions] = useState<{ label: string; color: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const wrapRef = useOutsideClose<HTMLDivElement>(() => setOpen(false));

  const isSelect = type === "SELECT" || type === "MULTI_SELECT";

  function reset() {
    setName("");
    setType("TEXT");
    setOptions([]);
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const cleanOptions: ChatListFieldOptionInput[] = isSelect
        ? options
            .filter((o) => o.label.trim())
            .map((o) => ({ label: o.label.trim(), color: o.color }))
        : [];
      await api.createField(listId, {
        name: name.trim(),
        type,
        options: cleanOptions.length ? cleanOptions : undefined,
      });
      reset();
      setOpen(false);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to add column");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pj-tbl-addcol" ref={wrapRef}>
      <button
        className="pj-tbl-addcol-btn"
        title="Add column"
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      {open && (
        <div className="pj-popover pj-popover--col">
          <label className="pj-pop-label">Column name</label>
          <input
            className="pj-pop-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Status"
            autoFocus
          />
          <label className="pj-pop-label">Type</label>
          <select
            className="pj-pop-input"
            value={type}
            onChange={(e) => setType(e.target.value as ChatFieldType)}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>

          {isSelect && (
            <div className="pj-pop-options">
              <label className="pj-pop-label">Options</label>
              {options.map((o, i) => (
                <div className="pj-pop-optrow" key={i}>
                  <SwatchPicker
                    color={o.color}
                    onPick={(c) =>
                      setOptions((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, color: c } : x)),
                      )
                    }
                  />
                  <input
                    className="pj-pop-input pj-pop-input--sm"
                    value={o.label}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Option label"
                  />
                  <button
                    type="button"
                    className="pj-tbl-rowdel"
                    onClick={() =>
                      setOptions((prev) => prev.filter((_, j) => j !== i))
                    }
                    title="Remove option"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="pj-menu-item"
                onClick={() =>
                  setOptions((prev) => [
                    ...prev,
                    { label: "", color: SWATCHES[prev.length % SWATCHES.length] },
                  ])
                }
              >
                + Add option
              </button>
            </div>
          )}

          <div className="pj-pop-actions">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn--sm"
              onClick={create}
              disabled={busy || !name.trim()}
            >
              {busy ? "Adding…" : "Add column"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Small color-swatch dropdown.
function SwatchPicker({
  color,
  onPick,
}: {
  color?: string | null;
  onPick: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useOutsideClose<HTMLDivElement>(() => setOpen(false));
  return (
    <div className="pj-swatch-wrap" ref={wrapRef}>
      <button
        type="button"
        className="pj-swatch"
        style={{ background: color || "var(--surface-2)" }}
        onClick={() => setOpen((v) => !v)}
        title="Pick a color"
      />
      {open && (
        <div className="pj-swatch-pop">
          {SWATCHES.map((c) => (
            <button
              type="button"
              key={c}
              className="pj-swatch"
              style={{ background: c }}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Title cell — inline editable text
// ============================================================================
function TitleCell({
  item,
  canEdit,
  onSave,
}: {
  item: ChatListItemDTO;
  canEdit: boolean;
  onSave: (title: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  useEffect(() => setDraft(item.title), [item.title]);

  if (editing && canEdit) {
    return (
      <input
        className="pj-tbl-inline pj-tbl-inline--title"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            onSave(draft);
          } else if (e.key === "Escape") {
            setDraft(item.title);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      className="pj-tbl-titletext"
      onClick={() => canEdit && setEditing(true)}
      title={canEdit ? "Click to rename" : item.title}
      disabled={!canEdit}
    >
      {item.title}
    </button>
  );
}

// ============================================================================
// Cell dispatcher — renders/edits a single value by field type
// ============================================================================
function Cell({
  field,
  value,
  roster,
  resolveName,
  canEdit,
  onSave,
}: {
  field: ChatListFieldDTO;
  value: unknown;
  roster: AdminLite[];
  resolveName: NameResolver;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  switch (field.type) {
    case "TEXT":
    case "LONG_TEXT":
      return <TextCell value={asText(value)} canEdit={canEdit} onSave={onSave} long={field.type === "LONG_TEXT"} />;
    case "NUMBER":
      return <NumberCell value={value} canEdit={canEdit} onSave={onSave} />;
    case "URL":
      return <UrlCell value={asText(value)} canEdit={canEdit} onSave={onSave} />;
    case "DATE":
      return <DateCell value={asText(value)} canEdit={canEdit} onSave={onSave} />;
    case "CHECKBOX":
      return <CheckboxCell value={value === true} canEdit={canEdit} onSave={onSave} />;
    case "SECRET":
      return <SecretCell value={asText(value)} canEdit={canEdit} onSave={onSave} />;
    case "SELECT":
      return <SelectCell field={field} value={asText(value)} canEdit={canEdit} onSave={onSave} />;
    case "MULTI_SELECT":
      return <MultiSelectCell field={field} value={asStringArray(value)} canEdit={canEdit} onSave={onSave} />;
    case "PERSON":
      return (
        <PersonCell
          value={asText(value)}
          roster={roster}
          resolveName={resolveName}
          canEdit={canEdit}
          onSave={onSave}
        />
      );
    case "MULTI_PERSON":
      return (
        <MultiPersonCell
          value={asStringArray(value)}
          roster={roster}
          resolveName={resolveName}
          canEdit={canEdit}
          onSave={onSave}
        />
      );
    default:
      return <span className="pj-tbl-muted">—</span>;
  }
}

// ---- TEXT / LONG_TEXT ----
function TextCell({
  value,
  canEdit,
  onSave,
  long,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
  long?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing && canEdit) {
    return long ? (
      <textarea
        className="pj-tbl-inline"
        value={draft}
        autoFocus
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
      />
    ) : (
      <input
        className="pj-tbl-inline"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (draft !== value) onSave(draft);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      className={`pj-tbl-cellbtn${value ? "" : " pj-tbl-cellempty"}`}
      onClick={() => canEdit && setEditing(true)}
      disabled={!canEdit}
      title={value || (canEdit ? "Click to edit" : "")}
    >
      {value || (canEdit ? "—" : "")}
    </button>
  );
}

// ---- NUMBER ----
function NumberCell({
  value,
  canEdit,
  onSave,
}: {
  value: unknown;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const current = typeof value === "number" ? String(value) : asText(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);

  if (editing && canEdit) {
    return (
      <input
        className="pj-tbl-inline"
        type="number"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            commit();
          } else if (e.key === "Escape") {
            setDraft(current);
            setEditing(false);
          }
        }}
      />
    );
  }
  function commit() {
    if (draft === current) return;
    onSave(draft === "" ? null : Number(draft));
  }
  return (
    <button
      className={`pj-tbl-cellbtn${current ? "" : " pj-tbl-cellempty"}`}
      onClick={() => canEdit && setEditing(true)}
      disabled={!canEdit}
    >
      {current || (canEdit ? "—" : "")}
    </button>
  );
}

// ---- URL ----
function UrlCell({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing && canEdit) {
    return (
      <input
        className="pj-tbl-inline"
        type="url"
        value={draft}
        autoFocus
        placeholder="https://…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (draft !== value) onSave(draft);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  if (!value) {
    return (
      <button
        className="pj-tbl-cellbtn pj-tbl-cellempty"
        onClick={() => canEdit && setEditing(true)}
        disabled={!canEdit}
      >
        {canEdit ? "—" : ""}
      </button>
    );
  }
  const label = value.replace(/^https?:\/\//, "");
  return (
    <span className="pj-tbl-urlcell">
      <a
        className="pj-tbl-link"
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        title={value}
      >
        {label.length > 28 ? `${label.slice(0, 28)}…` : label}
      </a>
      {canEdit && (
        <button
          className="pj-tbl-editmini"
          onClick={() => setEditing(true)}
          title="Edit link"
        >
          ✎
        </button>
      )}
    </span>
  );
}

// ---- DATE ----
function DateCell({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  // Stored ISO → yyyy-mm-dd for the input.
  const ymd = value ? toYmd(value) : "";

  if (editing && canEdit) {
    return (
      <input
        className="pj-tbl-inline"
        type="date"
        defaultValue={ymd}
        autoFocus
        onChange={(e) => {
          const v = e.target.value;
          onSave(v ? new Date(v + "T00:00:00").toISOString() : null);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }
  return (
    <button
      className={`pj-tbl-cellbtn${value ? "" : " pj-tbl-cellempty"}`}
      onClick={() => canEdit && setEditing(true)}
      disabled={!canEdit}
    >
      {value ? new Date(value).toLocaleDateString() : canEdit ? "—" : ""}
    </button>
  );
}
function toYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ---- CHECKBOX ----
function CheckboxCell({
  value,
  canEdit,
  onSave,
}: {
  value: boolean;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  return (
    <input
      type="checkbox"
      className="pj-tbl-checkbox"
      checked={value}
      disabled={!canEdit}
      onChange={(e) => onSave(e.target.checked)}
      aria-label="Toggle"
    />
  );
}

// ---- SECRET (masked + reveal + edit) ----
function SecretCell({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (editing && canEdit) {
    return (
      <input
        className="pj-tbl-inline"
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (draft !== value) onSave(draft);
          } else if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <span className="pj-tbl-secretcell">
      <span className="pj-tbl-secret">
        {value ? (revealed ? value : "••••••••") : canEdit ? "—" : ""}
      </span>
      {value && (
        <button
          className="pj-tbl-editmini"
          onClick={() => setRevealed((v) => !v)}
          title={revealed ? "Hide" : "Reveal"}
        >
          {revealed ? "🙈" : "👁"}
        </button>
      )}
      {canEdit && (
        <button
          className="pj-tbl-editmini"
          onClick={() => setEditing(true)}
          title="Edit secret"
        >
          ✎
        </button>
      )}
    </span>
  );
}

// ---- SELECT (single colored chip + dropdown) ----
function SelectCell({
  field,
  value,
  canEdit,
  onSave,
}: {
  field: ChatListFieldDTO;
  value: string;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useOutsideClose<HTMLDivElement>(() => setOpen(false));
  const opt = field.options.find((o) => o.id === value) ?? null;

  return (
    <div className="pj-tbl-selectwrap" ref={wrapRef}>
      <button
        className="pj-tbl-chipbtn"
        onClick={() => canEdit && setOpen((v) => !v)}
        disabled={!canEdit}
      >
        {opt ? (
          <span className="chip" style={chipStyle(opt.color)}>
            {opt.label}
          </span>
        ) : (
          <span className="pj-tbl-muted">{canEdit ? "—" : ""}</span>
        )}
      </button>
      {open && (
        <div className="pj-menu pj-menu--options">
          {field.options.length === 0 && (
            <span className="pj-menu-empty">No options. Add some on the column.</span>
          )}
          {field.options.map((o) => (
            <button
              key={o.id}
              className="pj-menu-item pj-menu-item--opt"
              onClick={() => {
                onSave(value === o.id ? null : o.id);
                setOpen(false);
              }}
            >
              <span className="pj-swatch pj-swatch--sm" style={{ background: o.color || "var(--surface-2)" }} />
              <span>{o.label}</span>
              {value === o.id && <span className="pj-opt-check">✓</span>}
            </button>
          ))}
          {value && (
            <button
              className="pj-menu-item pj-menu-item--danger"
              onClick={() => {
                onSave(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- MULTI_SELECT (chips + add/remove) ----
function MultiSelectCell({
  field,
  value,
  canEdit,
  onSave,
}: {
  field: ChatListFieldDTO;
  value: string[];
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useOutsideClose<HTMLDivElement>(() => setOpen(false));
  const selected = field.options.filter((o) => value.includes(o.id));

  function toggle(id: string) {
    const next = value.includes(id)
      ? value.filter((x) => x !== id)
      : [...value, id];
    onSave(next);
  }

  return (
    <div className="pj-tbl-selectwrap" ref={wrapRef}>
      <button
        className="pj-tbl-chipbtn pj-tbl-chipbtn--multi"
        onClick={() => canEdit && setOpen((v) => !v)}
        disabled={!canEdit}
      >
        {selected.length === 0 ? (
          <span className="pj-tbl-muted">{canEdit ? "—" : ""}</span>
        ) : (
          selected.map((o) => (
            <span key={o.id} className="chip" style={chipStyle(o.color)}>
              {o.label}
            </span>
          ))
        )}
      </button>
      {open && (
        <div className="pj-menu pj-menu--options">
          {field.options.length === 0 && (
            <span className="pj-menu-empty">No options. Add some on the column.</span>
          )}
          {field.options.map((o) => (
            <button
              key={o.id}
              className="pj-menu-item pj-menu-item--opt"
              onClick={() => toggle(o.id)}
            >
              <span className="pj-swatch pj-swatch--sm" style={{ background: o.color || "var(--surface-2)" }} />
              <span>{o.label}</span>
              {value.includes(o.id) && <span className="pj-opt-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- PERSON (avatar + name; admin picker) ----
function PersonCell({
  value,
  roster,
  resolveName,
  canEdit,
  onSave,
}: {
  value: string;
  roster: AdminLite[];
  resolveName: NameResolver;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useOutsideClose<HTMLDivElement>(() => setOpen(false));
  const name = value ? resolveName(value) : "";

  return (
    <div className="pj-tbl-selectwrap" ref={wrapRef}>
      <button
        className="pj-tbl-chipbtn"
        onClick={() => canEdit && setOpen((v) => !v)}
        disabled={!canEdit}
      >
        {value ? (
          <span className="pj-tbl-person">
            <span className="pj-avatar pj-avatar--sm">{initials(name)}</span>
            <span className="pj-tbl-personname">{name}</span>
          </span>
        ) : (
          <span className="pj-tbl-muted">{canEdit ? "—" : ""}</span>
        )}
      </button>
      {open && (
        <div className="pj-menu pj-menu--options">
          {roster.length === 0 && (
            <span className="pj-menu-empty">Roster unavailable.</span>
          )}
          {roster.map((a) => (
            <button
              key={a.id}
              className="pj-menu-item pj-menu-item--opt"
              onClick={() => {
                onSave(value === a.id ? null : a.id);
                setOpen(false);
              }}
            >
              <span className="pj-avatar pj-avatar--sm">{initials(a.name)}</span>
              <span>{a.name}</span>
              {value === a.id && <span className="pj-opt-check">✓</span>}
            </button>
          ))}
          {value && (
            <button
              className="pj-menu-item pj-menu-item--danger"
              onClick={() => {
                onSave(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- MULTI_PERSON (multiple person chips + multi-toggle admin picker) ----
// Stores an ARRAY of admin ids. Mirrors PERSON's avatar+name + open/close +
// roster fallback, and MULTI_SELECT's chip/toggle interaction. Each chip has a
// small "×" to remove; the dropdown toggles roster admins on/off. A missing or
// null value is treated as []. Reuses the graceful-403 roster fallback (empty
// roster → resolveName id fallback + "Roster unavailable." in the menu).
function MultiPersonCell({
  value,
  roster,
  resolveName,
  canEdit,
  onSave,
}: {
  value: string[];
  roster: AdminLite[];
  resolveName: NameResolver;
  canEdit: boolean;
  onSave: (v: unknown) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useOutsideClose<HTMLDivElement>(() => {
    setOpen(false);
    setQuery("");
  });

  function toggle(id: string) {
    const next = value.includes(id)
      ? value.filter((x) => x !== id)
      : [...value, id];
    onSave(next);
  }
  function remove(id: string) {
    onSave(value.filter((x) => x !== id));
  }

  // Filter the roster like the PERSON picker (case-insensitive name match).
  const q = query.trim().toLowerCase();
  const visible = q
    ? roster.filter((a) => a.name.toLowerCase().includes(q))
    : roster;

  return (
    <div className="pj-tbl-selectwrap" ref={wrapRef}>
      <button
        className="pj-tbl-chipbtn pj-tbl-chipbtn--multi"
        onClick={() => canEdit && setOpen((v) => !v)}
        disabled={!canEdit}
      >
        {value.length === 0 ? (
          <span className="pj-tbl-muted">{canEdit ? "Add people…" : ""}</span>
        ) : (
          value.map((id) => {
            const name = resolveName(id);
            return (
              <span key={id} className="pj-multiperson-chip">
                <span className="pj-avatar pj-avatar--sm">{initials(name)}</span>
                <span className="pj-tbl-personname">{name}</span>
                {canEdit && (
                  <span
                    className="pj-multiperson-x"
                    role="button"
                    tabIndex={0}
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        remove(id);
                      }
                    }}
                  >
                    ×
                  </span>
                )}
              </span>
            );
          })
        )}
      </button>
      {open && (
        <div className="pj-menu pj-menu--options">
          {roster.length === 0 ? (
            <span className="pj-menu-empty">Roster unavailable.</span>
          ) : (
            <>
              <input
                className="pj-pop-input pj-pop-input--sm"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
              />
              {visible.length === 0 && (
                <span className="pj-menu-empty">No matches.</span>
              )}
              {visible.map((a) => (
                <button
                  key={a.id}
                  className="pj-menu-item pj-menu-item--opt"
                  onClick={() => toggle(a.id)}
                >
                  <span className="pj-avatar pj-avatar--sm">
                    {initials(a.name)}
                  </span>
                  <span>{a.name}</span>
                  {value.includes(a.id) && <span className="pj-opt-check">✓</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Item detail card — all fields + a comment thread
// ============================================================================
function ItemDetailCard({
  item,
  list,
  meId,
  roster,
  resolveName,
  canEdit,
  onClose,
  onChanged,
  onError,
}: {
  item: ChatListItemDTO;
  list: ChatListDTO;
  meId: string | null;
  roster: AdminLite[];
  resolveName: NameResolver;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const fields = useMemo(
    () => [...list.fields].sort((a, b) => a.position - b.position),
    [list.fields],
  );

  const [comments, setComments] = useState<ChatListItemCommentDTO[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const loadComments = useCallback(async () => {
    setLoadingComments(true);
    try {
      const rows = await api.listItemComments(item.id);
      setComments(rows);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to load comments");
    } finally {
      setLoadingComments(false);
    }
  }, [item.id, onError]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  async function persistValue(fieldId: string, value: unknown) {
    try {
      await api.updateItemValues(item.id, { [fieldId]: value });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save");
    }
  }
  async function persistTitle(title: string) {
    const t = title.trim();
    if (!t || t === item.title) return;
    try {
      await api.updateListItem(item.id, { title: t });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to rename item");
    }
  }

  async function postComment(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setPosting(true);
    try {
      await api.createItemComment(item.id, draft.trim());
      setDraft("");
      await loadComments();
      await onChanged(); // commentCount changed
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }
  async function saveEdit(commentId: string) {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await api.editItemComment(commentId, body);
      setEditingId(null);
      await loadComments();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to edit comment");
    }
  }
  async function deleteComment(commentId: string) {
    const ok = await dialog.confirm({
      message: "Delete this comment?",
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.deleteItemComment(commentId);
      await loadComments();
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to delete comment");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Item details"
      >
        <div className="modal-header">
          <h2>{item.title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body pj-detail">
          {/* ---- fields ---- */}
          <div className="pj-detail-fields">
            <div className="pj-detail-row">
              <span className="pj-detail-label">Name</span>
              <div className="pj-detail-value">
                <TitleCell item={item} canEdit={canEdit} onSave={persistTitle} />
              </div>
            </div>
            {fields.map((f) => (
              <div className="pj-detail-row" key={f.id}>
                <span className="pj-detail-label">{f.name}</span>
                <div className="pj-detail-value">
                  <Cell
                    field={f}
                    value={item.values[f.id]}
                    roster={roster}
                    resolveName={resolveName}
                    canEdit={canEdit}
                    onSave={(v) => persistValue(f.id, v)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ---- comment thread ---- */}
          <div className="pj-detail-comments">
            <h3 className="pj-detail-comments-h">
              Comments
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                ({comments.length})
              </span>
            </h3>

            {loadingComments ? (
              <p className="muted">Loading…</p>
            ) : comments.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                No comments yet.
              </p>
            ) : (
              <div className="pj-detail-thread">
                {comments.map((c) => {
                  const author = resolveName(c.authorAdminId);
                  const mine = meId != null && c.authorAdminId === meId;
                  const isEditing = editingId === c.id;
                  return (
                    <div className="pj-comment" key={c.id}>
                      <span className="pj-avatar pj-avatar--sm">
                        {initials(author)}
                      </span>
                      <div className="pj-comment-body">
                        <div className="pj-comment-head">
                          <span className="pj-author">{author}</span>
                          <span className="pj-time">
                            {formatTime(c.createdAt)}
                            {c.editedAt ? " · edited" : ""}
                          </span>
                          {mine && !isEditing && (
                            <span className="pj-comment-actions">
                              <button
                                className="pj-icon-btn"
                                onClick={() => {
                                  setEditingId(c.id);
                                  setEditDraft(c.body);
                                }}
                                title="Edit"
                              >
                                ✎
                              </button>
                              <button
                                className="pj-icon-btn"
                                onClick={() => deleteComment(c.id)}
                                title="Delete"
                              >
                                🗑
                              </button>
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="pj-comment-edit">
                            <textarea
                              className="pj-composer-input"
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              rows={2}
                              autoFocus
                            />
                            <div className="pj-pop-actions">
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </button>
                              <button
                                className="btn btn--sm"
                                onClick={() => saveEdit(c.id)}
                                disabled={!editDraft.trim()}
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="pj-msg-text">{c.body}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <form className="pj-detail-composer" onSubmit={postComment}>
              <textarea
                className="pj-composer-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a comment…"
                rows={2}
              />
              <button
                className="btn btn--sm"
                type="submit"
                disabled={posting || !draft.trim()}
              >
                {posting ? "Posting…" : "Comment"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tiny hook: close a popover/menu on outside click or Escape.
// ============================================================================
function useOutsideClose<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handlePointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);
  return ref;
}
