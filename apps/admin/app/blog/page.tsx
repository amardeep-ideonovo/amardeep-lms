"use client";

import { FormEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePostInput,
  PostAdminListRow,
  PostAdminRow,
  PostCategoryDTO,
  PostStatus,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useModalA11y } from "@/lib/useModalA11y";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import RichTextEditor from "@/components/RichTextEditor";
import MediaPicker from "@/components/MediaPicker";
import { STR } from "@lms/types";
import { Button } from "@lms/ui";

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
  const { can, loading: authLoading } = useAdminAuth();
  const queryClient = useQueryClient();
  // The list reads live in the query cache (docs/coding-standards.md D4).
  // `enabled` keeps the RBAC gate: a denied section never fires the request.
  const canRead = !authLoading && can("blog", "read");
  const postsQuery = useQuery({
    queryKey: qk.blogPosts,
    queryFn: () => api.listPosts(),
    enabled: canRead,
  });
  const categoriesQuery = useQuery({
    queryKey: qk.blogCategories,
    queryFn: () => api.listPostCategories(),
    enabled: canRead,
  });
  const posts = postsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const loading = postsQuery.isPending || categoriesQuery.isPending;
  const [error, setError] = useState<string | null>(null); // page-level (mutation) errors

  // Create/edit happens in a modal.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [formError, setFormError] = useState<string | null>(null); // modal errors
  const [saving, setSaving] = useState(false);
  // The list carries no post body, so editing loads it from the detail endpoint.
  // Saving is blocked until that resolves: an empty editor saved over a loaded
  // post would replace its whole body (blog.service PATCHes content wholesale).
  const [detailState, setDetailState] = useState<"ready" | "loading" | "error">(
    "ready",
  );
  // Guards against a late detail response landing in the form after the admin
  // has closed the modal or opened a different post.
  const editingIdRef = useRef<string | null>(null);

  const [newCategory, setNewCategory] = useState("");
  const modalRef = useModalA11y();

  // Load failures surface from the queries, mutation failures from `error`;
  // one slot renders both (a mutation's message wins while set, as before).
  const loadFailure = postsQuery.error ?? categoriesQuery.error;
  const pageError =
    error ??
    (loadFailure
      ? loadFailure instanceof ApiError
        ? loadFailure.message
        : "Failed to load blog posts"
      : null);

  // Create/update return exactly the PostAdminRow the list renders (the API maps
  // list rows and mutation responses through the same toAdminRow), so apply the
  // response to the cached list instead of refetching. GET /admin/blog/posts is
  // ordered by createdAt desc: a new post goes first, an edited one keeps its
  // slot.
  function applyPost(row: PostAdminRow) {
    queryClient.setQueryData<PostAdminListRow[]>(qk.blogPosts, (prev = []) =>
      (prev.some((p) => p.id === row.id)
        ? prev.map((p) => (p.id === row.id ? row : p))
        : [row, ...prev]
      ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.

  function resetForm() {
    setEditingId(null);
    editingIdRef.current = null;
    setForm({ ...EMPTY });
    setFormError(null);
    setDetailState("ready"); // a new post has no body to fetch
  }

  function openCreate() {
    resetForm();
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    resetForm();
  }

  async function startEdit(post: PostAdminListRow) {
    setEditingId(post.id);
    editingIdRef.current = post.id;
    // Seed from what the list already knows so the modal isn't blank, then fill
    // the body from the detail endpoint (the list deliberately omits it).
    setForm({
      title: post.title,
      excerpt: "",
      content: "",
      coverImageUrl: "",
      categoryIds: post.categoryIds,
      tags: post.tags.join(", "),
      status: post.status,
    });
    setFormError(null);
    setDetailState("loading");
    setModalOpen(true);
    try {
      const full = await api.getPost(post.id);
      if (editingIdRef.current !== full.id) return; // stale response
      setForm({
        title: full.title,
        excerpt: full.excerpt ?? "",
        content: full.content ?? "",
        coverImageUrl: full.coverImageUrl ?? "",
        categoryIds: full.categoryIds,
        tags: full.tags.join(", "),
        status: full.status,
      });
      setDetailState("ready");
    } catch (err) {
      if (editingIdRef.current !== post.id) return;
      setFormError(
        err instanceof ApiError ? err.message : "Failed to load this post",
      );
      // Stay in "error": saving now would wipe the body we failed to load.
      setDetailState("error");
    }
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
      applyPost(
        editingId
          ? await api.updatePost(editingId, buildPayload())
          : await api.createPost(buildPayload()),
      );
      setModalOpen(false);
      resetForm();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to save post",
      );
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(post: PostAdminListRow) {
    setError(null);
    try {
      applyPost(
        await api.updatePost(post.id, {
          status: post.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update status",
      );
    }
  }

  async function remove(post: PostAdminListRow) {
    if (
      !(await dialog.confirm({
        message: `Delete "${post.title}"? This cannot be undone.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api.deletePost(post.id);
      if (editingId === post.id) closeModal();
      queryClient.setQueryData<PostAdminListRow[]>(qk.blogPosts, (prev) =>
        prev?.filter((p) => p.id !== post.id),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete post");
    }
  }

  async function createCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setError(null);
    try {
      // The response is the full PostCategoryDTO and the list is ordered by
      // `order` asc — we send `categories.length`, so the new one lands last.
      // No post changes, so the post list needs no refresh.
      const cat = await api.createPostCategory(
        newCategory.trim(),
        categories.length,
      );
      setNewCategory("");
      queryClient.setQueryData<PostCategoryDTO[]>(
        qk.blogCategories,
        (prev = []) => [...prev, cat].sort((a, b) => a.order - b.order),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create category",
      );
    }
  }

  async function removeCategory(c: PostCategoryDTO) {
    if (
      !(await dialog.confirm({
        message: `${STR.confirm.removeEntity(`category “${c.name}”`)} Posts in it will become uncategorized.`,
        danger: true,
      }))
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
      // Refetch both lists: deleting a category also detaches it from every
      // post, and the {ok:true} response carries none of those post rows.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.blogPosts }),
        queryClient.invalidateQueries({ queryKey: qk.blogCategories }),
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to remove category",
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

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("blog", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Blog</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

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
        <Button onClick={openCreate}>+ Add new post</Button>
      </div>

      {pageError && <p className="error">{pageError}</p>}

      <div className="card">
        <h2>New category</h2>
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

      <div className="card">
        <div className="card-head">
          <h2>All posts</h2>
          <Button size="sm" onClick={openCreate}>
            + Add new post
          </Button>
        </div>
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : posts.length === 0 ? (
          <p className="muted">No posts yet. Click “Add new post” to start.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{STR.labels.title}</th>
                  <th>Category</th>
                  <th>Tags</th>
                  <th>Author</th>
                  <th>{STR.labels.date}</th>
                  <th>{STR.labels.status}</th>
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => startEdit(post)}
                        >
                          {STR.common.edit}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => togglePublish(post)}
                        >
                          {post.status === "PUBLISHED"
                            ? "Unpublish"
                            : "Publish"}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => remove(post)}
                        >
                          {STR.common.delete}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          ref={modalRef}
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
        >
          <div className="modal">
            <div className="modal-header">
              <h2>{editingId ? "Edit post" : "New post"}</h2>
              <button
                type="button"
                className="modal-close"
                onClick={closeModal}
                aria-label={STR.common.close}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {formError && <p className="error">{formError}</p>}
              <form onSubmit={submit}>
                <div className="field">
                  <label>{STR.labels.title}</label>
                  <input
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
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
                    aspect={16 / 9}
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
                    <label>{STR.labels.status}</label>
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
                  <Button
                    type="submit"
                    // Blocked until the body has loaded — saving a blank editor
                    // over a loaded post would replace its entire content.
                    disabled={saving || detailState !== "ready"}
                  >
                    {detailState === "loading"
                      ? STR.common.loading
                      : saving
                        ? STR.common.saving
                        : editingId
                          ? "Save changes"
                          : "Publish post"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={closeModal}
                  >
                    {STR.common.cancel}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
