"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CategoryDTO, CourseCard, LessonDTO, LevelDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [levels, setLevels] = useState<LevelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create-course form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [savingCourse, setSavingCourse] = useState(false);

  // create-category form
  const [newCategory, setNewCategory] = useState("");

  // expanded course -> lessons
  const [openCourse, setOpenCourse] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [c, cats, lvls] = await Promise.all([
        api.listCourses(),
        api.listCategories(),
        api.listLevels(),
      ]);
      setCourses(c);
      setCategories(cats);
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

  function toggleLevel(id: string) {
    setLevelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function createCourse(e: FormEvent) {
    e.preventDefault();
    setSavingCourse(true);
    setError(null);
    try {
      await api.createCourse({
        title: title.trim(),
        description: description.trim() || undefined,
        categoryId: categoryId || undefined,
        levelIds,
      });
      setTitle("");
      setDescription("");
      setCategoryId("");
      setLevelIds([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create course");
    } finally {
      setSavingCourse(false);
    }
  }

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setError(null);
    try {
      await api.createCategory(newCategory.trim(), categories.length);
      setNewCategory("");
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create category"
      );
    }
  }

  const categoryName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? "—" : "—";

  return (
    <div>
      <div className="page-header">
        <h1>Courses</h1>
        <p className="subtitle">
          Assign each course to one or more levels. A course unlocks if a member
          holds ANY assigned level.
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>New category</h2>
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
            {categories
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((c) => (
                <span key={c.id} className="chip chip--muted">
                  {c.name}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Create course</h2>
        <form onSubmit={createCourse}>
          <div className="field">
            <label>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label>Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Levels (unlock access)</label>
              {levels.length === 0 ? (
                <p className="muted">No levels yet.</p>
              ) : (
                <div className="checkbox-list">
                  {levels.map((l) => (
                    <label key={l.id}>
                      <input
                        type="checkbox"
                        checked={levelIds.includes(l.id)}
                        onChange={() => toggleLevel(l.id)}
                      />
                      {l.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="btn" type="submit" disabled={savingCourse}>
            {savingCourse ? "Creating…" : "Create course"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>All courses</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : courses.length === 0 ? (
          <p className="muted">No courses yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>{course.title}</td>
                  <td>{categoryName(course.categoryId)}</td>
                  <td className="muted">{course.description ?? "—"}</td>
                  <td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openCourse && (
        <CourseLessons
          courseId={openCourse}
          courseTitle={
            courses.find((c) => c.id === openCourse)?.title ?? "Course"
          }
        />
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

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [muxAssetId, setMuxAssetId] = useState("");
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

  async function addLesson(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createLesson(courseId, {
        title: title.trim(),
        content: content.trim() || undefined,
        videoUrl: videoUrl.trim() || undefined,
        muxAssetId: muxAssetId.trim() || undefined,
      });
      setTitle("");
      setContent("");
      setVideoUrl("");
      setMuxAssetId("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add lesson");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Lessons — {courseTitle}</h2>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : lessons.length === 0 ? (
        <p className="muted">No lessons yet.</p>
      ) : (
        <table className="table" style={{ marginBottom: 20 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Content</th>
              <th>Mux asset</th>
            </tr>
          </thead>
          <tbody>
            {lessons
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((l) => (
                <tr key={l.id}>
                  <td>{l.order}</td>
                  <td>{l.title}</td>
                  <td className="muted">{l.content ?? "—"}</td>
                  <td className="muted">
                    {l.muxPlaybackToken ? "linked" : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <form onSubmit={addLesson}>
        <h2>Add lesson</h2>
        <div className="field">
          <label>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="field">
          <label>
            Video URL{" "}
            <span className="muted">(Vimeo link — or a direct MP4)</span>
          </label>
          <input
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://vimeo.com/123456789 (optional)"
          />
        </div>
        <div className="field">
          <label>Mux asset ID</label>
          <input
            value={muxAssetId}
            onChange={(e) => setMuxAssetId(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Adding…" : "Add lesson"}
        </button>
      </form>
    </div>
  );
}
