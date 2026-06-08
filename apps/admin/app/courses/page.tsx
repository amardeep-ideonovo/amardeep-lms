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
import { dialog } from "@/components/DialogProvider";
import MediaPicker from "@/components/MediaPicker";

const EMPTY_COURSE = {
  title: "",
  description: "",
  levelIds: [] as string[],
  thumbnailUrl: "",
  coverImageUrl: "",
};

// Parse an admin-entered duration ("12:30", "1:02:03", or plain seconds) into
// seconds. Returns undefined for blank/invalid input.
function parseDuration(input: string): number | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const parts = s.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
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

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    load();
  }, []);

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
    return {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      levelIds: form.levelIds,
      thumbnailUrl: form.thumbnailUrl.trim() || undefined,
      coverImageUrl: form.coverImageUrl.trim() || undefined,
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
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) await api.updateCourse(editingId, buildPayload());
      else await api.createCourse(buildPayload());
      setModalOpen(false);
      resetForm();
      await load();
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
    try {
      await api.deleteCourse(course.id);
      if (openCourse === course.id) setOpenCourse(null);
      if (editingId === course.id) closeModal();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete course");
    }
  }

  // Map a course's assigned level IDs to their display names (skips any
  // dangling IDs whose level was since deleted).
  const levelNamesFor = (ids: string[]) =>
    ids
      .map((id) => levels.find((l) => l.id === id)?.name)
      .filter((n): n is string => Boolean(n));

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
        <div className="card-head">
          <h2>All courses</h2>
          <button className="btn btn--sm" onClick={openCreate}>
            + Add new course
          </button>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : courses.length === 0 ? (
          <p className="muted">No courses yet. Click “Add new course” to start.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Title</th>
                <th>Class</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
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
                        >
                          Delete
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
          </table>
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
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
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
                    />
                  </div>
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
  const [videoUrl, setVideoUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [duration, setDuration] = useState("");
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

  // Close the add-lesson modal on Escape (mirrors the course modal).
  useEffect(() => {
    if (!showAdd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAdd(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdd]);

  async function addLesson(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createLesson(courseId, {
        title: title.trim(),
        content: content.trim() || undefined,
        videoUrl: videoUrl.trim() || undefined,
        thumbnailUrl: thumbnailUrl.trim() || undefined,
        durationSeconds: parseDuration(duration),
      });
      setTitle("");
      setContent("");
      setVideoUrl("");
      setThumbnailUrl("");
      setDuration("");
      setShowAdd(false); // collapse back to the "+ Add lesson" button
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
          onClick={() => setShowAdd(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add lesson — {courseTitle}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowAdd(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {error && <p className="error">{error}</p>}
              <form onSubmit={addLesson}>
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
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <div className="field">
                    <label>
                      Video URL{" "}
                      <span className="muted">
                        (Vimeo link — or a direct MP4)
                      </span>
                    </label>
                    <input
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder="https://vimeo.com/123456789 (optional)"
                    />
                  </div>
                  <div className="field">
                    <label>Thumbnail</label>
                    <MediaPicker value={thumbnailUrl} onChange={setThumbnailUrl} />
                  </div>
                </div>
                <div className="field">
                  <label>
                    Duration <span className="muted">(mm:ss, optional)</span>
                  </label>
                  <input
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="e.g. 12:30"
                    style={{ maxWidth: 160 }}
                  />
                </div>
                <div className="row-actions">
                  <button className="btn" type="submit" disabled={saving}>
                    {saving ? "Adding…" : "Add lesson"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => setShowAdd(false)}
                  >
                    Cancel
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  Add downloadable notes after creating the lesson (use “Manage”
                  on a lesson).
                </p>
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
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [content, setContent] = useState(lesson.content ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl ?? "");
  const [duration, setDuration] = useState(
    formatDuration(lesson.durationSeconds)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [uploadingNotes, setUploadingNotes] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  const notes = lesson.notes ?? [];
  const nameFor = (n: LessonNoteDTO) => names[n.id] ?? n.originalName;

  async function saveEdits() {
    setBusy(true);
    setErr(null);
    try {
      await api.updateLesson(lesson.id, {
        title: title.trim(),
        content: content.trim() || undefined,
        videoUrl: videoUrl.trim() || undefined,
        durationSeconds: parseDuration(duration),
      });
      setEditing(false);
      setExpanded(false);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to save lesson");
    } finally {
      setBusy(false);
    }
  }

  async function onPickThumb(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingThumb(true);
    setErr(null);
    try {
      // Route through the Media Library so the upload is cataloged too.
      const { url } = await api.uploadMedia(file);
      await api.updateLesson(lesson.id, { thumbnailUrl: url });
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Thumbnail upload failed");
    } finally {
      setUploadingThumb(false);
      e.target.value = "";
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
              setExpanded(true);
              setEditing(true);
            }}
          >
            Edit details
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setEditing(false);
              setExpanded((v) => !v);
            }}
          >
            {expanded ? "Close" : "Manage"}
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

      {expanded && (
        <div className="lesson-item__body">
          {err && <p className="error">{err}</p>}

          {editing ? (
            <>
              <div className="field">
                <label>Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Video URL</label>
                <input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
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
              <div className="row-actions">
                <button className="btn btn--sm" onClick={saveEdits} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setEditing(false);
                    setExpanded(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="row-actions">
              <label className="btn btn--ghost btn--sm file-btn">
                {uploadingThumb ? "Uploading…" : "Replace thumbnail"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={onPickThumb}
                  disabled={uploadingThumb}
                />
              </label>
            </div>
          )}

          {!editing && (
          <div className="field" style={{ marginTop: 12 }}>
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
          )}
        </div>
      )}
    </div>
  );
}
