"use client";

import { ChangeEvent, Fragment, FormEvent, useEffect, useState } from "react";
import type {
  CourseCard,
  CreateCourseInput,
  LessonDTO,
  LessonNoteDTO,
  LevelDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import MediaPicker from "@/components/MediaPicker";
import RichTextEditor from "@/components/RichTextEditor";
import LessonMediaFields, {
  type LessonMediaState,
  emptyLessonMedia,
  lessonMediaFromDTO,
  lessonMediaPayload,
  validateLessonMedia,
} from "@/components/LessonMediaFields";

const EMPTY_COURSE = {
  title: "",
  description: "",
  levelIds: [] as string[],
  thumbnailUrl: "",
  coverImageUrl: "",
  // One-off purchase price. priceInput is in MAJOR units (what the admin types,
  // e.g. "25" or "25.00"); it's converted to minor units (cents) on save. Blank
  // = not individually purchasable (level-gated only).
  priceInput: "",
  priceCurrency: "usd",
  priceActive: true,
};

// Parse an admin-entered duration into WHOLE seconds. Accepts "mm:ss",
// "h:mm:ss", "mm.ss" (a dot is a common stand-in for the mm/ss separator), or
// plain seconds ("150"). Every part must be whole digits, so the result is
// always an integer — the API stores durationSeconds as an Int and rejects a
// fractional value (e.g. the old code turned "02.30" into the float 2.3).
// Returns undefined for blank/invalid input so the optional field is omitted.
function parseDuration(input: string): number | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const parts = s.split(/[:.]/).map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
}
// Seconds -> "mm:ss" (or "h:mm:ss"); "" when null.
function formatDuration(sec?: number | null): string {
  if (sec == null) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function CoursesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Names the course whose delete is mid-flight so its row control locks.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Free-text search over course title + assigned class names.
  const [search, setSearch] = useState("");

  // course modal (create/edit)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_COURSE });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // expanded course -> lessons
  const [openCourse, setOpenCourse] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [c, lvls] = await Promise.all([
        api.listCourses(),
        api.listLevels(),
      ]);
      setCourses(c);
      setLevels(lvls);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load courses");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !can("courses", "read")) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Close the modal on Escape.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  function resetForm() {
    setEditingId(null);
    setForm({ ...EMPTY_COURSE });
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
  function startEdit(course: CourseCard) {
    setEditingId(course.id);
    setForm({
      title: course.title,
      description: course.description ?? "",
      levelIds: course.levelIds ?? [],
      thumbnailUrl: course.thumbnailUrl ?? "",
      coverImageUrl: course.coverImageUrl ?? "",
      priceInput:
        course.priceAmount != null ? (course.priceAmount / 100).toString() : "",
      priceCurrency: course.priceCurrency ?? "usd",
      priceActive: course.priceActive ?? true,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function toggleLevel(id: string) {
    setForm((f) => ({
      ...f,
      levelIds: f.levelIds.includes(id)
        ? f.levelIds.filter((x) => x !== id)
        : [...f.levelIds, id],
    }));
  }

  function buildPayload(): CreateCourseInput {
    const priceStr = form.priceInput.trim();
    // Blank clears the one-off price (null); a value converts major -> minor units.
    const priceAmount =
      priceStr === "" ? null : Math.round(Number(priceStr) * 100);
    // Only a well-formed 3-letter code is sent; a stray 1-2 char value (e.g. from
    // backspacing on an unpriced course) falls back to usd so it can never fail
    // the API's ISO-4217 check on an otherwise-valid save.
    const cur = form.priceCurrency.trim().toLowerCase();
    return {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      levelIds: form.levelIds,
      thumbnailUrl: form.thumbnailUrl.trim() || undefined,
      coverImageUrl: form.coverImageUrl.trim() || undefined,
      priceAmount,
      priceCurrency: cur.length === 3 ? cur : "usd",
      priceActive: form.priceActive,
    };
  }

  async function submitCourse(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    if (form.levelIds.length === 0) {
      setFormError("Assign the course to at least one class.");
      return;
    }
    const priceStr = form.priceInput.trim();
    if (priceStr !== "") {
      const n = Number(priceStr);
      if (!Number.isFinite(n) || n < 0) {
        setFormError(
          "Enter a valid one-off price (a number ≥ 0), or leave it blank.",
        );
        return;
      }
      // Reject sub-cent precision instead of silently rounding (e.g. 25.999).
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-9) {
        setFormError("Price can have at most 2 decimal places.");
        return;
      }
      // A priced course needs a valid 3-letter currency (the API validates
      // ISO-4217). Catch it here with a clear message rather than a raw 400.
      if (form.priceCurrency.trim().length !== 3) {
        setFormError("Currency must be a 3-letter code (e.g. USD).");
        return;
      }
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        // Both writes now return the full CourseCard the list builds, so the
        // response IS the row. An edit also can't move it: the list is ordered
        // by `order`, and buildPayload never sends `order`.
        const saved = await api.updateCourse(editingId, buildPayload());
        setCourses((prev) =>
          prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
        );
        setModalOpen(false);
        resetForm();
      } else {
        await api.createCourse(buildPayload());
        setModalOpen(false);
        resetForm();
        // Refetch on create only: placement needs `order`, which the list sorts
        // by but CourseCard doesn't expose, so the client can't tell where a new
        // course lands among any rows carrying a non-default order.
        await load();
      }
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save course"
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeCourse(course: CourseCard) {
    if (
      !(await dialog.confirm({
        message: `Delete "${course.title}"? This removes its lessons and notes and cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    setRowBusy(course.id);
    try {
      await api.deleteCourse(course.id);
      if (openCourse === course.id) setOpenCourse(null);
      if (editingId === course.id) closeModal();
      // Hard delete (the API 409s instead when members own the course), and the
      // classes list this page also holds is unaffected by it.
      setCourses((prev) => prev.filter((c) => c.id !== course.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete course");
    } finally {
      setRowBusy(null);
    }
  }

  // Map a course's assigned level IDs to their display names (skips any
  // dangling IDs whose level was since deleted).
  const levelNamesFor = (ids: string[]) =>
    ids
      .map((id) => levels.find((l) => l.id === id)?.name)
      .filter((n): n is string => Boolean(n));

  // Client-side search: matches a course by its title or any assigned class name
  // (the two columns shown), so typing a class filters to its courses too.
  const q = search.trim().toLowerCase();
  const visibleCourses = !q
    ? courses
    : courses.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          levelNamesFor(c.levelIds).some((n) => n.toLowerCase().includes(q)),
      );

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("courses", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Courses</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Courses</h1>
          <p className="subtitle">
            Assign each course to one or more classes. A course unlocks if a member
            holds ANY assigned class.
          </p>
        </div>
        <button className="btn" onClick={openCreate}>
          + Add new course
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <div className="card-head" style={{ flexWrap: "wrap", gap: 10 }}>
          <h2>All courses</h2>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div className="filter-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
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
                placeholder="Search courses…"
                aria-label="Search courses"
              />
            </div>
            <button className="btn btn--sm" onClick={openCreate}>
              + Add new course
            </button>
          </div>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : courses.length === 0 ? (
          <p className="muted">No courses yet. Click “Add new course” to start.</p>
        ) : visibleCourses.length === 0 ? (
          <p className="muted">No courses match your search.</p>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Title</th>
                <th>Class</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleCourses.map((course) => (
                <Fragment key={course.id}>
                  <tr>
                    <td>
                      {course.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={course.thumbnailUrl}
                          alt=""
                          className="table-thumb"
                        />
                      ) : (
                        <div className="table-thumb table-thumb--empty">—</div>
                      )}
                    </td>
                    <td>{course.title}</td>
                    <td>
                      {levelNamesFor(course.levelIds).length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div className="chips">
                          {levelNamesFor(course.levelIds).map((name, i) => (
                            <span key={i} className="chip chip--muted">
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            setOpenCourse(
                              openCourse === course.id ? null : course.id
                            )
                          }
                        >
                          {openCourse === course.id ? "Hide lessons" : "Lessons"}
                        </button>
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => startEdit(course)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => removeCourse(course)}
                          disabled={rowBusy === course.id}
                        >
                          {rowBusy === course.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {openCourse === course.id && (
                    <tr>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <CourseLessons
                          courseId={course.id}
                          courseTitle={course.title}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {modalOpen && (
        <div
          className="modal-overlay"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "Edit course" : "New course"}</h2>
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
              <form onSubmit={submitCourse}>
                <div className="field">
                  <label>Title</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    autoFocus
                    required
                  />
                </div>

                <div className="field">
                  <label>Description</label>
                  <RichTextEditor
                    value={form.description}
                    onChange={(html) =>
                      setForm({ ...form, description: html })
                    }
                  />
                </div>

                <div className="form-row">
                  <div className="field">
                    <label>
                      Square thumbnail{" "}
                      <span className="muted">(course cards)</span>
                    </label>
                    <MediaPicker
                      value={form.thumbnailUrl}
                      onChange={(url) =>
                        setForm({ ...form, thumbnailUrl: url })
                      }
                      aspect={1}
                    />
                  </div>
                  <div className="field">
                    <label>
                      Cover image{" "}
                      <span className="muted">(course page hero)</span>
                    </label>
                    <MediaPicker
                      value={form.coverImageUrl}
                      onChange={(url) =>
                        setForm({ ...form, coverImageUrl: url })
                      }
                      aspect={16 / 9}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="field">
                    <label>
                      One-off price{" "}
                      <span className="muted">
                        (blank = not sold individually)
                      </span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="e.g. 25.00"
                      value={form.priceInput}
                      onChange={(e) =>
                        setForm({ ...form, priceInput: e.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>
                      Currency <span className="muted">(3-letter code)</span>
                    </label>
                    <input
                      maxLength={3}
                      placeholder="usd"
                      value={form.priceCurrency}
                      onChange={(e) =>
                        setForm({ ...form, priceCurrency: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.priceActive}
                      onChange={(e) =>
                        setForm({ ...form, priceActive: e.target.checked })
                      }
                    />
                    Available for one-off purchase
                  </label>
                  <p className="muted">
                    A member who lacks membership access can buy lifetime access
                    to just this course. Uncheck to pause sales without losing the
                    price.
                  </p>
                </div>

                <div className="field">
                  <label>Classes (unlock access — at least one required)</label>
                  {levels.length === 0 ? (
                    <p className="muted">
                      No classes yet — create a class first; every course must
                      belong to one.
                    </p>
                  ) : (
                    <div className="checkbox-list">
                      {levels.map((l) => (
                        <label key={l.id}>
                          <input
                            type="checkbox"
                            checked={form.levelIds.includes(l.id)}
                            onChange={() => toggleLevel(l.id)}
                          />
                          {l.name}
                        </label>
                      ))}
                    </div>
                  )}
                  {levels.length > 0 && form.levelIds.length === 0 && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      Select at least one class to save.
                    </span>
                  )}
                </div>

                <div className="row-actions">
                  <button
                    className="btn"
                    type="submit"
                    disabled={saving || form.levelIds.length === 0}
                  >
                    {saving
                      ? "Saving…"
                      : editingId
                      ? "Save changes"
                      : "Create course"}
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
    </div>
  );
}

function CourseLessons({
  courseId,
  courseTitle,
}: {
  courseId: string;
  courseTitle: string;
}) {
  const [lessons, setLessons] = useState<LessonDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // add-lesson form (collapsed behind a button until the admin opens it)
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [media, setMedia] = useState<LessonMediaState>(emptyLessonMedia());
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [duration, setDuration] = useState("");
  // Notes are staged here and uploaded right after the lesson is created (the
  // upload endpoint needs the new lesson's id).
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setLessons(await api.listCourseLessons(courseId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load lessons");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Close + fully reset the add-lesson draft, so a dismissed (Cancel / × /
  // overlay / Escape) draft never reappears the next time the modal opens.
  function closeAdd() {
    setShowAdd(false);
    setError(null);
    setTitle("");
    setContent("");
    setMedia(emptyLessonMedia());
    setThumbnailUrl("");
    setDuration("");
    setNoteFiles([]);
  }

  // Close the add-lesson modal on Escape (mirrors the course modal).
  useEffect(() => {
    if (!showAdd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAdd();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAdd]);

  async function addLesson(e: FormEvent) {
    e.preventDefault();
    const mediaError = validateLessonMedia(media);
    if (mediaError) {
      setError(mediaError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createLesson(courseId, {
        title: title.trim(),
        content: content.trim() || undefined,
        ...lessonMediaPayload(media),
        thumbnailUrl: thumbnailUrl.trim() || undefined,
        durationSeconds: parseDuration(duration),
      });
      // Notes need the new lesson's id, so upload them now that it exists.
      if (noteFiles.length) {
        await api.uploadLessonNotes(created.id, noteFiles);
      }
      closeAdd(); // reset the draft + collapse to the "+ Add lesson" button
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add lesson");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--surface-2)",
        padding: "16px 20px",
        borderTop: "2px solid var(--border)",
      }}
    >
      <h3 style={{ marginTop: 0 }}>Lessons — {courseTitle}</h3>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : lessons.length === 0 ? (
        <p className="muted">No lessons yet.</p>
      ) : (
        <div className="lesson-list">
          {lessons
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((l, i) => (
              <LessonRow key={l.id} index={i} lesson={l} onChanged={load} />
            ))}
        </div>
      )}

      {/* The add-lesson flow opens in a modal (same as Add new course). */}
      <button
        className="btn"
        style={{ marginTop: 16 }}
        onClick={() => setShowAdd(true)}
      >
        + Add lesson
      </button>

      {showAdd && (
        <div
          className="modal-overlay"
          onClick={closeAdd}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="modal"
            style={{ maxWidth: 860 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Add lesson — {courseTitle}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeAdd}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {error && <p className="error">{error}</p>}
              <form onSubmit={addLesson}>
                {/* Full-width: title + description */}
                <div className="field">
                  <label>Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label>
                    Description{" "}
                    <span className="muted">(shown on the lesson)</span>
                  </label>
                  <RichTextEditor value={content} onChange={setContent} />
                </div>

                {/* Two columns: media on the left, metadata on the right. */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                    columnGap: 28,
                    rowGap: 20,
                    alignItems: "start",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 18,
                    }}
                  >
                    <LessonMediaFields
                      state={media}
                      onChange={setMedia}
                      name="add-lesson-media"
                    />
                    <div className="field">
                      <label>
                        Duration{" "}
                        <span className="muted">(mm:ss, optional)</span>
                      </label>
                      <input
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        placeholder="e.g. 12:30"
                        style={{ maxWidth: 160 }}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 18,
                    }}
                  >
                    <div className="field">
                      <label>Thumbnail</label>
                      <MediaPicker
                        value={thumbnailUrl}
                        onChange={setThumbnailUrl}
                        aspect={16 / 9}
                      />
                    </div>
                    <div className="field">
                      <label>
                        Notes{" "}
                        <span className="muted">
                          (downloadable files, optional)
                        </span>
                      </label>
                      {noteFiles.length > 0 && (
                        <ul className="notes-list">
                          {noteFiles.map((f, i) => (
                            <li key={i} className="note-item">
                              <span
                                style={{
                                  flex: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {f.name}
                              </span>
                              <span className="muted">{fmtBytes(f.size)}</span>
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() =>
                                  setNoteFiles((fs) =>
                                    fs.filter((_, j) => j !== i),
                                  )
                                }
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <label
                        className="btn btn--ghost btn--sm file-btn"
                        style={{ marginTop: noteFiles.length ? 8 : 0 }}
                      >
                        + Add files
                        <input
                          type="file"
                          multiple
                          hidden
                          onChange={(e) => {
                            const picked = e.target.files
                              ? Array.from(e.target.files)
                              : [];
                            if (picked.length)
                              setNoteFiles((fs) => [...fs, ...picked]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="row-actions" style={{ marginTop: 22 }}>
                  <button className="btn" type="submit" disabled={saving}>
                    {saving ? "Adding…" : "Add lesson"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeAdd}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LessonRow({
  index,
  lesson,
  onChanged,
}: {
  index: number;
  lesson: LessonDTO;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [content, setContent] = useState(lesson.content ?? "");
  const [media, setMedia] = useState<LessonMediaState>(
    lessonMediaFromDTO(lesson)
  );
  const [thumbnailUrl, setThumbnailUrl] = useState(lesson.thumbnailUrl ?? "");
  const [duration, setDuration] = useState(
    formatDuration(lesson.durationSeconds)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadingNotes, setUploadingNotes] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  const notes = lesson.notes ?? [];
  const nameFor = (n: LessonNoteDTO) => names[n.id] ?? n.originalName;

  async function saveEdits() {
    const mediaError = validateLessonMedia(media);
    if (mediaError) {
      setErr(mediaError);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.updateLesson(lesson.id, {
        title: title.trim(),
        content: content.trim() || undefined,
        ...lessonMediaPayload(media),
        // Always sent (a controlled field): "" clears the thumbnail server-side.
        thumbnailUrl: thumbnailUrl.trim(),
        durationSeconds: parseDuration(duration),
      });
      setEditing(false);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to save lesson");
    } finally {
      setBusy(false);
    }
  }

  async function onPickNotes(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (!files.length) return;
    setUploadingNotes(true);
    setErr(null);
    try {
      await api.uploadLessonNotes(lesson.id, files);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Notes upload failed");
    } finally {
      setUploadingNotes(false);
      e.target.value = "";
    }
  }

  async function removeNote(noteId: string) {
    setErr(null);
    try {
      await api.deleteLessonNote(lesson.id, noteId);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to remove note");
    }
  }

  async function rename(n: LessonNoteDTO) {
    const next = nameFor(n).trim();
    if (!next || next === n.originalName) return;
    setErr(null);
    try {
      await api.renameLessonNote(lesson.id, n.id, next);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Rename failed");
    }
  }

  async function download(note: LessonNoteDTO) {
    setErr(null);
    try {
      await api.downloadNote(note);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Download failed");
    }
  }

  async function removeLesson() {
    if (
      !(await dialog.confirm({
        message: `Delete lesson "${lesson.title}"?`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteLesson(lesson.id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to delete lesson");
    } finally {
      setBusy(false);
    }
  }

  const fmtSize = (n: number) =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className="lesson-item">
      <div className="lesson-item__head">
        <span className="lesson-item__num">{index + 1}</span>
        {lesson.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lesson.thumbnailUrl} alt="" className="table-thumb" />
        ) : (
          <div className="table-thumb table-thumb--empty">—</div>
        )}
        <span className="lesson-item__title">{lesson.title}</span>
        {notes.length > 0 && (
          <span className="muted">{notes.length} note(s)</span>
        )}
        <div className="row-actions">
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              if (editing) {
                setEditing(false);
                return;
              }
              // Reseed every field from the CURRENT lesson prop each time the
              // editor opens. Without this, edits abandoned via Cancel linger
              // in local state (the row is reconciled, not remounted) and a
              // later Save would overwrite the stored values with them.
              setTitle(lesson.title);
              setContent(lesson.content ?? "");
              setMedia(lessonMediaFromDTO(lesson));
              setThumbnailUrl(lesson.thumbnailUrl ?? "");
              setDuration(formatDuration(lesson.durationSeconds));
              setErr(null);
              setEditing(true);
            }}
          >
            {editing ? "Close" : "Edit details"}
          </button>
          <button
            className="btn btn--danger btn--sm"
            onClick={removeLesson}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <div className="lesson-item__body">
          {err && <p className="error">{err}</p>}

          <div className="field">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <RichTextEditor value={content} onChange={setContent} />
          </div>
          <LessonMediaFields
            state={media}
            onChange={setMedia}
            name={`edit-lesson-media-${lesson.id}`}
          />
          <div className="field">
            <label>Thumbnail</label>
            <MediaPicker
              value={thumbnailUrl}
              onChange={setThumbnailUrl}
              aspect={16 / 9}
            />
          </div>
          <div className="field">
            <label>
              Duration <span className="muted">(mm:ss)</span>
            </label>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 12:30"
              style={{ maxWidth: 160 }}
            />
          </div>

          {/* Downloadable notes — edited inline here (uploads/removes apply
              immediately; title/media/duration save with the Save button). */}
          <div className="field">
            <label>Notes (downloadable files)</label>
            {notes.length === 0 ? (
              <p className="muted">No notes yet.</p>
            ) : (
              <ul className="notes-list">
                {notes.map((n) => (
                  <li key={n.id} className="note-item">
                    <input
                      className="note-name-input"
                      value={nameFor(n)}
                      onChange={(e) =>
                        setNames((m) => ({ ...m, [n.id]: e.target.value }))
                      }
                      aria-label="File name"
                    />
                    <span className="muted">{fmtSize(n.size)}</span>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => rename(n)}
                      disabled={
                        !nameFor(n).trim() || nameFor(n).trim() === n.originalName
                      }
                    >
                      Rename
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => download(n)}
                    >
                      Download
                    </button>
                    <button
                      className="btn btn--danger btn--sm"
                      onClick={() => removeNote(n.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label
              className="btn btn--ghost btn--sm file-btn"
              style={{ marginTop: 8 }}
            >
              {uploadingNotes ? "Uploading…" : "+ Add files"}
              <input
                type="file"
                multiple
                hidden
                onChange={onPickNotes}
                disabled={uploadingNotes}
              />
            </label>
          </div>

          <div className="row-actions">
            <button className="btn btn--sm" onClick={saveEdits} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
