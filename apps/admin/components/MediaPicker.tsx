"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaDTO } from "@lms/types";
import { ApiError, api } from "@/lib/api";
import { Button } from "@lms/ui";
import { useModalA11y } from "@/lib/useModalA11y";
import MediaCropper from "./MediaCropper";
import { SEARCH_DEBOUNCE_MS, STR } from "@lms/types";

type MediaKindPick = "image" | "video" | "audio";

// Formats we can't (or shouldn't) redraw through a canvas cropper: animated
// GIFs would lose their animation, SVGs are vector. These upload as-is.
function isCroppable(f: File) {
  return (
    f.type.startsWith("image/") &&
    f.type !== "image/gif" &&
    f.type !== "image/svg+xml"
  );
}

// Give the cropped blob a sensible filename + extension for the upload.
function croppedFileName(original: string, blobType: string) {
  const ext = blobType === "image/png" ? "png" : "jpg";
  const base = original.replace(/\.[^./\\]+$/, "") || "image";
  return `${base}.${ext}`;
}

// Reusable media picker: choose from the Media Library OR upload a new file
// (cataloged in the library), with a preview. `value`/`onChange` make it a
// drop-in for any media-URL field — used by the blog/course/lesson/class forms
// and injected into the Puck builder. `kind` switches between image and video:
// images are chosen via Gallery/Upload only, while video also offers a
// paste-a-URL escape hatch for a Vimeo/MP4 link (the class trailer uses it).
export default function MediaPicker({
  value,
  onChange,
  accept,
  kind = "image",
  aspect,
  adjustableCrop = false,
  disabled,
}: {
  value: string;
  onChange: (url: string) => void;
  accept?: string;
  kind?: MediaKindPick;
  // When set (and the picked file is a croppable raster image), an Upload opens
  // a reposition/zoom dialog locked to this width/height ratio before the file
  // is sent — so the crop matches how the image renders on the member site.
  // Omit to upload the original untouched (logos, cert art, generic Puck image).
  aspect?: number;
  // Logo mode: open the cropper on Upload with SELECTABLE aspect (defaults to
  // "Original" = no crop, just a resize) instead of a locked ratio. Independent
  // of `aspect`; use for logos where the shape isn't fixed but the admin still
  // wants to crop/downscale before saving.
  adjustableCrop?: boolean;
  // Read-only mode (e.g. an admin without edit permission): no gallery modal,
  // no upload, no remove, no URL edits — the preview still shows.
  disabled?: boolean;
}) {
  const resolvedAccept =
    accept ??
    (kind === "video" ? "video/*" : kind === "audio" ? "audio/*" : "image/*");
  const [libOpen, setLibOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The file awaiting crop-and-upload (null unless the cropper is open).
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Upload a File and thread the resulting URL back; shared by the direct path
  // and the post-crop path. Clears the <input> so re-picking the same file
  // re-fires onChange.
  const uploadFile = useCallback(
    async (f: File) => {
      setUploading(true);
      setErr(null);
      try {
        const m = await api.uploadMedia(f);
        onChange(m.url);
        return true;
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Upload failed");
        return false;
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [onChange],
  );

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    // Image fields with a target ratio — or logo fields in adjustable-crop mode
    // — open the cropper first; everything else (video, GIF/SVG, or a ratio-less
    // picker with no crop) uploads the original directly.
    if (
      kind === "image" &&
      (aspect != null || adjustableCrop) &&
      isCroppable(f)
    ) {
      setErr(null);
      setCropFile(f);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    await uploadFile(f);
  }

  async function onCropApply(blob: Blob) {
    const src = cropFile;
    if (!src) return;
    const file = new File([blob], croppedFileName(src.name, blob.type), {
      type: blob.type,
    });
    const ok = await uploadFile(file);
    if (ok) setCropFile(null);
  }

  return (
    <div>
      {value ? (
        <div style={{ marginBottom: 8 }}>
          {kind === "video" ? (
            <video
              src={value}
              controls
              style={{
                maxWidth: 240,
                maxHeight: 140,
                borderRadius: 6,
                border: "1px solid var(--border)",
                display: "block",
              }}
            />
          ) : kind === "audio" ? (
            <audio
              src={value}
              controls
              style={{ width: 260, display: "block" }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              style={{
                maxWidth: 240,
                maxHeight: 140,
                objectFit: "cover",
                borderRadius: 6,
                border: "1px solid var(--border)",
                display: "block",
              }}
            />
          )}
        </div>
      ) : null}
      <div className="row-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => setLibOpen(true)}
        >
          {value ? "Replace from gallery" : "Gallery"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            {STR.common.remove}
          </Button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={resolvedAccept}
        hidden
        onChange={(e) => onFile(e.target.files)}
      />
      {/* Images are picked via Gallery/Upload only — no raw URL box. Video
          keeps the paste-a-link escape hatch for a Vimeo/MP4 URL. */}
      {kind === "video" && (
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste a Vimeo/MP4 URL"
          style={{ marginTop: 6 }}
        />
      )}
      {err && !cropFile && <p className="error">{err}</p>}
      {cropFile && (aspect != null || adjustableCrop) && (
        <MediaCropper
          file={cropFile}
          aspect={aspect ?? 1}
          adjustable={aspect == null && adjustableCrop}
          busy={uploading}
          error={err}
          onCancel={() => {
            if (uploading) return;
            setErr(null);
            setCropFile(null);
          }}
          onApply={onCropApply}
        />
      )}
      {libOpen && (
        <MediaLibraryModal
          kind={kind}
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
  kind = "image",
  onClose,
  onPick,
}: {
  kind?: MediaKindPick;
  onClose: () => void;
  onPick: (m: MediaDTO) => void;
}) {
  const [items, setItems] = useState<MediaDTO[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const modalRef = useModalA11y();
  const noun =
    kind === "video" ? "videos" : kind === "audio" ? "audio files" : "images";

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      setErr(null);
      try {
        const res = await api.listMedia({
          q: query,
          kind,
          page: 1,
          pageSize: 60,
        });
        setItems(res.items);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Failed to load media");
      } finally {
        setLoading(false);
      }
    },
    [kind],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, load]);
  // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.

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
      ref={modalRef}
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2>Gallery</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={STR.common.close}
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
              placeholder={`Search ${noun}…`}
              style={{ minWidth: 220 }}
            />
            <Button
              type="button"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload new"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={
                kind === "video"
                  ? "video/*"
                  : kind === "audio"
                    ? "audio/*"
                    : "image/*"
              }
              hidden
              onChange={(e) => onFile(e.target.files)}
            />
          </div>
          {err && <p className="error">{err}</p>}
          {loading ? (
            <p className="muted">{STR.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="muted">No {noun} yet — use “Upload new”.</p>
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
                  {kind === "video" ? (
                    <video
                      src={m.url}
                      muted
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : kind === "audio" ? (
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        width: "100%",
                        height: "100%",
                        padding: 6,
                        fontSize: 11,
                        color: "var(--text-muted)",
                        textAlign: "center",
                      }}
                    >
                      <span style={{ fontSize: 22 }} aria-hidden="true">
                        🎵
                      </span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "100%",
                        }}
                      >
                        {m.originalName}
                      </span>
                    </span>
                  ) : (
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
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
