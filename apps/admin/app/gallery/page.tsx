"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaDTO, MediaKind } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { useAdminAuth } from "@/components/AdminAuthProvider";
import { dialog } from "@/components/DialogProvider";

const PAGE_SIZE = 40;

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "pdf", label: "PDFs" },
];

const KIND_ICON: Record<MediaKind, string> = {
  image: "🖼️",
  video: "🎬",
  audio: "🎵",
  pdf: "📕",
  document: "📄",
  archive: "🗜️",
  other: "📦",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function MediaPage() {
  const { can, loading: authLoading } = useAdminAuth();
  const [items, setItems] = useState<MediaDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<File[]>([]); // picked, awaiting details + save
  const [savingNew, setSavingNew] = useState(false);
  const [selected, setSelected] = useState<MediaDTO | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (p: number, query: string, k: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.listMedia({
          q: query,
          kind: k,
          page: p,
          pageSize: PAGE_SIZE,
        });
        setItems(res.items);
        setTotal(res.total);
        setPage(res.page);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load media");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial load + reload on filter/page change. Search is debounced.
  useEffect(() => {
    if (authLoading || !can("gallery", "read")) return;
    load(1, q, kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, authLoading]);
  useEffect(() => {
    if (authLoading || !can("gallery", "read")) return;
    const t = setTimeout(() => load(1, q, kind), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Picking files does NOT upload yet — it queues them. Each opens a details
  // popup, and the file is saved only when the user clicks "Save to gallery".
  function onFilesChosen(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setPending(Array.from(files));
    if (fileRef.current) fileRef.current.value = "";
  }

  // Save the front-of-queue file WITH the details entered in the popup.
  async function saveNew(meta: {
    title: string;
    altText: string;
    caption: string;
    description: string;
  }) {
    if (!pending.length) return;
    setSavingNew(true);
    setError(null);
    try {
      const created = await api.uploadMedia(pending[0]); // saves the file
      await api.updateMedia(created.id, meta).catch(() => undefined); // details (best-effort)
      const rest = pending.slice(1);
      setPending(rest);
      if (rest.length === 0) await load(1, q, kind); // refresh once the batch is done
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setSavingNew(false);
    }
  }

  function cancelNew() {
    setPending([]); // discard the queue; nothing un-saved is uploaded
    void load(1, q, kind); // reflect any files already saved earlier in the batch
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);

  if (authLoading) return <p className="muted">Loading…</p>;
  if (!can("gallery", "read"))
    return (
      <div>
        <div className="page-header">
          <h1>Gallery</h1>
        </div>
        <p className="muted">You don’t have permission to view this.</p>
      </div>
    );

  return (
    <div>
      <div className="page-header with-action">
        <div>
          <h1>Gallery</h1>
          <p className="subtitle">
            Upload any file and get a public URL to embed anywhere. Images,
            video, audio, PDFs, documents and SVG are supported.
          </p>
        </div>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          + Add Media File
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => onFilesChosen(e.target.files)}
        />
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or title…"
            style={{ minWidth: 240 }}
          />
          <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>
            {total === 0 ? "No files" : `Showing ${from}–${to} of ${total}`}
          </span>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">
            No media yet. Click “Add Media File” to upload your first file.
          </p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              {items.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelected(m)}
                  title={m.originalName}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface)",
                    padding: 0,
                    cursor: "pointer",
                    overflow: "hidden",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      height: 120,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--bg)",
                      overflow: "hidden",
                    }}
                  >
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.url}
                        alt={m.altText ?? m.originalName}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: 40 }}>{KIND_ICON[m.kind]}</span>
                    )}
                  </div>
                  <div
                    style={{
                      padding: "6px 8px",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {m.originalName}
                  </div>
                </button>
              ))}
            </div>

            {pageCount > 1 && (
              <div
                className="row-actions"
                style={{ marginTop: 16, justifyContent: "center" }}
              >
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={page <= 1}
                  onClick={() => load(page - 1, q, kind)}
                >
                  ← Prev
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  Page {page} of {pageCount}
                </span>
                <button
                  className="btn btn--ghost btn--sm"
                  disabled={page >= pageCount}
                  onClick={() => load(page + 1, q, kind)}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <MediaDetails
          asset={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setItems((prev) =>
              prev.map((x) => (x.id === updated.id ? updated : x)),
            );
            setSelected(updated);
          }}
          onDeleted={(id) => {
            setSelected(null);
            setItems((prev) => prev.filter((x) => x.id !== id));
            setTotal((t) => Math.max(0, t - 1));
          }}
        />
      )}

      {pending.length > 0 && (
        <NewMediaModal
          file={pending[0]}
          remaining={pending.length}
          busy={savingNew}
          onSave={saveNew}
          onCancel={cancelNew}
        />
      )}
    </div>
  );
}

