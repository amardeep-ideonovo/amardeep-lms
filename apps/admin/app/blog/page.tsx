"use client";

import { FormEvent, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatePostInput,
  PostAdminListRow,
  PostAdminRow,
  PostCategoryDTO,
  PostStatus,
  PostTagDTO,
} from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";
import RichTextEditor from "@/components/RichTextEditor";
import MediaPicker from "@/components/MediaPicker";
import ModalFooter from "@/components/ModalFooter";
import FormModal from "@/components/FormModal";
import { usePersistedDraft } from "@/lib/usePersistedDraft";
import { STR } from "@lms/types";
import { Button } from "@lms/ui";

const EMPTY = {
  title: "",
  excerpt: "",
  content: "",
  coverImageUrl: "",
  categoryIds: [] as string[],
  tagIds: [] as string[],
  status: "DRAFT" as PostStatus,
  featured: false,
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
  const tagsQuery = useQuery({
    queryKey: qk.blogTags,
    queryFn: () => api.listPostTags(),
    enabled: canRead,
  });
  const posts = postsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const loading =
    postsQuery.isPending || categoriesQuery.isPending || tagsQuery.isPending;
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
  const [newTag, setNewTag] = useState("");

  const draft = usePersistedDraft({
    formKey: "blog",
    version: 2,
    entityId: editingId,
    open: modalOpen,
    data: {
      title: form.title,
      excerpt: form.excerpt,
      content: form.content,
      coverImageUrl: form.coverImageUrl,
      categoryIds: form.categoryIds,
      tagIds: form.tagIds,
      status: form.status,
      featured: form.featured,
    },
    restore: (d) => {
      setForm({
        title: d.title,
        excerpt: d.excerpt,
        content: d.content,
        coverImageUrl: d.coverImageUrl,
        categoryIds: d.categoryIds,
        tagIds: d.tagIds,
        status: d.status,
        featured: d.featured,
      });
    },
  });

  // Load failures surface from the queries, mutation failures from `error`;
  // one slot renders both (a mutation's message wins while set, as before).
  const loadFailure =
    postsQuery.error ?? categoriesQuery.error ?? tagsQuery.error;
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
  // slot. Featured is a single hero, so a saved featured post also clears the
  // flag on every other cached row (matching the server transaction).
  function applyPost(row: PostAdminRow) {
    queryClient.setQueryData<PostAdminListRow[]>(qk.blogPosts, (prev = []) => {
      const others = prev.filter((p) => p.id !== row.id);
      return [
        row,
        ...(row.featured
          ? others.map((p) => ({ ...p, featured: false }))
          : others),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
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
      tagIds: post.tagIds,
      status: post.status,
      featured: post.featured,
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
        tagIds: full.tagIds,
        status: full.status,
        featured: full.featured,
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
      tagIds: form.tagIds,
      status: form.status,
      featured: form.featured,
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

  function toggleTag(id: string) {
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id)
        ? f.tagIds.filter((x) => x !== id)
        : [...f.tagIds, id],
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
      draft.clearSaved();
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

  // Set (or clear) the single featured hero. applyPost clears the flag on every
  // other row when this one becomes featured, mirroring the server transaction.
  async function toggleFeatured(post: PostAdminListRow) {
    setError(null);
    try {
      applyPost(await api.updatePost(post.id, { featured: !post.featured }));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to update featured post",
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

  async function createTag(e: FormEvent) {
    e.preventDefault();
    if (!newTag.trim()) return;
    setError(null);
    try {
      // Same shape as categories: the response is the full PostTagDTO and the
      // list is ordered by `order` asc, so sending `tags.length` lands it last.
      const tag = await api.createPostTag(newTag.trim(), tags.length);
      setNewTag("");
      queryClient.setQueryData<PostTagDTO[]>(qk.blogTags, (prev = []) =>
        [...prev, tag].sort((a, b) => a.order - b.order),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create tag");
    }
  }

  async function removeTag(t: PostTagDTO) {
    if (
      !(await dialog.confirm({
        message: `${STR.confirm.removeEntity(`tag “${t.name}”`)} Posts keep everything else and simply lose this tag.`,
        danger: true,
      }))
    )
      return;
    setError(null);
    try {
      await api.deletePostTag(t.id);
      // If the open form references this tag, drop it from the selection.
      setForm((f) => ({
        ...f,
        tagIds: f.tagIds.filter((id) => id !== t.id),
      }));
      // Refetch both lists: deleting a tag also detaches it from every post,
      // and the {ok:true} response carries none of those post rows.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.blogPosts }),
        queryClient.invalidateQueries({ queryKey: qk.blogTags }),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove tag");
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

      <div className="form-row">
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
          <h2>New tag</h2>
          <form onSubmit={createTag} className="row-actions">
            <input
              placeholder="Tag name"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
            />
            <Button type="submit">Add tag</Button>
          </form>
          {tags.length > 0 && (
            <div className="chips" style={{ marginTop: 12 }}>
              {tags.map((t) => (
                <span key={t.id} className="chip chip--muted">
                  {t.name}
                  <button
                    type="button"
                    className="chip-x"
                    aria-label={`Remove ${t.name}`}
                    title={`Remove ${t.name}`}
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

      <div className="card">
        <div className="card-head">
          <h2>All posts</h2>
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
                    <td>
                      {post.featured && (
                        <span
                          className="badge badge--featured"
                          title="Featured hero post"
                          style={{ marginRight: 6 }}
                        >
                          ★ Featured
                        </span>
                      )}
                      {post.title}
                    </td>
                    <td className="muted">
                      {post.categories.length
                        ? post.categories.map((c) => c.name).join(", ")
                        : "—"}
                    </td>
                    <td className="muted">
                      {post.tags.length
                        ? post.tags.map((t) => t.name).join(", ")
                        : "—"}
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
                          variant="secondary"
                          size="sm"
                          onClick={() => toggleFeatured(post)}
                          title={
                            post.featured
                              ? "Remove this post as the featured hero"
                              : "Make this the featured hero post"
                          }
                        >
                          {post.featured ? "Unfeature" : "Feature"}
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
        <FormModal
          title={editingId ? "Edit post" : "New post"}
          onClose={closeModal}
          onSubmit={submit}
        >
          <div className="modal-body">
            <div className="field">
              <label>{STR.labels.title}</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                autoFocus
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

            <div className="field">
              <label>Tags</label>
              {tags.length === 0 ? (
                <p className="muted">No tags yet — add one above.</p>
              ) : (
                <div className="checkbox-list">
                  {tags.map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={form.tagIds.includes(t.id)}
                        onChange={() => toggleTag(t.id)}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) =>
                    setForm({ ...form, featured: e.target.checked })
                  }
                />
                Featured post{" "}
                <span className="muted">
                  (the single hero shown at the top of the public blog —
                  choosing this un-features any other post)
                </span>
              </label>
            </div>

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
          </div>
          <ModalFooter
            error={formError}
            draftRestored={draft.restored}
            onDiscardDraft={draft.discard}
          >
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
              <Button type="button" variant="secondary" onClick={closeModal}>
                {STR.common.cancel}
              </Button>
            </div>
          </ModalFooter>
        </FormModal>
      )}
    </div>
  );
}
