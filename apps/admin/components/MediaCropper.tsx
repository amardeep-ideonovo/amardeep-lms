"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Generalized image cropper (rectangular, arbitrary aspect ratio). The admin
// pans (drag) + zooms (slider/wheel) to frame the image inside an aspect-locked
// window, so the crop matches how the image renders on the member site. On
// apply we redraw the framed region to a canvas and hand back a Blob (JPEG for
// photos; PNG when the source is PNG, to keep transparency). Zero external
// deps — mirrors AvatarCropper's mechanism, just non-square.

const STAGE_MAX_W = 440; // on-screen framing window bounds (px)
const STAGE_MAX_H = 320;
const OUTPUT_LONG_EDGE = 1600; // max exported long edge; never upscales past source
const MAX_ZOOM_FACTOR = 4;

type Props = {
  file: File;
  aspect: number; // width / height of the crop window (e.g. 16/9, 3/4, 1)
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

type Dims = { w: number; h: number };

// The on-screen framing window: the requested aspect, fit inside the max box.
function stageSize(aspect: number): Dims {
  let w = STAGE_MAX_W;
  let h = Math.round(w / aspect);
  if (h > STAGE_MAX_H) {
    h = STAGE_MAX_H;
    w = Math.round(h * aspect);
  }
  return { w, h };
}

export default function MediaCropper({
  file,
  aspect,
  busy = false,
  error: uploadError = null,
  onCancel,
  onApply,
}: Props) {
  const { w: VW, h: VH } = stageSize(aspect);
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);

  // Keep the (already-scaled) image covering the whole framing window.
  const clampPos = useCallback(
    (p: { x: number; y: number }, s: number, d: Dims) => {
      const w = d.w * s;
      const h = d.h * s;
      return {
        x: Math.min(0, Math.max(VW - w, p.x)),
        y: Math.min(0, Math.max(VH - h, p.y)),
      };
    },
    [VW, VH],
  );

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
      // Smallest scale that still covers the framing window on both axes.
      const fit = Math.max(VW / d.w, VH / d.h);
      imgRef.current = img;
      setDims(d);
      setMinScale(fit);
      setScale(fit);
      setPos({ x: (VW - d.w * fit) / 2, y: (VH - d.h * fit) / 2 });
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
  }, [file, VW, VH]);

  // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.

  // Zoom about the window centre so the framed subject stays put.
  const applyZoom = useCallback(
    (next: number) => {
      if (!dims) return;
      const s = Math.min(minScale * MAX_ZOOM_FACTOR, Math.max(minScale, next));
      setScale((prev) => {
        const cx = (VW / 2 - pos.x) / prev;
        const cy = (VH / 2 - pos.y) / prev;
        const np = { x: VW / 2 - cx * s, y: VH / 2 - cy * s };
        setPos(clampPos(np, s, dims));
        return s;
      });
    },
    [dims, minScale, pos.x, pos.y, clampPos, VW, VH],
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

  const handleApply = () => {
    const img = imgRef.current;
    if (!img || !dims || busy) return;
    // Source region under the framing window, in source pixels.
    const srcW = VW / scale;
    const srcH = VH / scale;
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    // Export at source resolution, capped to OUTPUT_LONG_EDGE (never upscale).
    const outScale = Math.min(1, OUTPUT_LONG_EDGE / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * outScale));
    const outH = Math.max(1, Math.round(srcH * outScale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Couldn't process the image in this browser.");
      return;
    }
    ctx.imageSmoothingQuality = "high";
    const asPng = file.type === "image/png";
    if (!asPng) {
      ctx.fillStyle = "#ffffff"; // flatten any transparency (JPEG has no alpha)
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, outW, outH);
    const done = (blob: Blob | null) => {
      if (blob) onApply(blob);
      else setError("Couldn't process the image. Try a different file.");
    };
    if (asPng) canvas.toBlob(done, "image/png");
    else canvas.toBlob(done, "image/jpeg", 0.92);
  };

  const w = dims ? dims.w * scale : 0;
  const h = dims ? dims.h * scale : 0;

  return (
    <div className="modal-overlay modal-overlay--center">
      <div className="modal modal--crop modal--crop-rect">
        <div className="modal-header">
          <h2>Position the image</h2>
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
                style={{ width: VW, height: VH }}
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
                <div
                  className="cropper-mask cropper-mask--rect"
                  aria-hidden="true"
                />
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
            {busy ? "Uploading…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
