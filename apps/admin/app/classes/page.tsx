"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  AudienceDTO,
  CourseCard,
  CreateLevelInput,
  LevelCategoryDTO,
  LevelDTO,
  LevelType,
} from "@lms/types";
import { slugify } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { usePersistedDraft } from "@/lib/usePersistedDraft";
import ModalFooter from "@/components/ModalFooter";
import FormModal from "@/components/FormModal";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import MediaPicker from "@/components/MediaPicker";
import RichTextEditor from "@/components/RichTextEditor";
import RowMenu from "@/components/RowMenu";
import { useToast } from "@/components/ToastProvider";
import {
  OPTIMISTIC_NETWORK_MODE,
  mutationErrorMessage,
  useMountedRef,
} from "@/lib/mutations";
import { STR } from "@lms/types";
import { Button } from "@lms/ui";

type PriceForm = {
  interval: "month" | "year";
  amount: string;
  installments: string; // number of payments, then lifetime; "" = ongoing sub
};

const LEVEL_TYPES: LevelType[] = ["PAID", "FREE"];

// An archive/unarchive write. `archived` is the row's CURRENT state (true →
// unarchive); `current` is the pre-write slice the rollback restores.
type ArchiveVars = {
  id: string;
  archived: boolean;
  current: Pick<LevelDTO, "archivedAt" | "published">;
};

function emptyPrice(): PriceForm {
  return { interval: "month", amount: "", installments: "" };
}

