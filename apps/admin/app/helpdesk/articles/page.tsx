"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HelpdeskAdminArticleDTO, HelpdeskCategory } from "@lms/types";
import { HELPDESK_CATEGORIES, STR } from "@lms/types";
import { Button, buttonClass } from "@lms/ui";
import { ApiError, api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { useAdminAuth } from "@/components/AdminAuthProvider";

interface FormState {
  id: string | null;
  title: string;
  body: string;
  category: HelpdeskCategory;
  keywords: string;
  published: boolean;
  sortOrder: number;
}

const EMPTY: FormState = {
  id: null,
  title: "",
  body: "",
  category: "OTHER",
  keywords: "",
  published: true,
  sortOrder: 0,
};

export default function HelpdeskArticlesPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const queryClient = useQueryClient();
  const canRead = !authLoading && can("helpdesk", "read");

  const articlesQuery = useQuery({
    queryKey: qk.helpdeskArticles,
    queryFn: () => api.listHelpdeskArticles(),
    enabled: canRead,
  });
  const items = articlesQuery.data ?? [];
  const loading = articlesQuery.isPending;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = can("helpdesk", "edit");
  const canCreate = can("helpdesk", "create");
  const canDelete = can("helpdesk", "delete");

  const loadFailure =
    articlesQuery.error instanceof ApiError
      ? articlesQuery.error.message
      : articlesQuery.error
        ? "Failed to load"
        : null;
  const pageError = error ?? loadFailure;

  function edit(a: HelpdeskAdminArticleDTO) {
    setForm({
      id: a.id,
      title: a.title,
      body: a.body,
      category: a.category,
      keywords: a.keywords.join(", "),
      published: a.published,
      sortOrder: a.sortOrder,
    });
  }

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.helpdeskArticles });

  async function save() {
    setSaving(true);
    setError(null);
    const input = {
      title: form.title.trim(),
      body: form.body.trim(),
      category: form.category,
      keywords: form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      published: form.published,
      sortOrder: Number(form.sortOrder) || 0,
    };
    try {
      if (form.id) {
        await api.updateHelpdeskArticle(form.id, input);
      } else {
        await api.createHelpdeskArticle(input);
      }
      setForm(EMPTY);
      await invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteHelpdeskArticle(id);
      if (form.id === id) setForm(EMPTY);
      await invalidate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete");
    }
  }

  if (authLoading) return <p className="muted">{STR.common.loading}</p>;
  if (!can("helpdesk", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>FAQ articles</h1>
        </div>
        <p className="muted">{STR.errors.permissionDenied}</p>
      </div>
    );

  const canSubmit = form.id ? canEdit : canCreate;

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>FAQ articles</h1>
          <p className="subtitle">
            Shown to members on the help widget’s “Something else” screen.
          </p>
        </div>
        <Link href="/helpdesk" className={buttonClass({ variant: "ghost" })}>
          ← {STR.helpdesk.adminSectionTitle}
        </Link>
      </div>

      {pageError && <p className="error">{pageError}</p>}

      {canSubmit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="field">
            <label>Title</label>
            <input
              value={form.title}
              maxLength={160}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Body</label>
            <textarea
              value={form.body}
              maxLength={8000}
              style={{ minHeight: 120 }}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="form-row" style={{ gap: 12, flexWrap: "wrap" }}>
            <div className="field">
              <label>Category</label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({
                    ...form,
                    category: e.target.value as HelpdeskCategory,
                  })
                }
              >
                {HELPDESK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Sort order</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm({ ...form, sortOrder: Number(e.target.value) })
                }
                style={{ width: 90 }}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label>Keywords (comma-separated)</label>
              <input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              />
            </div>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              margin: "4px 0 12px",
            }}
          >
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) =>
                setForm({ ...form, published: e.target.checked })
              }
            />
            Published (visible to members)
          </label>
          <div className="row-actions">
            <Button
              onClick={() => void save()}
              disabled={saving || !form.title.trim() || !form.body.trim()}
            >
              {saving ? "Saving…" : form.id ? "Save changes" : "Create article"}
            </Button>
            {form.id && (
              <Button variant="ghost" onClick={() => setForm(EMPTY)}>
                {STR.common.cancel}
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">{STR.common.loading}</p>
        ) : items.length === 0 ? (
          <p className="muted">No articles yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{a.title}</td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {a.category}
                    </td>
                    <td>
                      <span
                        className={
                          a.published
                            ? "badge badge--ok"
                            : "badge badge--neutral"
                        }
                      >
                        {a.published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="row-actions">
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => edit(a)}
                        >
                          {STR.common.edit}
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void remove(a.id)}
                        >
                          {STR.common.delete}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