// Pre-save "add" popup: collect details for a freshly-picked file BEFORE it's
// uploaded. Save uploads the file with these details; Cancel discards it.
function NewMediaModal({
  file,
  remaining,
  busy,
  onSave,
  onCancel,
}: {
  file: File;
  remaining: number;
  busy: boolean;
  onSave: (meta: {
    title: string;
    altText: string;
    caption: string;
    description: string;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [altText, setAltText] = useState("");
  const [caption, setCaption] = useState("");
  const [description, setDescription] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Fresh fields + a local preview whenever the queued file changes.
  useEffect(() => {
    setTitle(file.name.replace(/\.[^.]+$/, ""));
    setAltText("");
    setCaption("");
    setDescription("");
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const kind: MediaKind = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("audio/")
        ? "audio"
        : file.type === "application/pdf"
          ? "pdf"
          : "other";

  return (
    <div
      className="modal-overlay"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal"
        style={{ maxWidth: 760 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Add to Gallery{remaining > 1 ? ` — ${remaining} files` : ""}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 20,
            }}
          >
            <div
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                minHeight: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {kind === "image" && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt=""
                  style={{
                    maxWidth: "100%",
                    maxHeight: 300,
                    objectFit: "contain",
                  }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: 24 }}>
                  <div style={{ fontSize: 56 }}>{KIND_ICON[kind]}</div>
                  <p className="muted" style={{ fontSize: 13 }}>
                    {file.name}
                  </p>
                </div>
              )}
            </div>
            <div>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Not saved yet — add details below, then save.
              </p>
              <p style={{ margin: "4px 0", fontSize: 13 }}>
                <strong>File name:</strong> {file.name}
                <br />
                <strong>File type:</strong> {file.type || "—"}
                <br />
                <strong>File size:</strong> {fmtBytes(file.size)}
              </p>
              <div className="field">
                <label>Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="field">
                <label>Alternative text</label>
                <input
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Caption</label>
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="row-actions" style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => onSave({ title, altText, caption, description })}
                >
                  {busy ? "Saving…" : "Save to gallery"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={onCancel}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaDetails({
  asset,
  onClose,
  onSaved,
  onDeleted,
}: {
  asset: MediaDTO;
  onClose: () => void;
  onSaved: (m: MediaDTO) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({
    title: asset.title ?? "",
    altText: asset.altText ?? "",
    caption: asset.caption ?? "",
    description: asset.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-init when a different asset is opened.
  useEffect(() => {
    setForm({
      title: asset.title ?? "",
      altText: asset.altText ?? "",
      caption: asset.caption ?? "",
      description: asset.description ?? "",
    });
    setErr(null);
    setCopied(false);
  }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copyUrl() {
    navigator.clipboard?.writeText(asset.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      onSaved(await api.updateMedia(asset.id, form));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !(await dialog.confirm({
        message: `Delete “${asset.originalName}” permanently? Any place embedding its URL will break.`,
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      await api.deleteMedia(asset.id);
      onDeleted(asset.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal"
        style={{ maxWidth: 920 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Attachment details</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modal-body">
          {err && <p className="error">{err}</p>}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 20,
            }}
          >
            {/* Preview */}
            <div>
              <div
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  minHeight: 240,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <MediaPreview asset={asset} />
              </div>
            </div>

            {/* Metadata + URL */}
            <div>
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Uploaded on <strong>{fmtDate(asset.createdAt)}</strong>
                {asset.uploadedBy ? ` by ${asset.uploadedBy.email}` : ""}
              </p>
              <p style={{ margin: "4px 0", fontSize: 13 }}>
                <strong>File name:</strong> {asset.originalName}
                <br />
                <strong>File type:</strong> {asset.mimeType}
                <br />
                <strong>File size:</strong> {fmtBytes(asset.size)}
                {asset.width && asset.height ? (
                  <>
                    <br />
                    <strong>Dimensions:</strong> {asset.width} × {asset.height}{" "}
                    pixels
                  </>
                ) : null}
              </p>

              <div className="field">
                <label>Title</label>
                <input
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label>Alternative text</label>
                <input
                  value={form.altText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, altText: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label>Caption</label>
                <input
                  value={form.caption}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, caption: e.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label>File URL</label>
                <input value={asset.url} readOnly onFocus={(e) => e.target.select()} />
                <div className="row-actions" style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={copyUrl}
                  >
                    {copied ? "Copied!" : "Copy URL to clipboard"}
                  </button>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--ghost btn--sm"
                  >
                    Open ↗
                  </a>
                </div>
              </div>

              <div
                className="row-actions"
                style={{
                  marginTop: 12,
                  justifyContent: "space-between",
                }}
              >
                <button className="btn" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={remove}
                  disabled={busy}
                >
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaPreview({ asset }: { asset: MediaDTO }) {
  if (asset.kind === "image")
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={asset.url}
        alt={asset.altText ?? asset.originalName}
        style={{ maxWidth: "100%", maxHeight: 420, objectFit: "contain" }}
      />
    );
  if (asset.kind === "video")
    return (
      <video
        src={asset.url}
        controls
        style={{ maxWidth: "100%", maxHeight: 420 }}
      />
    );
  if (asset.kind === "audio")
    return <audio src={asset.url} controls style={{ width: "90%" }} />;
  if (asset.kind === "pdf")
    return (
      <iframe
        src={asset.url}
        title={asset.originalName}
        style={{ width: "100%", height: 360, border: "none" }}
      />
    );
  return (
    <div style={{ textAlign: "center", padding: 24 }}>
      <div style={{ fontSize: 56 }}>{KIND_ICON[asset.kind]}</div>
      <p className="muted" style={{ fontSize: 13 }}>
        No inline preview for this file type.
      </p>
    </div>
  );
}
