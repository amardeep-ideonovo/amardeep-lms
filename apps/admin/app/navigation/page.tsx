"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CourseCard,
  LevelDTO,
  MenuDTO,
  MenuItemDTO,
  MenuItemType,
  MenuItemVisibility,
  MenuListItem,
  MenuLocation,
  MenuReorderNode,
  PageListItem,
  PostAdminRow,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

const LOCATION_LABELS: Record<MenuLocation, string> = {
  HEADER: "Header",
  FOOTER: "Footer",
  MOBILE: "Mobile",
};
const TYPE_BADGE: Record<MenuItemType, string> = {
  PAGE: "Page",
  CLASS: "Class",
  CLASS_INDEX: "Classes",
  COURSE: "Course",
  COURSE_INDEX: "Courses",
  BLOG_INDEX: "Blog",
  BLOG_POST: "Post",
  ROUTE: "Link",
  CUSTOM: "Link",
};
// Add-item types the picker offers (ROUTE is handled by Custom link).
const ADD_TYPES: { value: MenuItemType; label: string }[] = [
  { value: "PAGE", label: "CMS Page" },
  { value: "CLASS", label: "Class" },
  { value: "CLASS_INDEX", label: "Classes index" },
  { value: "COURSE", label: "Course" },
  { value: "COURSE_INDEX", label: "Courses index" },
  { value: "BLOG_INDEX", label: "Blog index" },
  { value: "BLOG_POST", label: "Blog post" },
  { value: "CUSTOM", label: "Custom link" },
];
const VIS_OPTIONS: { value: MenuItemVisibility; label: string }[] = [
  { value: "ALL", label: "Everyone" },
  { value: "GUEST", label: "Guests only (logged-out)" },
  { value: "AUTHED", label: "Logged-in members" },
  { value: "LEVEL", label: "Holders of a specific class" },
];

// ---------- tree helpers ----------
function cloneTree(items: MenuItemDTO[]): MenuItemDTO[] {
  return items.map((i) => ({ ...i, children: cloneTree(i.children) }));
}
function locate(
  items: MenuItemDTO[],
  id: string,
  parent: MenuItemDTO | null = null,
): { siblings: MenuItemDTO[]; index: number; parent: MenuItemDTO | null } | null {
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) return { siblings: items, index: idx, parent };
  for (const it of items) {
    const r = locate(it.children, id, it);
    if (r) return r;
  }
  return null;
}
function buildOrder(
  items: MenuItemDTO[],
  parentId: string | null = null,
): MenuReorderNode[] {
  const out: MenuReorderNode[] = [];
  items.forEach((it, i) => {
    out.push({ id: it.id, parentId, order: i });
    out.push(...buildOrder(it.children, it.id));
  });
  return out;
}
function flatten(
  items: MenuItemDTO[],
  depth = 0,
): { item: MenuItemDTO; depth: number }[] {
  const out: { item: MenuItemDTO; depth: number }[] = [];
  for (const it of items) {
    out.push({ item: it, depth });
    out.push(...flatten(it.children, depth + 1));
  }
  return out;
}

