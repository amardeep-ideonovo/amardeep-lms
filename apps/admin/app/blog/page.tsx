"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import type {
  CreatePostInput,
  PostAdminRow,
  PostCategoryDTO,
  PostStatus,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import RichTextEditor from "@/components/RichTextEditor";
import MediaPicker from "@/components/MediaPicker";

const EMPTY = {
  title: "",
  excerpt: "",
  content: "",
  coverImageUrl: "",
  categoryIds: [] as string[],
  tags: "",
  status: "DRAFT" as PostStatus,
};

export default function BlogPage() {
  const [posts, setPosts] = useState<PostAdminRow[]>([]);
  const [categories, setCategories] = useState<PostCategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // page-level errors

  // Create/edit happens in a modal.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [formError, setFormError] = useState<string | null>(null); // modal errors
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [newCategory, setNewCategory] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, c] = await Promise.all([
        api.listPosts(),
        api.listPostCategories(),
      ]);
      setPosts(p);
      setCategories(c);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load blog posts"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setForm({ ...EMPTY });
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

  function startEdit(post: PostAdminRow) {
    setEditingId(post.id);
    setForm({
      title: post.title,
      excerpt: post.excerpt ?? "",
      content: post.content ?? "",
      coverImageUrl: post.coverImageUrl ?? "",
      categoryIds: post.categoryIds,
      tags: post.tags.join(", "),
      status: post.status,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function buildPayload(): CreatePostInput {
    return {
      title: form.title.trim(),
      excerpt: form.excerpt.trim() || undefined,
      content: form.content || undefined,
      coverImageUrl: form.coverImageUrl.trim() || undefined,
      categoryIds: form.categoryIds,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: form.status,
    };
  }

  function toggleCategory(id: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id],
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) await api.updatePost(editingId, buildPayload());
      else await api.createPost(buildPayload());
      setModalOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save post"
      );
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(post: PostAdminRow) {
    setError(null);
    try {
      await api.updatePost(post.id, {
        status: post.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
      });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update status"
      );
    }
  }

  async function remove(post: PostAdminRow) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete "${post.title}"? This cannot be undone.`)
    )
      return;
    setError(null);
    try {
      await api.deletePost(post.id);
      if (editingId === post.id) closeModal();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete post");
    }
  }

  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const { url } = await api.uploadImage(file);
      setForm((f) => ({ ...f, coverImageUrl: url }));
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Image upload failed"
      );
    } finally {
      setUploading(false);
      e.target.value = ""; // allow re-selecting the same file
    }
  }

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setError(null);
    try {
      await api.createPostCategory(newCategory.trim(), categories.length);
      setNewCategory("");
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create category"
      );
    }
  }

  async function removeCategory(c: PostCategoryDTO) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Remove category "${c.name}"? Posts in it will become uncategorized.`
      )
    )
      return;
    setError(null);
    try {
      await api.deletePostCategory(c.id);
      // If the open form references this category, drop it from the selection.
      setForm((f) => ({
        ...f,
        categoryIds: f.categoryIds.filter((id) => id !== c.id),
      }));
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to remove category"
      );
    }
  }

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "—";

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Blog</h1>
          <p className="subtitle">
            Write and manage blog posts. Published posts appear on the public
            site without login; drafts stay private.
          </p>
        </div>
        <button className="btn" onClick={openCreate}>
          + Add new post
        </button>
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

      <div className="card">
        <div className="card-head">
          <h2>All posts</h2>
          <button className="btn btn--sm" onClick={openCreate}>
            + Add new post
          </button>
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="muted">No posts yet. Click “Add new post” to start.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Tags</th>
                <th>Author</th>
                <th>Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id}>
                  <td>{post.title}</td>
                  <td className="muted">
                    {post.categories.length
                      ? post.categories.map((c) => c.name).join(", ")
                      : "—"}
                  </td>
                  <td className="muted">
                    {post.tags.length ? post.tags.join(", ") : "—"}
                  </td>
                  <td className="muted">{post.author?.name ?? "—"}</td>
                  <td className="muted">
                    {fmtDate(post.publishedAt ?? post.createdAt)}
                  </td>
                  <td>
                    <span
                      className={
                        post.status === "PUBLISHED"
                          ? "badge badge--published"
                          : "badge badge--draft"
                      }
                    >
                      {post.status === "PUBLISHED" ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => startEdit(post)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => togglePublish(post)}
                      >
                        {post.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        className="btn btn--danger btn--sm"
                        onClick={() => remove(post)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
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
              <h2>{editingId ? "Edit post" : "New post"}</h2>
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
              <form onSubmit={submit}>
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
                  <label>
                    Excerpt{" "}
                    <span className="muted">(summary for cards + SEO)</span>
                  </label>
                  <textarea
                    value={form.excerpt}
                    onChange={(e) =>
                      setForm({ ...form, excerpt: e.target.value })
                    }
                    style={{ minHeight: 60 }}
                  />
                </div>

                <div className="field">
                  <label>Content</label>
                  <RichTextEditor
                    value={form.content}
                    onChange={(html) =>
                      setForm((f) => ({ ...f, content: html }))
                    }
                  />
                </div>

                <div className="field">
                  <label>Featured image</label>
                  <MediaPicker
                    value={form.coverImageUrl}
                    onChange={(url) =>
                      setForm((f) => ({ ...f, coverImageUrl: url }))
                    }
                  />
                </div>

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
                            checked={form.categoryIds.includes(c.id)}
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
                    <label>Status</label>
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          status: e.target.value as PostStatus,
                        })
                      }
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="PUBLISHED">Published</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>
                      Tags <span className="muted">(comma-separated)</span>
                    </label>
                    <input
                      value={form.tags}
                      onChange={(e) =>
                        setForm({ ...form, tags: e.target.value })
                      }
                      placeholder="news, writing"
                    />
                  </div>
                </div>

                <div className="row-actions">
                  <button className="btn" type="submit" disabled={saving}>
                    {saving
                      ? "Saving…"
                      : editingId
                      ? "Save changes"
                      : "Publish post"}
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
