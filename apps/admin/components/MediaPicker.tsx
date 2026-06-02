"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";

// Reusable image picker: choose from the Media Library OR upload a new file
// (which is cataloged in the library), with a preview and a paste-a-URL escape
// hatch. `value`/`onChange` make it a drop-in for any image-URL field — used by
// the blog/course/lesson/category forms and injected into the Puck builder.
export default function MediaPicker({
  value,
  onChange,
  accept = "image/*",
}: {
  value: string;
  onChange: (url: string) => void;
  accept?: string;
}) {
  const [libOpen, setLibOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      const m = await api.uploadMedia(f);
      onChange(m.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      {value ? (
        <div style={{ marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            style={{
              maxWidth: 220,
              maxHeight: 130,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid var(--border)",
              display: "block",
            }}
          />
        </div>
      ) : null}
      <div className="row-actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setLibOpen(true)}
        >
          {value ? "Replace from gallery" : "Gallery"}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
        {value ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onChange("")}
          >
            Remove
          </button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => onFile(e.target.files)}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="…or paste a URL"
        style={{ marginTop: 6 }}
      />
      {err && <p className="error">{err}</p>}
      {libOpen && (
        <MediaLibraryModal
          onClose={() => setLibOpen(false)}
          onPick={(m) => {
            onChange(m.url);
            setLibOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MediaLibraryModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (m: MediaDTO) => void;
}) {
  const [items, setItems] = useState<MediaDTO[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.listMedia({
        q: query,
        kind: "image",
        page: 1,
        pageSize: 60,
      });
      setItems(res.items);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploading(true);
    setErr(null);
    try {
      onPick(await api.uploadMedia(f));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Upload failed");
      setUploading(false);
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
        style={{ maxWidth: 760 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Gallery</h2>
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
          <div className="row-actions" style={{ marginBottom: 12 }}>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search images…"
              style={{ minWidth: 220 }}
            />
            <button
              type="button"
              className="btn btn--sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload new"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => onFile(e.target.files)}
            />
          </div>
          {err && <p className="error">{err}</p>}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="muted">No images yet — use “Upload new”.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                gap: 10,
                maxHeight: 420,
                overflow: "auto",
              }}
            >
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.originalName}
                  onClick={() => onPick(m)}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 0,
                    cursor: "pointer",
                    overflow: "hidden",
                    background: "var(--bg)",
                    height: 90,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.url}
                    alt={m.altText ?? m.originalName}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