export default function MenusPage() {
  const { can, loading: authLoading } = useAdminAuth();

  const [menus, setMenus] = useState<MenuListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // picker sources
  const [pages, setPages] = useState<PageListItem[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [posts, setPosts] = useState<PostAdminRow[]>([]);

  // create-menu + header edit
  const [newName, setNewName] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerLoc, setHeaderLoc] = useState<MenuLocation | "">("");

  // add-item form
  const [addType, setAddType] = useState<MenuItemType>("PAGE");
  const [addTarget, setAddTarget] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addLabel, setAddLabel] = useState("");

  // inline item editing
  const [editId, setEditId] = useState<string | null>(null);

  const canEdit = can("menus", "edit");
  const canCreate = can("menus", "create");
  const canDelete = can("menus", "delete");

  useEffect(() => {
    if (authLoading || !can("menus", "read")) return;
    Promise.all([
      api.listMenus(),
      api.listPages().catch(() => [] as PageListItem[]),
      api.listLevels().catch(() => [] as LevelDTO[]),
      api.listCourses().catch(() => [] as CourseCard[]),
      api.listPosts().catch(() => [] as PostAdminRow[]),
    ])
      .then(([m, pg, lv, cs, ps]) => {
        setMenus(m);
        setPages(pg);
        setLevels(lv);
        setCourses(cs);
        setPosts(ps);
        if (m.length && !selectedId) setSelectedId(m[0].id);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load menus."),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Load the selected menu's full tree.
  useEffect(() => {
    if (!selectedId) {
      setMenu(null);
      return;
    }
    api
      .getMenu(selectedId)
      .then((m) => {
        setMenu(m);
        setHeaderName(m.name);
        setHeaderLoc(m.location ?? "");
        setEditId(null);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load menu."),
      );
  }, [selectedId]);

  const levelName = useMemo(
    () => new Map(levels.map((l) => [l.id, l.name])),
    [levels],
  );

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("menus", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Navigation</h1>
        </div>
        <p className="muted">You don’t have permission to view menus.</p>
      </div>
    );

  // ---------- mutations ----------
  async function reloadMenus() {
    setMenus(await api.listMenus());
  }

  async function createMenu() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const m = await api.createMenu({ name });
      setNewName("");
      await reloadMenus();
      setSelectedId(m.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t create the menu.");
    } finally {
      setBusy(false);
    }
  }

  async function saveHeader() {
    if (!menu) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateMenu(menu.id, {
        name: headerName.trim() || menu.name,
        location: headerLoc === "" ? null : headerLoc,
      });
      setMenu(updated);
      await reloadMenus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t save the menu.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMenu() {
    if (!menu) return;
    if (
      !(await dialog.confirm({
        message: `Delete the menu “${menu.name}” and all its items?`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api.deleteMenu(menu.id);
      const next = menus.filter((m) => m.id !== menu.id);
      await reloadMenus();
      setSelectedId(next[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t delete the menu.");
    } finally {
      setBusy(false);
    }
  }

  // suggested label when a target is picked
  function targetTitle(type: MenuItemType, id: string): string {
    if (type === "PAGE") return pages.find((p) => p.id === id)?.title ?? "";
    if (type === "CLASS") return levels.find((l) => l.id === id)?.name ?? "";
    if (type === "COURSE") return courses.find((c) => c.id === id)?.title ?? "";
    if (type === "BLOG_POST") return posts.find((p) => p.id === id)?.title ?? "";
    return "";
  }

  async function addItem() {
    if (!menu) return;
    const type = addType;
    let label = addLabel.trim();
    const payload: {
      label: string;
      type: MenuItemType;
      pageId?: string;
      levelId?: string;
      courseId?: string;
      postId?: string;
      url?: string;
    } = { label: "", type };
    if (type === "PAGE") payload.pageId = addTarget;
    else if (type === "CLASS") payload.levelId = addTarget;
    else if (type === "COURSE") payload.courseId = addTarget;
    else if (type === "BLOG_POST") payload.postId = addTarget;
    else if (type === "CUSTOM") payload.url = addUrl.trim();
    // validation
    if (type === "CUSTOM" && !payload.url) {
      setError("Enter a URL for the custom link.");
      return;
    }
    if (
      (type === "PAGE" ||
        type === "CLASS" ||
        type === "COURSE" ||
        type === "BLOG_POST") &&
      !addTarget
    ) {
      setError("Pick a target for this item.");
      return;
    }
    if (!label) {
      if (type === "BLOG_INDEX") label = "Blog";
      else if (type === "CLASS_INDEX") label = "Classes";
      else if (type === "COURSE_INDEX") label = "Courses";
      else if (type === "CUSTOM") label = addUrl.trim();
      else label = targetTitle(type, addTarget) || "Untitled";
    }
    payload.label = label;

    setBusy(true);
    setError(null);
    try {
      const updated = await api.addMenuItem(menu.id, payload);
      setMenu(updated);
      await reloadMenus();
      setAddTarget("");
      setAddUrl("");
      setAddLabel("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t add the item.");
    } finally {
      setBusy(false);
    }
  }

  async function applyStructural(mutate: (tree: MenuItemDTO[]) => void) {
    if (!menu) return;
    const tree = cloneTree(menu.items);
    mutate(tree);
    setMenu({ ...menu, items: tree }); // optimistic
    try {
      const updated = await api.reorderMenuItems(menu.id, {
        items: buildOrder(tree),
      });
      setMenu(updated);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t reorder.");
      if (selectedId) api.getMenu(selectedId).then(setMenu).catch(() => {});
    }
  }

  const moveUp = (id: string) =>
    applyStructural((tree) => {
      const l = locate(tree, id);
      if (l && l.index > 0)
        [l.siblings[l.index - 1], l.siblings[l.index]] = [
          l.siblings[l.index],
          l.siblings[l.index - 1],
        ];
    });
  const moveDown = (id: string) =>
    applyStructural((tree) => {
      const l = locate(tree, id);
      if (l && l.index < l.siblings.length - 1)
        [l.siblings[l.index + 1], l.siblings[l.index]] = [
          l.siblings[l.index],
          l.siblings[l.index + 1],
        ];
    });
  const indent = (id: string) =>
    applyStructural((tree) => {
      const l = locate(tree, id);
      if (l && l.index > 0) {
        const prev = l.siblings[l.index - 1];
        const [item] = l.siblings.splice(l.index, 1);
        prev.children.push(item);
      }
    });
  const outdent = (id: string) =>
    applyStructural((tree) => {
      const l = locate(tree, id);
      if (l && l.parent) {
        const [item] = l.siblings.splice(l.index, 1);
        const p = locate(tree, l.parent.id);
        if (p) p.siblings.splice(p.index + 1, 0, item);
        else tree.push(item);
      }
    });

  async function deleteItem(id: string) {
    if (
      !(await dialog.confirm({ message: "Remove this menu item?", danger: true }))
    )
      return;
    try {
      const updated = await api.deleteMenuItem(id);
      setMenu(updated);
      await reloadMenus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t remove the item.");
    }
  }

  const rows = menu ? flatten(menu.items) : [];

  return (
    <div>
      <div className="page-header">
        <h1>Navigation</h1>
        <p className="subtitle">
          Build navigation menus and assign them to the site header, footer,
          mobile, or a page. Items can be gated by membership.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="menu-builder">
        {/* ----- left: menu list ----- */}
        <div className="card menu-list-card">
          <h2>Your menus</h2>
          {menus.length === 0 ? (
            <p className="muted">No menus yet.</p>
          ) : (
            <ul className="menu-list">
              {menus.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={
                      m.id === selectedId
                        ? "menu-list-item active"
                        : "menu-list-item"
                    }
                    onClick={() => setSelectedId(m.id)}
                  >
                    <span className="menu-list-name">{m.name}</span>
                    <span className="menu-list-meta">
                      {m.location && (
                        <span className="badge badge--info">
                          {LOCATION_LABELS[m.location]}
                        </span>
                      )}
                      <span className="muted">{m.itemCount}</span>
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
                placeholder="New menu name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createMenu()}
              />
              <button
                className="btn btn--sm"
                onClick={createMenu}
                disabled={busy || !newName.trim()}
              >
                Create
              </button>
            </div>
          )}
        </div>

        {/* ----- right: selected menu editor ----- */}
        {menu ? (
          <div className="menu-editor">
            <div className="card">
              <div className="form-row">
                <div className="field" style={{ flex: 2 }}>
                  <label>Menu name</label>
                  <input
                    value={headerName}
                    disabled={!canEdit}
                    onChange={(e) => setHeaderName(e.target.value)}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Location</label>
                  <select
                    value={headerLoc}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setHeaderLoc(e.target.value as MenuLocation | "")
                    }
                  >
                    <option value="">— Not assigned —</option>
                    <option value="HEADER">Header</option>
                    <option value="FOOTER">Footer</option>
                    <option value="MOBILE">Mobile</option>
                  </select>
                </div>
              </div>
              <span className="muted profile-hint">
                A location holds one menu — assigning here moves it off any other
                menu. Unassigned menus can still be embedded in a page.
              </span>
              <div className="row-actions" style={{ marginTop: 14 }}>
                {canEdit && (
                  <button className="btn" onClick={saveHeader} disabled={busy}>
                    Save menu
                  </button>
                )}
                {canDelete && (
                  <button
                    className="btn btn--danger"
                    onClick={removeMenu}
                    disabled={busy}
                  >
                    Delete menu
                  </button>
                )}
              </div>
            </div>

            {/* add items */}
            {canEdit && (
              <div className="card">
                <h2>Add item</h2>
                <div className="form-row">
                  <div className="field">
                    <label>Type</label>
                    <select
                      value={addType}
                      onChange={(e) => {
                        setAddType(e.target.value as MenuItemType);
                        setAddTarget("");
                        setAddUrl("");
                      }}
                    >
                      {ADD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 2 }}>
                    <label>Target</label>
                    {addType === "PAGE" && (
                      <select
                        value={addTarget}
                        onChange={(e) => {
                          setAddTarget(e.target.value);
                          if (!addLabel)
                            setAddLabel(targetTitle("PAGE", e.target.value));
                        }}
                      >
                        <option value="">— Select a page —</option>
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {addType === "CLASS" && (
                      <select
                        value={addTarget}
                        onChange={(e) => {
                          setAddTarget(e.target.value);
                          if (!addLabel)
                            setAddLabel(targetTitle("CLASS", e.target.value));
                        }}
                      >
                        <option value="">— Select a class —</option>
                        {levels.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {addType === "COURSE" && (
                      <select
                        value={addTarget}
                        onChange={(e) => {
                          setAddTarget(e.target.value);
                          if (!addLabel)
                            setAddLabel(targetTitle("COURSE", e.target.value));
                        }}
                      >
                        <option value="">— Select a course —</option>
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {addType === "BLOG_POST" && (
                      <select
                        value={addTarget}
                        onChange={(e) => {
                          setAddTarget(e.target.value);
                          if (!addLabel)
                            setAddLabel(targetTitle("BLOG_POST", e.target.value));
                        }}
                      >
                        <option value="">— Select a post —</option>
                        {posts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {addType === "CUSTOM" && (
                      <input
                        value={addUrl}
                        placeholder="https://example.com or /dashboard"
                        onChange={(e) => setAddUrl(e.target.value)}
                      />
                    )}
                    {addType === "BLOG_INDEX" && (
                      <input value="/blog" disabled />
                    )}
                    {addType === "CLASS_INDEX" && (
                      <input value="/pricing/all" disabled />
                    )}
                    {addType === "COURSE_INDEX" && (
                      <input value="/dashboard" disabled />
                    )}
                  </div>
                </div>
                <div className="form-row">
                  <div className="field" style={{ flex: 2 }}>
                    <label>
                      Label <span className="muted">(optional)</span>
                    </label>
                    <input
                      value={addLabel}
                      placeholder="Navigation label"
                      onChange={(e) => setAddLabel(e.target.value)}
                    />
                  </div>
                  <div
                    className="field"
                    style={{ flex: 1, justifyContent: "flex-end" }}
                  >
                    <label>&nbsp;</label>
                    <button
                      className="btn"
                      onClick={addItem}
                      disabled={busy}
                    >
                      + Add to menu
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* structure */}
            <div className="card">
              <h2>Menu structure</h2>
              {rows.length === 0 ? (
                <p className="muted">
                  No items yet — add some above. Use ↑ ↓ to reorder and → ← to
                  nest (create dropdowns).
                </p>
              ) : (
                <div className="menu-tree">
                  {rows.map(({ item, depth }) => (
                    <div key={item.id} className="menu-node">
                      <div
                        className="menu-node-row"
                        style={{ marginLeft: depth * 22 }}
                      >
                        <span className="badge badge--neutral menu-node-type">
                          {TYPE_BADGE[item.type]}
                        </span>
                        <span className="menu-node-label">{item.label}</span>
                        {item.visibility !== "ALL" && (
                          <span className="badge badge--warn menu-node-vis">
                            {item.visibility === "LEVEL"
                              ? levelName.get(item.visibilityLevelId ?? "") ||
                                "Class"
                              : item.visibility === "GUEST"
                                ? "Guests"
                                : "Members"}
                          </span>
                        )}
                        {canEdit && (
                          <span className="menu-node-actions">
                            <button
                              className="nav-reorder-btn"
                              title="Move up"
                              onClick={() => moveUp(item.id)}
                            >
                              ↑
                            </button>
                            <button
                              className="nav-reorder-btn"
                              title="Move down"
                              onClick={() => moveDown(item.id)}
                            >
                              ↓
                            </button>
                            <button
                              className="nav-reorder-btn"
                              title="Indent (nest)"
                              onClick={() => indent(item.id)}
                            >
                              →
                            </button>
                            <button
                              className="nav-reorder-btn"
                              title="Outdent"
                              onClick={() => outdent(item.id)}
                            >
                              ←
                            </button>
                            <button
                              className="btn btn--ghost btn--sm"
                              onClick={() =>
                                setEditId(editId === item.id ? null : item.id)
                              }
                            >
                              {editId === item.id ? "Close" : "Edit"}
                            </button>
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => deleteItem(item.id)}
                            >
                              ✕
                            </button>
                          </span>
                        )}
                      </div>
                      {editId === item.id && (
                        <ItemEditor
                          item={item}
                          levels={levels}
                          onSaved={(m) => {
                            setMenu(m);
                            setEditId(null);
                            reloadMenus();
                          }}
                          onError={setError}
                          style={{ marginLeft: depth * 22 }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            <p className="muted">
              {menus.length
                ? "Select a menu on the left to edit it."
                : "Create your first menu to get started."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- inline item editor ----------
function ItemEditor({
  item,
  levels,
  onSaved,
  onError,
  style,
}: {
  item: MenuItemDTO;
  levels: LevelDTO[];
  onSaved: (m: MenuDTO) => void;
  onError: (msg: string) => void;
  style?: React.CSSProperties;
}) {
  const [label, setLabel] = useState(item.label);
  const [newTab, setNewTab] = useState(item.openNewTab);
  const [visibility, setVisibility] = useState<MenuItemVisibility>(
    item.visibility,
  );
  const [levelId, setLevelId] = useState(item.visibilityLevelId ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateMenuItem(item.id, {
        label: label.trim() || item.label,
        openNewTab: newTab,
        visibility,
        visibilityLevelId: visibility === "LEVEL" ? levelId || null : null,
      });
      onSaved(updated);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Couldn’t save the item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="menu-node-edit" style={style}>
      <div className="form-row">
        <div className="field" style={{ flex: 2 }}>
          <label>Navigation label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Visibility</label>
          <select
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as MenuItemVisibility)
            }
          >
            {VIS_OPTIONS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        {visibility === "LEVEL" && (
          <div className="field" style={{ flex: 2 }}>
            <label>Required class</label>
            <select
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
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
        <div className="field" style={{ flex: 1 }}>
          <label className="menu-checkbox">
            <input
              type="checkbox"
              checked={newTab}
              onChange={(e) => setNewTab(e.target.checked)}
            />
            Open in a new tab
          </label>
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn--sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save item"}
        </button>
      </div>
    </div>
  );
}
