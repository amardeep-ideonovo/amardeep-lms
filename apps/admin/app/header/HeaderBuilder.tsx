"use client";

import { useEffect, useState } from "react";
import type {
  CourseCard,
  HeaderConditions,
  HeaderConfig,
  HeaderCta,
  HeaderDTO,
  HeaderSection,
  HeaderSummary,
  LevelDTO,
  MenuDTO,
  MenuListItem,
  PageListItem,
  PostAdminRow,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { dialog } from "@/components/DialogProvider";
import MediaPicker from "@/components/MediaPicker";
import ColorField from "@/components/ColorField";
import { CtaTargetPicker } from "./CtaTargetPicker";

const BRAND = "LMS"; // text-brand fallback (matches the web Nav default)

const SECTIONS: { value: HeaderSection; label: string }[] = [
  { value: "HOME", label: "Home" },
  { value: "DASHBOARD", label: "Dashboard" },
  { value: "BLOG", label: "Blog" },
  { value: "PRICING", label: "Pricing" },
  { value: "CLASSES", label: "Classes" },
  { value: "COURSES", label: "Courses" },
];
const AUD_LABEL: Record<string, string> = {
  ALL: "Everyone",
  AUTHED: "Members",
  GUEST: "Guests",
  LEVEL: "Class members",
};

const msg = (e: unknown, fb: string) =>
  e instanceof ApiError ? e.message : fb;

function makeCta(): HeaderCta {
  return {
    id: crypto.randomUUID(),
    label: "Get started",
    bgColor: "#4f46e5",
    textColor: "#ffffff",
    paddingX: 16,
    paddingY: 9,
    borderRadius: 8,
    link: { type: "CUSTOM", url: "/pricing/all", openNewTab: false },
  };
}

function clamp(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

// =========================================================================
// Manager: the "Your headers" list + the selected header's editor.
// =========================================================================
export default function HeaderBuilder({
  menus,
  pages,
  levels,
  courses,
  posts,
  canEdit,
  canCreate,
  canDelete,
  onError,
}: {
  menus: MenuListItem[];
  pages: PageListItem[];
  levels: LevelDTO[];
  courses: CourseCard[];
  posts: PostAdminRow[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
  onError: (msg: string | null) => void;
}) {
  const [list, setList] = useState<HeaderSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dto, setDto] = useState<HeaderDTO | null>(null);
  const [loadingDto, setLoadingDto] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listHeaders()
      .then((l) => {
        setList(l);
        setSelectedId((cur) => cur ?? l[0]?.id ?? null);
      })
      .catch((e) => onError(msg(e, "Failed to load headers.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDto(null);
      return;
    }
    let alive = true;
    setLoadingDto(true);
    api
      .getHeader(selectedId)
      .then((d) => alive && setDto(d))
      .catch((e) => alive && onError(msg(e, "Failed to load header.")))
      .finally(() => alive && setLoadingDto(false));
    return () => {
      alive = false;
    };
  }, [selectedId, onError]);

  const reload = async () => setList(await api.listHeaders());

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    onError(null);
    try {
      const d = await api.createHeader({ name });
      setNewName("");
      await reload();
      setSelectedId(d.id);
    } catch (e) {
      onError(msg(e, "Couldn’t create the header."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!dto) return;
    if (
      !(await dialog.confirm({
        message: `Delete the header “${dto.name}”?`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    onError(null);
    try {
      await api.deleteHeader(dto.id);
      const remaining = list.filter((h) => h.id !== dto.id);
      await reload();
      setSelectedId(remaining[0]?.id ?? null);
    } catch (e) {
      onError(msg(e, "Couldn’t delete the header."));
    } finally {
      setBusy(false);
    }
  }

  async function move(dir: -1 | 1) {
    if (!dto) return;
    const idx = list.findIndex((h) => h.id === dto.id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= list.length) return;
    const ids = list.map((h) => h.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    setBusy(true);
    onError(null);
    try {
      setList(await api.reorderHeaders({ ids }));
    } catch (e) {
      onError(msg(e, "Couldn’t reorder headers."));
    } finally {
      setBusy(false);
    }
  }

  const idx = dto ? list.findIndex((h) => h.id === dto.id) : -1;

  return (
    <div className="menu-builder">
      <div className="card menu-list-card">
        <h2>Your headers</h2>
        {list.length === 0 ? (
          <p className="muted">No headers yet.</p>
        ) : (
          <ul className="menu-list">
            {list.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className={
                    h.id === selectedId
                      ? "menu-list-item active"
                      : "menu-list-item"
                  }
                  onClick={() => setSelectedId(h.id)}
                >
                  <span className="menu-list-name">
                    <span
                      className={h.enabled ? "hdr-dot on" : "hdr-dot"}
                      title={h.enabled ? "Enabled" : "Disabled"}
                    />
                    {h.name}
                  </span>
                  <span className="menu-list-meta">
                    <span className="badge badge--neutral">
                      {AUD_LABEL[h.audience]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {canCreate && (
          <div className="menu-create">
            <input
              value={newName}
              placeholder="New header name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <button
              className="btn btn--sm"
              onClick={create}
              disabled={busy || !newName.trim()}
            >
              Create
            </button>
          </div>
        )}
        <p className="profile-hint muted">
          Top of the list = highest priority. The first header whose rules match
          the visitor and page is shown; if none match, the built-in default is
          used.
        </p>
      </div>

      <div>
        {!selectedId ? (
          <div className="card">
            <p className="muted">
              {list.length
                ? "Select a header on the left to edit it."
                : "Create your first header to get started."}
            </p>
          </div>
        ) : loadingDto || !dto ? (
          <p className="muted">Loading…</p>
        ) : (
          <HeaderEditor
            key={dto.id}
            initial={dto}
            menus={menus}
            pages={pages}
            levels={levels}
            courses={courses}
            posts={posts}
            canEdit={canEdit}
            canDelete={canDelete}
            index={idx}
            count={list.length}
            busy={busy}
            onError={onError}
            onSaved={reload}
            onDelete={remove}
            onMove={move}
          />
        )}
      </div>
    </div>
  );
}

// =========================================================================
// Editor: name + conditions (placement) + style + live preview for one header.
// =========================================================================
function HeaderEditor({
  initial,
  menus,
  pages,
  levels,
  courses,
  posts,
  canEdit,
  canDelete,
  index,
  count,
  busy,
  onError,
  onSaved,
  onDelete,
  onMove,
}: {
  initial: HeaderDTO;
  menus: MenuListItem[];
  pages: PageListItem[];
  levels: LevelDTO[];
  courses: CourseCard[];
  posts: PostAdminRow[];
  canEdit: boolean;
  canDelete: boolean;
  index: number;
  count: number;
  busy: boolean;
  onError: (msg: string | null) => void;
  onSaved: () => void | Promise<void>;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState<HeaderDTO>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewLabels, setPreviewLabels] = useState<string[]>([]);

  const config = draft.config;
  const cond = draft.conditions;
  const ro = !canEdit;

  useEffect(() => {
    const id = config.menuId;
    if (!id) {
      setPreviewLabels([]);
      return;
    }
    let alive = true;
    api
      .getMenu(id)
      .then((m: MenuDTO) => alive && setPreviewLabels(m.items.map((i) => i.label)))
      .catch(() => alive && setPreviewLabels([]));
    return () => {
      alive = false;
    };
  }, [config.menuId]);

  const touch = () => setSaved(false);
  const setField = (patch: Partial<HeaderDTO>) => {
    setDraft((d) => ({ ...d, ...patch }));
    touch();
  };
  const updConfig = (patch: Partial<HeaderConfig>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
    touch();
  };
  const updCta = (id: string, patch: Partial<HeaderCta>) => {
    setDraft((d) => ({
      ...d,
      config: {
        ...d.config,
        ctas: d.config.ctas.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      },
    }));
    touch();
  };
  const addCta = () => {
    setDraft((d) => ({
      ...d,
      config: { ...d.config, ctas: [...d.config.ctas, makeCta()] },
    }));
    touch();
  };
  const removeCta = (id: string) => {
    setDraft((d) => ({
      ...d,
      config: { ...d.config, ctas: d.config.ctas.filter((x) => x.id !== id) },
    }));
    touch();
  };
  const updCond = (patch: Partial<HeaderConditions>) => {
    setDraft((d) => ({ ...d, conditions: { ...d.conditions, ...patch } }));
    touch();
  };

  async function save() {
    setSaving(true);
    onError(null);
    try {
      const next = await api.updateHeader(draft.id, {
        name: draft.name,
        enabled: draft.enabled,
        config: draft.config,
        conditions: draft.conditions,
      });
      setDraft(next);
      setSaved(true);
      await onSaved();
    } catch (e) {
      onError(msg(e, "Failed to save header."));
    } finally {
      setSaving(false);
    }
  }

  const labels = previewLabels.length
    ? previewLabels
    : ["Home", "Pricing", "Blog"];

  return (
    <div className="header-builder">
      {/* ---------- name / enabled / priority ---------- */}
      <div className="card">
        <div className="form-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Header name</label>
            <input
              value={draft.name}
              disabled={ro}
              onChange={(e) => setField({ name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <label className="menu-checkbox">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={ro}
                onChange={(e) => setField({ enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>
          {canEdit && count > 1 && (
            <div className="field" style={{ justifyContent: "flex-end" }}>
              <label>Priority</label>
              <span className="menu-node-actions">
                <button
                  className="nav-reorder-btn"
                  title="Higher priority"
                  disabled={busy || index <= 0}
                  onClick={() => onMove(-1)}
                >
                  ↑
                </button>
                <button
                  className="nav-reorder-btn"
                  title="Lower priority"
                  disabled={busy || index >= count - 1}
                  onClick={() => onMove(1)}
                >
                  ↓
                </button>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---------- placement / conditions ---------- */}
      <div className="card">
        <h2>Where this header shows</h2>
        <div className="form-row">
          <div className="field">
            <label>Audience</label>
            <select
              value={cond.audience}
              disabled={ro}
              onChange={(e) =>
                updCond({
                  audience: e.target.value as HeaderConditions["audience"],
                })
              }
            >
              <option value="ALL">Everyone</option>
              <option value="AUTHED">Logged-in members</option>
              <option value="GUEST">Logged-out visitors</option>
              <option value="LEVEL">Members of a specific class</option>
            </select>
          </div>
          {cond.audience === "LEVEL" && (
            <div className="field" style={{ flex: 2 }}>
              <label>Class</label>
              <select
                value={cond.audienceLevelId ?? ""}
                disabled={ro}
                onChange={(e) =>
                  updCond({ audienceLevelId: e.target.value || null })
                }
              >
                <option value="">— Select a class —</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Pages</label>
            <select
              value={cond.pageMode}
              disabled={ro}
              onChange={(e) =>
                updCond({
                  pageMode: e.target.value as HeaderConditions["pageMode"],
                })
              }
            >
              <option value="ALL">All pages</option>
              <option value="INCLUDE">Only specific pages</option>
            </select>
          </div>
        </div>

        {cond.pageMode === "INCLUDE" && (
          <div className="form-row">
            <div className="field">
              <label>Show on sections</label>
              <div className="checkbox-list">
                {SECTIONS.map((s) => (
                  <label key={s.value}>
                    <input
                      type="checkbox"
                      disabled={ro}
                      checked={cond.includeSections.includes(s.value)}
                      onChange={() =>
                        updCond({
                          includeSections: toggle(
                            cond.includeSections,
                            s.value,
                          ),
                        })
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Show on CMS pages</label>
              <div className="checkbox-list">
                {pages.length === 0 ? (
                  <span className="muted">No CMS pages.</span>
                ) : (
                  pages.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        disabled={ro}
                        checked={cond.includePageIds.includes(p.id)}
                        onChange={() =>
                          updCond({
                            includePageIds: toggle(cond.includePageIds, p.id),
                          })
                        }
                      />
                      {p.title}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="field">
            <label>
              Hide on sections <span className="muted">(optional)</span>
            </label>
            <div className="checkbox-list">
              {SECTIONS.map((s) => (
                <label key={s.value}>
                  <input
                    type="checkbox"
                    disabled={ro}
                    checked={cond.excludeSections.includes(s.value)}
                    onChange={() =>
                      updCond({
                        excludeSections: toggle(cond.excludeSections, s.value),
                      })
                    }
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>
              Hide on CMS pages <span className="muted">(optional)</span>
            </label>
            <div className="checkbox-list">
              {pages.length === 0 ? (
                <span className="muted">No CMS pages.</span>
              ) : (
                pages.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      disabled={ro}
                      checked={cond.excludePageIds.includes(p.id)}
                      onChange={() =>
                        updCond({
                          excludePageIds: toggle(cond.excludePageIds, p.id),
                        })
                      }
                    />
                    {p.title}
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- live preview ---------- */}
      <div className="hb-preview-card">
        <div className="hb-preview-label">Live preview</div>
        <div className="hb-preview" style={{ background: config.bgColor }}>
          <div
            className={
              config.layout === "THREE_COL" ? "hb-bar hb-bar--3" : "hb-bar hb-bar--2"
            }
            style={{
              maxWidth: config.width === "FULL" ? "100%" : config.maxWidth ?? 1080,
              padding: `${config.paddingY}px ${config.paddingX}px`,
            }}
          >
            <div className="hb-logo">
              {config.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.logoUrl} alt="" />
              ) : (
                <span className="hb-brand">{BRAND}</span>
              )}
            </div>
            <nav className="hb-menu">
              {labels.map((l, i) => (
                <span
                  key={i}
                  className="hb-link"
                  style={{
                    color:
                      i === 0
                        ? config.menuActiveColor ?? config.linkColor
                        : config.linkColor,
                    background:
                      i === 0 && config.menuActiveColor
                        ? `color-mix(in srgb, ${config.menuActiveColor} 14%, transparent)`
                        : "transparent",
                  }}
                >
                  {l}
                </span>
              ))}
            </nav>
            {config.layout === "THREE_COL" && (
              <div className="hb-ctas">
                {config.ctas.length === 0 ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    No CTAs yet
                  </span>
                ) : (
                  config.ctas.map((c) => (
                    <span
                      key={c.id}
                      className="hb-cta"
                      style={{
                        background: c.bgColor,
                        color: c.textColor,
                        padding: `${c.paddingY}px ${c.paddingX}px`,
                        borderRadius: c.borderRadius,
                      }}
                    >
                      {c.label || "Button"}
                    </span>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- layout & style ---------- */}
      <div className="card">
        <h2>Layout &amp; style</h2>
        <div className="form-row">
          <div className="field">
            <label>Columns</label>
            <select
              value={config.layout}
              disabled={ro}
              onChange={(e) =>
                updConfig({ layout: e.target.value as HeaderConfig["layout"] })
              }
            >
              <option value="TWO_COL">2 columns (logo · menu)</option>
              <option value="THREE_COL">3 columns (logo · menu · CTAs)</option>
            </select>
          </div>
          <div className="field">
            <label>Content width</label>
            <select
              value={config.width}
              disabled={ro}
              onChange={(e) =>
                updConfig({ width: e.target.value as HeaderConfig["width"] })
              }
            >
              <option value="BOXED">Boxed (centered)</option>
              <option value="FULL">Full width</option>
            </select>
          </div>
          {config.width === "BOXED" && (
            <div className="field">
              <label>Max width (px)</label>
              <input
                type="number"
                min={320}
                max={4000}
                value={config.maxWidth ?? 1080}
                disabled={ro}
                onChange={(e) =>
                  updConfig({ maxWidth: clamp(e.target.value, 320, 4000) })
                }
              />
            </div>
          )}
        </div>
        <div className="form-row">
          <ColorField
            label="Background"
            value={config.bgColor}
            disabled={ro}
            onChange={(v) => updConfig({ bgColor: v })}
          />
          <div className="field">
            <label>Padding Y (px)</label>
            <input
              type="number"
              min={0}
              max={80}
              value={config.paddingY}
              disabled={ro}
              onChange={(e) =>
                updConfig({ paddingY: clamp(e.target.value, 0, 80) })
              }
            />
          </div>
          <div className="field">
            <label>Padding X (px)</label>
            <input
              type="number"
              min={0}
              max={120}
              value={config.paddingX}
              disabled={ro}
              onChange={(e) =>
                updConfig({ paddingX: clamp(e.target.value, 0, 120) })
              }
            />
          </div>
        </div>
      </div>

      {/* ---------- logo & menu ---------- */}
      <div className="card">
        <h2>Logo &amp; menu</h2>
        <div className="field">
          <label>
            Logo image <span className="muted">(blank = “{BRAND}” text)</span>
          </label>
          <MediaPicker
            value={config.logoUrl ?? ""}
            disabled={ro}
            onChange={(url) => updConfig({ logoUrl: url || null })}
          />
        </div>
        <div className="form-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Menu</label>
            <select
              value={config.menuId ?? ""}
              disabled={ro}
              onChange={(e) => updConfig({ menuId: e.target.value || null })}
            >
              <option value="">— Use the menu assigned to “Header” —</option>
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              {config.menuId && !menus.some((m) => m.id === config.menuId) && (
                <option value={config.menuId}>(deleted menu)</option>
              )}
            </select>
          </div>
          <ColorField
            label="Link color"
            value={config.linkColor}
            disabled={ro}
            onChange={(v) => updConfig({ linkColor: v })}
          />
          <ColorField
            label="Active color"
            value={config.menuActiveColor ?? "#4f46e5"}
            disabled={ro}
            onChange={(v) => updConfig({ menuActiveColor: v })}
          />
        </div>
      </div>

      {/* ---------- CTAs (3-column only) ---------- */}
      {config.layout === "THREE_COL" && (
        <div className="card">
          <div className="card-head">
            <h2>CTA buttons</h2>
            {canEdit && (
              <button className="btn btn--sm" onClick={addCta}>
                + Add CTA
              </button>
            )}
          </div>
          {config.ctas.length === 0 ? (
            <p className="muted">No CTA buttons yet. Click “Add CTA”.</p>
          ) : (
            <div className="hb-cta-list">
              {config.ctas.map((c) => (
                <div key={c.id} className="hb-cta-row">
                  <div className="form-row">
                    <div className="field" style={{ flex: 2 }}>
                      <label>Label</label>
                      <input
                        value={c.label}
                        disabled={ro}
                        onChange={(e) => updCta(c.id, { label: e.target.value })}
                      />
                    </div>
                    <ColorField
                      label="Background"
                      value={c.bgColor}
                      disabled={ro}
                      onChange={(v) => updCta(c.id, { bgColor: v })}
                    />
                    <ColorField
                      label="Text"
                      value={c.textColor}
                      disabled={ro}
                      onChange={(v) => updCta(c.id, { textColor: v })}
                    />
                  </div>
                  <CtaTargetPicker
                    value={c.link}
                    disabled={ro}
                    pages={pages}
                    levels={levels}
                    courses={courses}
                    posts={posts}
                    onChange={(link) => updCta(c.id, { link })}
                  />
                  <div className="form-row">
                    <div className="field">
                      <label>Padding Y</label>
                      <input
                        type="number"
                        min={0}
                        max={40}
                        value={c.paddingY}
                        disabled={ro}
                        onChange={(e) =>
                          updCta(c.id, { paddingY: clamp(e.target.value, 0, 40) })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Padding X</label>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={c.paddingX}
                        disabled={ro}
                        onChange={(e) =>
                          updCta(c.id, { paddingX: clamp(e.target.value, 0, 60) })
                        }
                      />
                    </div>
                    <div className="field">
                      <label>Radius</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={c.borderRadius}
                        disabled={ro}
                        onChange={(e) =>
                          updCta(c.id, {
                            borderRadius: clamp(e.target.value, 0, 100),
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label className="menu-checkbox">
                        <input
                          type="checkbox"
                          checked={!!c.link.openNewTab}
                          disabled={ro}
                          onChange={(e) =>
                            updCta(c.id, {
                              link: { ...c.link, openNewTab: e.target.checked },
                            })
                          }
                        />
                        New tab
                      </label>
                    </div>
                    {canEdit && (
                      <div className="field" style={{ justifyContent: "flex-end" }}>
                        <label>&nbsp;</label>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => removeCta(c.id)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- actions ---------- */}
      {canEdit && (
        <div className="row-actions" style={{ alignItems: "center" }}>
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save header"}
          </button>
          {saved && (
            <span className="alert-success" style={{ padding: "6px 10px" }}>
              Saved ✓
            </span>
          )}
          {canDelete && (
            <button
              className="btn btn--danger"
              onClick={onDelete}
              disabled={busy}
              style={{ marginLeft: "auto" }}
            >
              Delete header
            </button>
          )}
        </div>
      )}
    </div>
  );
}
