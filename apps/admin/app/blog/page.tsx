"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  CreatePostInput,
  PostAdminRow,
  PostCategoryDTO,
  PostStatus,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import RichTextEditor from "@/components/RichTextEditor";

const EMPTY = {
  title: "",
  excerpt: "",
  content: "",
  coverImageUrl: "",
  categoryId: "",
  tags: "",
  status: "DRAFT" as PostStatus,
};

export default function BlogPage() {
  const [posts, setPosts] = useState<PostAdminRow[]>([]);
  const [categories, setCategories] = useState<PostCategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

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

  function resetForm() {
    setEditingId(null);
    setForm({ ...EMPTY });
  }

  function startEdit(post: PostAdminRow) {
    setEditingId(post.id);
    setForm({
      title: post.title,
      excerpt: post.excerpt ?? "",
      content: post.content ?? "",
      coverImageUrl: post.coverImageUrl ?? "",
      categoryId: post.categoryId ?? "",
      tags: post.tags.join(", "),
      status: post.status,
    });
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildPayload(): CreatePostInput {
    return {
      title: form.title.trim(),
      excerpt: form.excerpt.trim() || undefined,
      content: form.content || undefined,
      coverImageUrl: form.coverImageUrl.trim() || undefined,
      categoryId: form.categoryId || undefined,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: form.status,
    };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) await api.updatePost(editingId, buildPayload());
      else await api.createPost(buildPayload());
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save post");
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
      if (editingId === post.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete post");
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
      <div className="page-header">
        <h1>Blog</h1>
        <p className="subtitle">
          Write and manage blog posts. Published posts appear on the public site
          without login; drafts stay private.
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
            {categories.map((c) => (
              <span key={c.id} className="chip chip--muted">
                {c.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>{editingId ? "Edit post" : "Create post"}</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label>Title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label>
              Excerpt <span className="muted">(summary for cards + SEO)</span>
            </label>
            <textarea
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              style={{ minHeight: 60 }}
            />
          </div>

          <div className="field">
            <label>Content</label>
            <RichTextEditor
              value={form.content}
              onChange={(html) => setForm((f) => ({ ...f, content: html }))}
            />
          </div>

          <div className="field">
            <label>Featured image URL</label>
            <input
              value={form.coverImageUrl}
              onChange={(e) =>
                setForm({ ...form, coverImageUrl: e.target.value })
              }
              placeholder="https://…"
            />
            {form.coverImageUrl.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.coverImageUrl}
                alt="Featured preview"
                className="cover-preview"
              />
            )}
          </div>

          <div className="form-row">
            <div className="field">
              <label>Category</label>
              <select
                value={form.categoryId}
                onChange={(e) =>
                  setForm({ ...form, categoryId: e.target.value })
                }
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
              <label>Status</label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as PostStatus })
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
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
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
                : "Create post"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={resetForm}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>All posts</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="muted">No posts yet.</p>
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
                  <td className="muted">{post.category?.name ?? "—"}</td>
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
    </div>
  );
}
