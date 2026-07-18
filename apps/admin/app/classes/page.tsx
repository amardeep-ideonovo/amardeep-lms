"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  AudienceDTO,
  CourseCard,
  CreateLevelInput,
  LevelCategoryDTO,
  LevelDTO,
  LevelType,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import MediaPicker from "@/components/MediaPicker";
import RowMenu from "@/components/RowMenu";

type PriceForm = {
  interval: "month" | "year";
  amount: string;
  installments: string; // number of payments, then lifetime; "" = ongoing sub
};

const LEVEL_TYPES: LevelType[] = ["PAID", "FREE", "MANUAL"];

function emptyPrice(): PriceForm {
  return { interval: "month", amount: "", installments: "" };
}

export default function ClassesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [categories, setCategories] = useState<LevelCategoryDTO[]>([]);
  // Courses power the per-class COURSES/LESSONS columns (CourseCard.levelIds);
  // null = not readable by this admin, so those columns are hidden.
  const [courses, setCourses] = useState<CourseCard[] | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Published/Draft chip-bar filter for the management table.
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">(
    "all",
  );

  // create/edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<LevelType>("PAID");
  const [published, setPublished] = useState(false);
  const [audienceTags, setAudienceTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [audienceId, setAudienceId] = useState("");
  // Display name of the class's linked audience, kept only so the edit form can
  // label a stored audience that isn't in the fetched list (e.g. the picker
  // 403'd for a class-only admin). null = falls back to the id.
  const [audienceName, setAudienceName] = useState<string | null>(null);
  const [prices, setPrices] = useState<PriceForm[]>([emptyPrice()]);
  // ----- landing-page (MasterClass-style) fields -----
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [trailerUrl, setTrailerUrl] = useState("");
  const [skills, setSkills] = useState<{ title: string; imageUrl: string }[]>(
    []
  );
  // Completion-certificate template override ('' = use the default template).
  const [certificateTemplateId, setCertificateTemplateId] = useState("");
  const [certTemplates, setCertTemplates] = useState<
    { id: string; name: string; isDefault: boolean }[] | null
  >(null);
  const [saving, setSaving] = useState(false);
  // Create/edit happen in a modal (opened by the top button or a row's Edit).
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // In-house audiences for the picker. A class with no audience falls back to
  // the default "Members" audience at grant time. The endpoint is gated by the
  // 'contacts' permission, so a class-only admin gets an empty list (403) and
  // simply sees the default-audience option.
  const [audiences, setAudiences] = useState<AudienceDTO[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [lvls, cats] = await Promise.all([
        api.listLevels(),
        api.listLevelCategories(),
      ]);
      setLevels(lvls);
      setCategories(cats);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load classes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !can("classes", "read")) return;
    load();
    // Courses for the per-class counts. 403 (no permission) → hide columns.
    if (can("courses", "read")) {
      api
        .listCourses()
        .then(setCourses)
        .catch(() => setCourses(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Close the modal on Escape (mirrors the courses modal).
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  // Fetch the in-house audiences once for the picker. The endpoint needs the
  // 'contacts' read permission; a class-only admin gets a 403, which we treat
  // as "no audiences" — the picker then offers only the default audience.
  useEffect(() => {
    if (authLoading || !can("classes", "read")) return;
    let alive = true;
    api
      .listAudiences()
      .then((a) => alive && setAudiences(a))
      .catch(() => alive && setAudiences([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Certificate templates for the override select. Admins without the
  // certificates section just don't see the picker (403 -> null).
  useEffect(() => {
    if (authLoading || !can("classes", "read")) return;
    let alive = true;
    api
      .listCertificateTemplates()
      .then(
        (ts) =>
          alive &&
          setCertTemplates(
            ts.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault }))
          )
      )
      .catch(() => alive && setCertTemplates(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setSlug("");
    setType("PAID");
    setPublished(false);
    setAudienceTags([]);
    setTagInput("");
    setAudienceId("");
    setAudienceName(null);
    setPrices([emptyPrice()]);
    setCategoryIds([]);
    setImageUrl("");
    setDescription("");
    setTrailerUrl("");
    setSkills([]);
    setCertificateTemplateId("");
    setFormError(null);
  }
  function openCreate() {
    resetForm();
    setModalOpen(true);
  }
  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  function startEdit(level: LevelDTO) {
    setEditingId(level.id);
    setName(level.name);
    setSlug(level.slug ?? "");
    setType(level.type);
    setPublished(level.published);
    setAudienceTags(level.audienceTags ?? []);
    setTagInput("");
    setAudienceId(level.audienceId ?? "");
    setAudienceName(level.audienceName ?? null);
    setCategoryIds(level.categories?.map((c) => c.id) ?? []);
    setImageUrl(level.imageUrl ?? "");
    setDescription(level.description ?? "");
    setTrailerUrl(level.trailerUrl ?? "");
    setCertificateTemplateId(level.certificateTemplateId ?? "");
    setSkills(
      level.skills?.map((s) => ({
        title: s.title,
        imageUrl: s.imageUrl ?? "",
      })) ?? []
    );
    setPrices(
      level.prices.length
        ? level.prices.map((p) => ({
            interval: p.interval,
            amount: (p.amount / 100).toString(),
            installments: p.installments != null ? String(p.installments) : "",
          }))
        : [emptyPrice()]
    );
    setFormError(null);
    setModalOpen(true);
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !audienceTags.includes(t)) setAudienceTags((p) => [...p, t]);
    setTagInput("");
  }
  function removeTag(t: string) {
    setAudienceTags((p) => p.filter((x) => x !== t));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const cleanedPrices = prices
        .filter((p) => p.amount.trim() !== "")
        .map((p) => ({
          interval: p.interval,
          amount: Math.round(parseFloat(p.amount) * 100), // dollars -> cents
          installments: p.installments.trim()
            ? Math.round(Number(p.installments))
            : undefined,
        }));
      // Flush any tag still typed in the box but not yet added.
      const pending = tagInput.trim();
      const finalTags =
        pending && !audienceTags.includes(pending)
          ? [...audienceTags, pending]
          : audienceTags;
      const input: CreateLevelInput = {
        name: name.trim(),
        slug: slug.trim(),
        type,
        published,
        audienceTags: finalTags,
        audienceId: audienceId || undefined,
        categoryIds,
        imageUrl: imageUrl.trim(),
        description: description.trim(),
        trailerUrl: trailerUrl.trim(),
        skills: skills
          .filter((s) => s.title.trim())
          .map((s) => ({
            title: s.title.trim(),
            imageUrl: s.imageUrl.trim() || undefined,
          })),
        certificateTemplateId, // '' = clear back to the default template
        prices: type === "PAID" ? cleanedPrices : [],
      };
      if (editingId) await api.updateLevel(editingId, input);
      else await api.createLevel(input);
      setModalOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (
      !(await dialog.confirm({
        message:
          "Delete this class permanently? If any member still has access, deletion is blocked — archive it instead to keep their grants and issued certificates.",
        danger: true,
      }))
    )
      return;
    try {
      await api.deleteLevel(id);
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      // A 409 here carries the "archive instead" guidance from the API.
      setError(err instanceof ApiError ? err.message : "Delete failed");
    }
  }

  async function onArchive(id: string, archived: boolean) {
    try {
      if (archived) await api.unarchiveLevel(id);
      else await api.archiveLevel(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Archive failed");
    }
  }

  function updatePrice(i: number, patch: Partial<PriceForm>) {
    setPrices((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p))
    );
  }

  // ----- Skills (landing-page "Skills You'll Learn") -----
  function addSkill() {
    setSkills((p) => [...p, { title: "", imageUrl: "" }]);
  }
  function updateSkill(
    i: number,
    patch: Partial<{ title: string; imageUrl: string }>
  ) {
    setSkills((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeSkill(i: number) {
    setSkills((p) => p.filter((_, idx) => idx !== i));
  }

  // ----- Categories (admin-only grouping) -----
  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setError(null);
    try {
      await api.createLevelCategory(newCategory.trim());
      setNewCategory("");
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create category"
      );
    }
  }

  async function removeCategory(c: LevelCategoryDTO) {
    if (
      !(await dialog.confirm({
        message: `Remove category "${c.name}"? Classes in it will become uncategorized.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api.deleteLevelCategory(c.id);
      setCategoryIds((prev) => prev.filter((id) => id !== c.id));
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to remove category"
      );
    }
  }

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("classes", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Classes</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  const publishedLevels = levels.filter((l) => l.published);
  const draftLevels = levels.filter((l) => !l.published);
  const visible =
    statusFilter === "published"
      ? publishedLevels
      : statusFilter === "draft"
        ? draftLevels
        : levels;

  // Course/lesson counts per class, from the real course list (levelIds).
  const countsFor = (levelId: string) => {
    if (!courses) return null;
    const inClass = courses.filter((c) => c.levelIds.includes(levelId));
    return {
      courses: inClass.length,
      lessons: inClass.reduce((sum, c) => sum + c.lessonCount, 0),
    };
  };

  const planPill = (lvl: LevelDTO) => {
    if (lvl.type === "FREE")
      return <span className="badge badge--ok">Free</span>;
    if (lvl.type === "MANUAL")
      return <span className="badge badge--neutral">Manual</span>;
    const p = lvl.prices[0];
    const label = p
      ? `${(p.amount / 100).toLocaleString(undefined, {
          style: "currency",
          currency: p.currency || "USD",
          minimumFractionDigits: p.amount % 100 === 0 ? 0 : 2,
        })}/${p.interval === "year" ? "yr" : "mo"}`
      : "Paid";
    return <span className="badge badge--ink">{label}</span>;
  };

  const gridCols = courses
    ? "2.4fr .7fr .7fr .8fr .9fr 1fr .3fr"
    : "2.4fr .8fr .9fr 1fr .3fr";

  return (
    <div>
      {error && <p className="error">{error}</p>}

      {modalOpen && (
        <div
          className="modal-overlay"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "Edit class" : "Create class"}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {formError && <p className="error">{formError}</p>}
              <form onSubmit={onSubmit}>
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as LevelType)}
              >
                {LEVEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>
                Tags{" "}
                <span className="muted">
                  (applied within the audience when a member is granted this
                  class)
                </span>
              </label>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="Type a tag, press Enter"
              />
              {audienceTags.length > 0 && (
                <div className="chips" style={{ marginTop: 8 }}>
                  {audienceTags.map((t) => (
                    <span key={t} className="chip chip--muted">
                      {t}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={`Remove ${t}`}
                        title={`Remove ${t}`}
                        onClick={() => removeTag(t)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label>Visibility</label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 400,
              }}
            >
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              Published — show this class as a tile on the member dashboard
            </label>
          </div>

          <div className="field">
            <label>
              Checkout URL slug <span className="muted">(optional)</span>
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. pro"
            />
            <span className="muted" style={{ fontSize: 12 }}>
              {slug.trim()
                ? `Checkout URL: /checkout/${slug.trim()}`
                : "Leave blank to use the raw class id in the checkout URL."}
            </span>
          </div>

          <div className="field">
            <label>
              Audience{" "}
              <span className="muted">
                (members granted this class are subscribed to this audience; the
                tags are applied within it — leave as default to use the default
                “Members” audience)
              </span>
            </label>
            <select
              value={audienceId}
              onChange={(e) => setAudienceId(e.target.value)}
            >
              <option value="">— None (use the default audience) —</option>
              {/* keep the stored audience selectable even if it isn't in the
                  fetched list (e.g. the picker 403'd for a class-only admin) */}
              {audienceId &&
                !audiences.some((a) => a.id === audienceId) && (
                  <option value={audienceId}>{audienceName ?? audienceId}</option>
                )}
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            {audiences.length === 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                Using the default audience.
              </span>
            )}
          </div>

          {type === "PAID" && (
            <div className="field">
              <label>Prices</label>
              <span
                className="muted"
                style={{ fontSize: 12, display: "block", marginBottom: 8 }}
              >
                “Payments” bills that many times, then the member keeps the class
                for life. Leave it blank for an ongoing subscription.
              </span>
              {prices.map((p, i) => (
                <div className="form-row" key={i} style={{ marginBottom: 8 }}>
                  <select
                    value={p.interval}
                    onChange={(e) =>
                      updatePrice(i, {
                        interval: e.target.value as "month" | "year",
                      })
                    }
                  >
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount (USD)"
                    value={p.amount}
                    onChange={(e) => updatePrice(i, { amount: e.target.value })}
                  />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Payments"
                    title="Number of payments, then lifetime access. Blank = ongoing subscription."
                    value={p.installments}
                    onChange={(e) =>
                      updatePrice(i, { installments: e.target.value })
                    }
                    style={{ maxWidth: 130 }}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setPrices((prev) =>
                        prev.length > 1
                          ? prev.filter((_, idx) => idx !== i)
                          : prev
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPrices((prev) => [...prev, emptyPrice()])}
              >
                + Add price
              </button>
            </div>
          )}

          <div className="field">
            <label>Categories</label>
            {categories.length === 0 ? (
              <p className="muted">No categories yet — add one above.</p>
            ) : (
              <div className="checkbox-list">
                {categories.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(c.id)}
                      onChange={() => toggleCategory(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>
              Class image <span className="muted">(landing-page hero)</span>
            </label>
            <MediaPicker value={imageUrl} onChange={setImageUrl} />
          </div>

          <div className="field">
            <label>
              Description <span className="muted">(landing page)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ minHeight: 80 }}
              placeholder="What this class teaches…"
            />
          </div>

          <div className="field">
            <label>
              Trailer{" "}
              <span className="muted">
                (upload a video or paste a Vimeo/MP4 link)
              </span>
            </label>
            <MediaPicker
              value={trailerUrl}
              onChange={setTrailerUrl}
              kind="video"
            />
          </div>

          {certTemplates !== null && (
            <div className="field">
              <label>
                Certificate template{" "}
                <span className="muted">
                  (members get it after completing every lesson)
                </span>
              </label>
              <select
                value={certificateTemplateId}
                onChange={(e) => setCertificateTemplateId(e.target.value)}
              >
                <option value="">
                  Use default
                  {(() => {
                    const d = certTemplates.find((t) => t.isDefault);
                    return d ? ` (${d.name})` : " (none set — certificates off)";
                  })()}
                </option>
                {certTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Skills you&apos;ll learn</label>
            {skills.length === 0 ? (
              <p className="muted">No skills yet — add the first below.</p>
            ) : (
              skills.map((s, i) => (
                <div
                  className="form-row"
                  key={i}
                  style={{ marginBottom: 12, alignItems: "flex-start" }}
                >
                  <input
                    placeholder="Skill title"
                    value={s.title}
                    onChange={(e) => updateSkill(i, { title: e.target.value })}
                  />
                  <div style={{ flex: 1 }}>
                    <MediaPicker
                      value={s.imageUrl}
                      onChange={(url) => updateSkill(i, { imageUrl: url })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => removeSkill(i)}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addSkill}
            >
              + Add skill
            </button>
          </div>

                <div className="row-actions">
                  <button className="btn" type="submit" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : editingId
                        ? "Update class"
                        : "Create class"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeModal}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* chip bar: All / Published / Draft + primary CTA */}
      <div className="chipbar">
        <button
          type="button"
          className={
            statusFilter === "all" ? "chipbar-chip chipbar-chip--on" : "chipbar-chip"
          }
          onClick={() => setStatusFilter("all")}
        >
          All · {levels.length}
        </button>
        <button
          type="button"
          className={
            statusFilter === "published"
              ? "chipbar-chip chipbar-chip--on"
              : "chipbar-chip"
          }
          onClick={() => setStatusFilter("published")}
        >
          Published · {publishedLevels.length}
        </button>
        <button
          type="button"
          className={
            statusFilter === "draft"
              ? "chipbar-chip chipbar-chip--on"
              : "chipbar-chip"
          }
          onClick={() => setStatusFilter("draft")}
        >
          Draft · {draftLevels.length}
        </button>
        <div className="filter-spacer" />
        {can("classes", "create") && (
          <button className="btn" onClick={openCreate}>
            + New class
          </button>
        )}
      </div>

      {/* management table */}
      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : levels.length === 0 ? (
          <p className="muted">No classes yet — click “+ New class”.</p>
        ) : (
          <>
            <div
              className="mini-grid mini-grid--head"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span>Class</span>
              {courses && <span>Courses</span>}
              {courses && <span>Lessons</span>}
              <span>Enrolled</span>
              <span>Plan</span>
              <span>Status</span>
              <span />
            </div>
            {visible.map((lvl) => {
              const counts = countsFor(lvl.id);
              return (
                <div
                  className="mini-grid"
                  style={{ gridTemplateColumns: gridCols }}
                  key={lvl.id}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    {lvl.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lvl.imageUrl} alt="" className="row-thumb" />
                    ) : (
                      <span className="row-thumb row-thumb--empty" aria-hidden="true">
                        —
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink-800)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {lvl.name}
                    </span>
                  </span>
                  {courses && <span className="mini-cell">{counts?.courses ?? "—"}</span>}
                  {courses && <span className="mini-cell">{counts?.lessons ?? "—"}</span>}
                  <span
                    className="mini-cell"
                    style={{ fontWeight: 600, color: "var(--ink-800)" }}
                  >
                    {lvl.memberCount}
                  </span>
                  <span>{planPill(lvl)}</span>
                  <span
                    className={
                      lvl.published
                        ? "dot-status dot-status--ok"
                        : "dot-status dot-status--warn"
                    }
                  >
                    <span className="dot" />
                    {lvl.published ? "Published" : "Draft"}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <RowMenu
                      label={`Actions for ${lvl.name}`}
                      items={[
                        { label: "Edit", onClick: () => startEdit(lvl) },
                        {
                          label: lvl.archivedAt ? "Unarchive" : "Archive",
                          onClick: () => onArchive(lvl.id, !!lvl.archivedAt),
                        },
                        {
                          label: "Delete",
                          danger: true,
                          onClick: () => onDelete(lvl.id),
                        },
                      ]}
                    />
                  </span>
                </div>
              );
            })}
            <div className="table-foot">
              Showing {visible.length} of {levels.length} classes
            </div>
          </>
        )}
      </div>

      {/* categories (admin-only grouping) */}
      <div className="card">
        <h2>Categories</h2>
        <form onSubmit={createCategory} className="row-actions">
          <input
            placeholder="Category name"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <button className="btn" type="submit">
            Add category
          </button>
        </form>
        {categories.length > 0 && (
          <div className="chips" style={{ marginTop: 12 }}>
            {categories.map((c) => (
              <span key={c.id} className="chip chip--muted">
                {c.name}
                <button
                  type="button"
                  className="chip-x"
                  aria-label={`Remove ${c.name}`}
                  title={`Remove ${c.name}`}
                  onClick={() => removeCategory(c)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
