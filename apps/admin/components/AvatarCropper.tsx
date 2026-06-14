"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Self-contained avatar cropper. The admin picks an image, then pans (drag) and
// zooms (slider / wheel) to frame a square crop under a circular guide. On apply
// we redraw the framed region to a fixed-size canvas and hand back a JPEG blob,
// so the existing upload endpoint stays unchanged. Zero external dependencies —
// mirrors the rest of the admin's bespoke, inline-styled UI.

const VIEWPORT = 300; // on-screen crop square (px)
const OUTPUT = 512; // exported avatar resolution (px)
const MAX_ZOOM_FACTOR = 4; // furthest zoom = min-fit × this

type Props = {
  file: File;
  busy?: boolean;
  /** Upload error from the parent, surfaced inside the modal. */
  error?: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

type Dims = { w: number; h: number };

export default function AvatarCropper({
  file,
  busy = false,
  error: uploadError = null,
  onCancel,
  onApply,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // top-left of the scaled image
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(
    null,
  );

  // Keep the image covering the viewport so the circle is never empty.
  const clampPos = useCallback(
    (p: { x: number; y: number }, s: number, d: Dims) => {
      const w = d.w * s;
      const h = d.h * s;
      return {
        x: Math.min(0, Math.max(VIEWPORT - w, p.x)),
        y: Math.min(0, Math.max(VIEWPORT - h, p.y)),
      };
    },
    [],
  );

  // Load the picked file into an <img> and fit it to the viewport. The
  // `cancelled` guard keeps a superseded run (e.g. React StrictMode's
  // dev double-mount, which revokes the first object URL) from reporting a
  // false load error onto the live component.
  useEffect(() => {
    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const d = { w: img.naturalWidth, h: img.naturalHeight };
      if (!d.w || !d.h) {
        setError("That image couldn't be read. Try another file.");
        return;
      }
      const fit = Math.max(VIEWPORT / d.w, VIEWPORT / d.h);
      imgRef.current = img;
      setDims(d);
      setMinScale(fit);
      setScale(fit);
      setPos({ x: (VIEWPORT - d.w * fit) / 2, y: (VIEWPORT - d.h * fit) / 2 });
    };
    img.onerror = () => {
      if (cancelled) return;
      setError("That image couldn't be read. Try another file.");
    };
    img.src = objectUrl;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // Esc to cancel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Re-zoom around the viewport centre so framing feels stable.
  const applyZoom = useCallback(
    (next: number) => {
      if (!dims) return;
      const s = Math.min(minScale * MAX_ZOOM_FACTOR, Math.max(minScale, next));
      setScale((prev) => {
        const cx = (VIEWPORT / 2 - pos.x) / prev;
        const cy = (VIEWPORT / 2 - pos.y) / prev;
        const np = { x: VIEWPORT / 2 - cx * s, y: VIEWPORT / 2 - cy * s };
        setPos(clampPos(np, s, dims));
        return s;
      });
    },
    [dims, minScale, pos.x, pos.y, clampPos],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !dims) return;
    const next = {
      x: drag.current.ox + (e.clientX - drag.current.px),
      y: drag.current.oy + (e.clientY - drag.current.py),
    };
    setPos(clampPos(next, scale, dims));
  };
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (busy) return;
    applyZoom(scale * (e.deltaY < 0 ? 1.08 : 0.92));
  };

  // Draw the framed region to a square canvas and export a JPEG.
  const handleApply = () => {
    const img = imgRef.current;
    if (!img || !dims || busy) return;
    const sSize = VIEWPORT / scale; // source square under the viewport
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Couldn't process the image in this browser.");
      return;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff"; // flatten any transparency (JPEG has no alpha)
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(
      (blob) => {
        if (blob) onApply(blob);
        else setError("Couldn't process the image. Try a different file.");
      },
      "image/jpeg",
      0.92,
    );
  };

  const w = dims ? dims.w * scale : 0;
  const h = dims ? dims.h * scale : 0;

  return (
    <div
      className="modal-overlay modal-overlay--center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="modal modal--crop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Position your photo</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onCancel}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="modal-body cropper-body">
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <>
              <div
                className="cropper-stage"
                style={{ width: VIEWPORT, height: VIEWPORT }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onWheel={onWheel}
                role="application"
                aria-label="Drag to reposition, scroll to zoom"
              >
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt=""
                    className="cropper-img"
                    draggable={false}
                    style={{ left: pos.x, top: pos.y, width: w, height: h }}
                  />
                )}
                <div className="cropper-mask" aria-hidden="true" />
              </div>

              <div className="cropper-controls">
                <span className="cropper-zoom-ic" aria-hidden="true">
                  −
                </span>
                <input
                  type="range"
                  min={minScale}
                  max={minScale * MAX_ZOOM_FACTOR}
                  step={(minScale * (MAX_ZOOM_FACTOR - 1)) / 100 || 0.001}
                  value={scale}
                  onChange={(e) => applyZoom(Number(e.target.value))}
                  aria-label="Zoom"
                  disabled={busy}
                />
                <span className="cropper-zoom-ic" aria-hidden="true">
                  +
                </span>
              </div>
              <p className="muted cropper-hint">
                Drag to reposition · scroll or use the slider to zoom.
              </p>
            </>
          )}
          {uploadError && !error && (
            <p className="error cropper-upload-error">{uploadError}</p>
          )}
        </div>
        <div className="dialog-actions cropper-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleApply}
            disabled={busy || !dims || !!error}
          >
            {busy ? "Uploading…" : "Save photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