export default function ClassesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const toast = useToast();
  const mounted = useMountedRef();
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [categories, setCategories] = useState<LevelCategoryDTO[]>([]);
  // Courses power the per-class COURSES/LESSONS columns (CourseCard.levelIds);
  // null = not readable by this admin, so those columns are hidden.
  const [courses, setCourses] = useState<CourseCard[] | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Names the class whose archive/delete is mid-flight so its row menu locks.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Published/Draft chip-bar filter for the management table.
  const [statusFilter, setStatusFilter] = useState<
    "all" | "published" | "draft"
  >("all");
  // Free-text search (name or slug), composed with the status chips.
  const [search, setSearch] = useState("");

  // create/edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Whether the admin has hand-edited the slug. While false, the slug live-fills
  // from the name; once they type in the slug box we stop clobbering it.
  const [slugEdited, setSlugEdited] = useState(false);
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
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [description, setDescription] = useState("");
  const [trailerUrl, setTrailerUrl] = useState("");
  const [skills, setSkills] = useState<{ title: string; imageUrl: string }[]>(
    [],
  );
  // Completion-certificate template for this class ('' = no certificate; opt-in).
  const [certificateTemplateId, setCertificateTemplateId] = useState("");
  const [certTemplates, setCertTemplates] = useState<
    { id: string; name: string }[] | null
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

  // Persist a half-filled class form to localStorage so it resumes if the modal
  // is closed and reopened. Scattered-state adapter: gather() lists the same
  // fields resetForm/startEdit seed; restore() writes a saved snapshot back.
  const draft = usePersistedDraft({
    formKey: "classes",
    version: 1,
    entityId: editingId,
    open: modalOpen,
    data: {
      categoryIds,
      name,
      slug,
      slugEdited,
      type,
      published,
      audienceTags,
      audienceId,
      audienceName,
      prices,
      imageUrl,
      thumbnailUrl,
      description,
      trailerUrl,
      skills,
      certificateTemplateId,
    },
    restore: (d) => {
      setCategoryIds(d.categoryIds);
      setName(d.name);
      setSlug(d.slug);
      setSlugEdited(d.slugEdited);
      setType(d.type);
      setPublished(d.published);
      setAudienceTags(d.audienceTags);
      setAudienceId(d.audienceId);
      setAudienceName(d.audienceName);
      setPrices(d.prices);
      setImageUrl(d.imageUrl);
      setThumbnailUrl(d.thumbnailUrl);
      setDescription(d.description);
      setTrailerUrl(d.trailerUrl);
      setSkills(d.skills);
      setCertificateTemplateId(d.certificateTemplateId);
    },
  });

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
      setError(
        err instanceof ApiError ? err.message : "Failed to load classes",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !can("classes", "read")) return;
    void load();
    // Courses for the per-class counts. 403 (no permission) → hide columns.
    if (can("courses", "read")) {
      api
        .listCourses()
        .then(setCourses)
        .catch(() => setCourses(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // The create/edit form modal is DELIBERATELY not dismissable by accident:
  // neither Escape nor a backdrop click closes it, so a stray keypress or misclick
  // can never discard in-progress input. Dismiss explicitly via Cancel or ×, or Save.

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

  // Certificate templates for the per-class picker. Admins without the
  // certificates section just don't see the picker (403 -> null).
  useEffect(() => {
    if (authLoading || !can("classes", "read")) return;
    let alive = true;
    api
      .listCertificateTemplates()
      .then(
        (ts) =>
          alive &&
          setCertTemplates(ts.map((t) => ({ id: t.id, name: t.name }))),
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
    setSlugEdited(false); // a fresh create live-fills the slug from the name
    setType("PAID");
    setPublished(false);
    setAudienceTags([]);
    setTagInput("");
    setAudienceId("");
    setAudienceName(null);
    setPrices([emptyPrice()]);
    setCategoryIds([]);
    setImageUrl("");
    setThumbnailUrl("");
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
    setSlugEdited(true); // editing an existing class must not clobber its slug
    setType(level.type);
    setPublished(level.published);
    setAudienceTags(level.audienceTags ?? []);
    setTagInput("");
    setAudienceId(level.audienceId ?? "");
    setAudienceName(level.audienceName ?? null);
    setCategoryIds(level.categories?.map((c) => c.id) ?? []);
    setImageUrl(level.imageUrl ?? "");
    setThumbnailUrl(level.thumbnailUrl ?? "");
    setDescription(level.description ?? "");
    setTrailerUrl(level.trailerUrl ?? "");
    setCertificateTemplateId(level.certificateTemplateId ?? "");
    setSkills(
      level.skills?.map((s) => ({
        title: s.title,
        imageUrl: s.imageUrl ?? "",
      })) ?? [],
    );
    setPrices(
      level.prices.length
        ? level.prices.map((p) => ({
            interval: p.interval,
            amount: (p.amount / 100).toString(),
            installments: p.installments != null ? String(p.installments) : "",
          }))
        : [emptyPrice()],
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
        // When untouched, send "" so the server derives the slug from the name
        // AND keeps its uniqueness suffixing (-2/-3); the box was just a live
        // preview. When the admin typed a slug, send it explicitly.
        slug: slugEdited ? slug.trim() : "",
        type,
        published,
        audienceTags: finalTags,
        audienceId: audienceId || undefined,
        categoryIds,
        imageUrl: imageUrl.trim(),
        thumbnailUrl: thumbnailUrl.trim(),
        description: description.trim(),
        trailerUrl: trailerUrl.trim(),
        skills: skills
          .filter((s) => s.title.trim())
          .map((s) => ({
            title: s.title.trim(),
            imageUrl: s.imageUrl.trim() || undefined,
          })),
        certificateTemplateId, // '' = no certificate for this class (opt-in)
        prices: type === "PAID" ? cleanedPrices : [],
      };
      // Both writes now return the same fully-populated LevelDTO the list does,
      // member count included, so the response IS the new row. The list is
      // ordered by createdAt asc — unique and immutable — so an edit keeps its
      // slot and a new class belongs at the end.
      const saved = editingId
        ? await api.updateLevel(editingId, input)
        : await api.createLevel(input);
      setLevels((prev) =>
        editingId
          ? prev.map((l) => (l.id === saved.id ? saved : l))
          : [...prev, saved],
      );
      draft.clearSaved(); // saved successfully → drop the persisted draft
      setModalOpen(false);
      resetForm();
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
    setRowBusy(id);
    try {
      await api.deleteLevel(id);
      if (editingId === id) resetForm();
      // Hard delete (the API 409s instead when members still hold the class).
      // Categories and the other classes' counts are unaffected.
      setLevels((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      // A 409 here carries the "archive instead" guidance from the API.
      setError(err instanceof ApiError ? err.message : "Delete failed");
    } finally {
      setRowBusy(null);
    }
  }

  // Archive/unarchive is reversible (grants, subscriptions and issued
  // certificates all survive), so the row flips immediately. DELETE stays
  // pessimistic — it isn't. (docs/coding-standards.md D4: useMutation with an
  // onMutate snapshot and a verbatim onError rollback is the optimistic engine
  // here.)
  //
  // No `scope`: the old per-row queue key (`level:<id>`) has no v5 equivalent
  // on a single hook instance (scope ids are fixed per hook, and one scope for
  // the whole table would serialize writes to DIFFERENT rows, which overlap
  // freely today). Same-row overlap can't happen anyway — the row's menu
  // entries are disabled while its write is in flight (`rowBusy`).
  const archiveMutation = useMutation({
    networkMode: OPTIMISTIC_NETWORK_MODE,
    mutationFn: ({ id, archived }: ArchiveVars) =>
      archived ? api.unarchiveLevel(id) : api.archiveLevel(id),
    // Snapshot ONLY the slice about to change (carried in the variables, read
    // off the row at click time) and paint through the same state the table
    // renders from; the snapshot rides to onError as the context.
    onMutate: ({ id, archived, current }) => {
      // Mirrors the service: archiving stamps archivedAt AND unpublishes;
      // unarchiving only clears archivedAt.
      const optimisticPatch: Partial<LevelDTO> = archived
        ? { archivedAt: null }
        : { archivedAt: new Date().toISOString(), published: false };
      setLevels((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...optimisticPatch } : l)),
      );
      return current;
    },
    // Both endpoints answer {ok:true} only, so there's nothing to commit —
    // the authoritative row comes from the quiet refetch in onArchive.
    onError: (error, vars, snapshot) => {
      if (!mounted.current || !snapshot) return;
      // Verbatim restore, keyed by id — the list may have re-sorted underneath.
      setLevels((prev) =>
        prev.map((l) => (l.id === vars.id ? { ...l, ...snapshot } : l)),
      );
      toast(mutationErrorMessage(error, "Archive failed"), {
        action: {
          label: "Retry",
          // Same variables — the same absolute archive/unarchive intent.
          onAction: () => archiveMutation.mutate(vars),
        },
      });
    },
  });

  async function onArchive(id: string, archived: boolean) {
    setRowBusy(id);
    const current = levels.find((l) => l.id === id);
    try {
      await archiveMutation.mutateAsync({
        id,
        archived,
        current: {
          archivedAt: current?.archivedAt ?? null,
          published: current?.published ?? false,
        },
      });
    } catch {
      // Failure already rolled back + toasted in onError; the heal below still
      // runs so the server's answer wins either way.
    } finally {
      // Heal from the server WITHOUT load()'s loading flag: the table already
      // shows the new state, and blanking it to "Loading…" would undo the point
      // of flipping the row on click.
      api
        .listLevels()
        .then(setLevels)
        .catch(() => {});
      setRowBusy(null);
    }
  }

  function updatePrice(i: number, patch: Partial<PriceForm>) {
    setPrices((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  }

  // ----- Skills (landing-page "Skills You'll Learn") -----
  function addSkill() {
    setSkills((p) => [...p, { title: "", imageUrl: "" }]);
  }
  function updateSkill(
    i: number,
    patch: Partial<{ title: string; imageUrl: string }>,
  ) {
    setSkills((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeSkill(i: number) {
    setSkills((p) => p.filter((_, idx) => idx !== i));
  }

  // ----- Categories (admin-only grouping) -----
  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setError(null);
    try {
      // The response is the full LevelCategoryDTO and the list is ordered by
      // `order` asc; the API assigns `order = count`, so it lands last. No class
      // changes, so the levels list needs no refresh.
      const cat = await api.createLevelCategory(newCategory.trim());
      setNewCategory("");
      setCategories((prev) => [...prev, cat].sort((a, b) => a.order - b.order));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create category",
      );
    }
  }

  async function removeCategory(c: LevelCategoryDTO) {
    if (
      !(await dialog.confirm({
        message: `${STR.confirm.removeEntity(`category “${c.name}”`)} Classes in it will become uncategorized.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api.deleteLevelCategory(c.id);
      setCategoryIds((prev) => prev.filter((id) => id !== c.id));
      // Refetch: deleting a category also detaches it from every class (the
      // implicit M2M join rows go with it), and the {ok:true} response carries
      // none of those class rows.
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to remove category",
      );
    }
  }

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("classes", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Classes</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  const publishedLevels = levels.filter((l) => l.published);
  const draftLevels = levels.filter((l) => !l.published);
  const q = search.trim().toLowerCase();
  const matchesSearch = (l: LevelDTO) =>
    !q ||
    l.name.toLowerCase().includes(q) ||
    (l.slug ?? "").toLowerCase().includes(q);
  const statusFiltered =
    statusFilter === "published"
      ? publishedLevels
      : statusFilter === "draft"
        ? draftLevels
        : levels;
  const visible = statusFiltered.filter(matchesSearch);

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
    if (lvl.prices.length === 0)
      return <span className="badge badge--ink">Paid</span>;
    // One badge per price so monthly + yearly both show.
    return (
      <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {lvl.prices.map((p) => (
          <span key={p.id} className="badge badge--ink">
            {`${(p.amount / 100).toLocaleString(undefined, {
              style: "currency",
              currency: p.currency || "USD",
              minimumFractionDigits: p.amount % 100 === 0 ? 0 : 2,
            })}/${p.interval === "year" ? "yr" : "mo"}`}
          </span>
        ))}
      </span>
    );
  };

  const gridCols = courses
    ? "2.4fr .7fr .7fr .8fr .9fr 1fr 1fr .3fr"
    : "2.4fr .8fr .9fr 1fr 1fr .3fr";

  // The full level being edited (creator display is immutable + read-only).
  const editingLevel = editingId
    ? (levels.find((l) => l.id === editingId) ?? null)
    : null;

  return (
    <div>
      {error && <p className="error">{error}</p>}

      {modalOpen && (
        <FormModal
          title={editingId ? "Edit class" : "Create class"}
          onClose={closeModal}
          onSubmit={onSubmit}
        >
          <div className="modal-body">
            {editingLevel?.createdBy && (
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                Created by{" "}
                {editingLevel.createdBy.name || editingLevel.createdBy.email}
              </p>
            )}
            <div className="form-row">
              <div className="field">
                <label>{STR.labels.name}</label>
                <input
                  value={name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setName(v);
                    // Live-fill the slug from the name until the admin edits
                    // the slug field themselves.
                    if (!slugEdited) setSlug(slugify(v));
                  }}
                  required
                />
              </div>
              <div className="field">
                <label>{STR.labels.type}</label>
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
              <label>{STR.labels.visibility}</label>
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
                URL slug <span className="muted">(optional)</span>
              </label>
              <input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
                placeholder="e.g. class-1"
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {slug.trim()
                  ? `Class URL: /classes/${slug.trim()}`
                  : "Leave blank to auto-generate from the class name."}
              </span>
            </div>

            <div className="field">
              <label>
                Audience{" "}
                <span className="muted">
                  (members granted this class are subscribed to this audience;
                  the tags are applied within it — leave as default to use the
                  default “Members” audience)
                </span>
              </label>
              <select
                value={audienceId}
                onChange={(e) => setAudienceId(e.target.value)}
              >
                <option value="">— None (use the default audience) —</option>
                {/* keep the stored audience selectable even if it isn't in the
                  fetched list (e.g. the picker 403'd for a class-only admin) */}
                {audienceId && !audiences.some((a) => a.id === audienceId) && (
                  <option value={audienceId}>
                    {audienceName ?? audienceId}
                  </option>
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
                  style={{
                    fontSize: 12,
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  “Payments” bills that many times, then the member keeps the
                  class for life. Leave it blank for an ongoing subscription.
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
                      onChange={(e) =>
                        updatePrice(i, { amount: e.target.value })
                      }
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setPrices((prev) =>
                          prev.length > 1
                            ? prev.filter((_, idx) => idx !== i)
                            : prev,
                        )
                      }
                    >
                      {STR.common.remove}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPrices((prev) => [...prev, emptyPrice()])}
                >
                  + Add price
                </Button>
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

            <div className="form-row">
              <div className="field">
                <label>
                  Square thumbnail <span className="muted">(class tiles)</span>
                </label>
                <MediaPicker
                  value={thumbnailUrl}
                  onChange={setThumbnailUrl}
                  aspect={1}
                />
              </div>
              <div className="field">
                <label>
                  Cover image <span className="muted">(landing-page hero)</span>
                </label>
                <MediaPicker
                  value={imageUrl}
                  onChange={setImageUrl}
                  aspect={16 / 9}
                />
              </div>
            </div>

            <div className="field">
              <label>
                Description <span className="muted">(landing page)</span>
              </label>
              <RichTextEditor value={description} onChange={setDescription} />
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
                  Certificate{" "}
                  <span className="muted">
                    (optional — members earn it after completing every lesson)
                  </span>
                </label>
                <select
                  value={certificateTemplateId}
                  onChange={(e) => setCertificateTemplateId(e.target.value)}
                >
                  {/* Opt-in: a class issues a certificate only when a template
                      is picked here. "No certificate" (empty) is the default. */}
                  <option value="">No certificate</option>
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
                    key={i}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      marginBottom: 12,
                    }}
                  >
                    <input
                      placeholder="Skill title"
                      value={s.title}
                      onChange={(e) =>
                        updateSkill(i, { title: e.target.value })
                      }
                      style={{ flex: "0 0 200px" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MediaPicker
                        value={s.imageUrl}
                        onChange={(url) => updateSkill(i, { imageUrl: url })}
                        aspect={3 / 4}
                      />
                    </div>
                    <button
                      type="button"
                      className="chip-x"
                      aria-label={`Remove skill ${i + 1}`}
                      title="Remove skill"
                      onClick={() => removeSkill(i)}
                      style={{ flex: "none", fontSize: 20, marginTop: 8 }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
              <Button
                type="button"
                variant="add"
                size="sm"
                onClick={addSkill}
                style={{ width: "100%", marginTop: 4 }}
              >
                + Add skill
              </Button>
            </div>
          </div>
          <ModalFooter
            error={formError}
            draftRestored={draft.restored}
            onDiscardDraft={draft.discard}
          >
            <div className="row-actions">
              <Button type="submit" disabled={saving}>
                {saving
                  ? STR.common.saving
                  : editingId
                    ? "Update class"
                    : "Create class"}
              </Button>
              <Button type="button" variant="secondary" onClick={closeModal}>
                {STR.common.cancel}
              </Button>
            </div>
          </ModalFooter>
        </FormModal>
      )}

      {/* chip bar: All / Published / Draft + primary CTA */}
      <div className="chipbar">
        <button
          type="button"
          className={
            statusFilter === "all"
              ? "chipbar-chip chipbar-chip--on"
              : "chipbar-chip"
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
        <div className="filter-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search classes…"
            aria-label="Search classes"
          />
        </div>
        {can("classes", "create") && (
          <Button onClick={openCreate}>+ Add new class</Button>
        )}
      </div>

      {/* management table */}
      <div className="card">
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : levels.length === 0 ? (
          <p className="muted">No classes yet — click “+ Add new class”.</p>
        ) : (
          <>
            <div
              className="mini-grid mini-grid--head"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span>{STR.labels.class}</span>
              {courses && <span>Courses</span>}
              {courses && <span>Lessons</span>}
              <span>Enrolled</span>
              <span>{STR.labels.plan}</span>
              <span>Created by</span>
              <span>{STR.labels.status}</span>
              <span />
            </div>
            {visible.length === 0 && (
              <p className="muted" style={{ padding: "16px 4px" }}>
                No classes match your search.
              </p>
            )}
            {visible.map((lvl) => {
              const counts = countsFor(lvl.id);
              return (
                <div
                  className="mini-grid"
                  style={{ gridTemplateColumns: gridCols }}
                  key={lvl.id}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      minWidth: 0,
                    }}
                  >
                    {lvl.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={lvl.imageUrl} alt="" className="row-thumb" />
                    ) : (
                      <span
                        className="row-thumb row-thumb--empty"
                        aria-hidden="true"
                      >
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
                  {courses && (
                    <span className="mini-cell">{counts?.courses ?? "—"}</span>
                  )}
                  {courses && (
                    <span className="mini-cell">{counts?.lessons ?? "—"}</span>
                  )}
                  <span
                    className="mini-cell"
                    style={{ fontWeight: 600, color: "var(--ink-800)" }}
                  >
                    {lvl.memberCount}
                  </span>
                  <span>{planPill(lvl)}</span>
                  <span
                    className="mini-cell"
                    title={lvl.createdBy?.email ?? undefined}
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lvl.createdBy?.name || lvl.createdBy?.email || "—"}
                  </span>
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
                          onClick: () =>
                            void onArchive(lvl.id, !!lvl.archivedAt),
                          disabled: rowBusy === lvl.id,
                        },
                        {
                          label: "Delete",
                          danger: true,
                          onClick: () => void onDelete(lvl.id),
                          disabled: rowBusy === lvl.id,
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
          <Button type="submit">Add category</Button>
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
