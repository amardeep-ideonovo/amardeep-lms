"use client";

// The pan/zoom/crop MECHANISM behind every image cropper (docs/coding-standards
// .md D5). Web's AvatarCropper, admin's AvatarCropper and admin's MediaCropper
// each carried a verbatim copy of this logic (~150 lines: object-URL load with
// StrictMode guard, cover-fit, clamped pan, centre-anchored zoom, pointer
// capture, canvas export); the three components are now thin JSX over this
// hook. Markup stays per-app on purpose — web and admin use different button/
// alert class families until the P3 token unification — so this hook is
// HEADLESS: it owns state and math, the caller owns rendering.
//
// Modes:
//   • avatar   — aspect 1, fixed square stage, fixed-size JPEG export
//                (transparency flattened to white; JPEG has no alpha).
//   • media    — arbitrary aspect, stage shrinks responsively so the modal's
//                buttons never overflow a narrow/zoomed viewport (#110), export
//                at source resolution capped to a long edge (never upscaled),
//                PNG in → PNG out to keep transparency.

import { useCallback, useEffect, useRef, useState } from "react";
import { STR } from "@lms/types";

const MAX_ZOOM_FACTOR = 4; // furthest zoom = min-fit × this

// Responsive stage bounds (from MediaCropper #110): keep the framing window
// inside the viewport with room for the modal chrome.
const AVAIL_MARGIN_X = 72;
const AVAIL_MARGIN_Y = 280;
const AVAIL_MIN_W = 200;
const AVAIL_MIN_H = 150;

const PROCESS_ERROR_BROWSER = "Couldn't process the image in this browser.";
const PROCESS_ERROR_FILE = "Couldn't process the image. Try a different file.";

type Dims = { w: number; h: number };

export type ImageCropperOptions = {
  file: File;
  /** Crop window aspect (width / height). Avatar croppers pass 1. */
  aspect: number;
  /** Max on-screen framing window, before responsive shrinking. */
  stageMax: Dims;
  /** Shrink the stage to fit narrow/zoomed viewports (media mode). */
  responsive?: boolean;
  /** Gates pointer/wheel/zoom input (e.g. while uploading). */
  busy?: boolean;
  output:
    | { kind: "fixed"; size: number } // size×size JPEG (aspect must be 1)
    | { kind: "capped"; longEdge: number }; // source-res, capped, no upscale
  /** media mode: a PNG source exports as PNG to keep transparency. */
  keepPngTransparency?: boolean;
};

// The framing window: the requested aspect, fit inside the max box.
function stageSize(aspect: number, maxW: number, maxH: number): Dims {
  let w = maxW;
  let h = Math.round(w / aspect);
  if (h > maxH) {
    h = maxH;
    w = Math.round(h * aspect);
  }
  return { w, h };
}

export type ImageCropper = ReturnType<typeof useImageCropper>;

export function useImageCropper(opts: ImageCropperOptions) {
  const {
    file,
    aspect,
    stageMax,
    responsive = false,
    busy = false,
    keepPngTransparency = false,
  } = opts;

  const [avail, setAvail] = useState<Dims>(stageMax);
  const stage = stageSize(
    aspect,
    Math.min(stageMax.w, avail.w),
    Math.min(stageMax.h, avail.h),
  );

  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // top-left of scaled image
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);

  useEffect(() => {
    if (!responsive) return;
    const update = () =>
      setAvail({
        w: Math.max(AVAIL_MIN_W, window.innerWidth - AVAIL_MARGIN_X),
        h: Math.max(AVAIL_MIN_H, window.innerHeight - AVAIL_MARGIN_Y),
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [responsive]);

  // Keep the (already-scaled) image covering the whole framing window.
  const clampPos = useCallback(
    (p: { x: number; y: number }, s: number, d: Dims) => {
      const w = d.w * s;
      const h = d.h * s;
      return {
        x: Math.min(0, Math.max(stage.w - w, p.x)),
        y: Math.min(0, Math.max(stage.h - h, p.y)),
      };
    },
    [stage.w, stage.h],
  );

  // Load the picked file and fit it to the stage. The `cancelled` guard keeps
  // a superseded run (React StrictMode's dev double-mount revokes the first
  // object URL) from reporting a false load error onto the live component.
  useEffect(() => {
    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const d = { w: img.naturalWidth, h: img.naturalHeight };
      if (!d.w || !d.h) {
        setError(STR.errors.imageUnreadable);
        return;
      }
      const fit = Math.max(stage.w / d.w, stage.h / d.h);
      imgRef.current = img;
      setDims(d);
      setMinScale(fit);
      setScale(fit);
      setPos({
        x: (stage.w - d.w * fit) / 2,
        y: (stage.h - d.h * fit) / 2,
      });
    };
    img.onerror = () => {
      if (cancelled) return;
      setError(STR.errors.imageUnreadable);
    };
    img.src = objectUrl;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, stage.w, stage.h]);

  // Zoom about the window centre so the framed subject stays put.
  const setZoom = useCallback(
    (next: number) => {
      if (!dims || busy) return;
      const s = Math.min(minScale * MAX_ZOOM_FACTOR, Math.max(minScale, next));
      setScale((prev) => {
        const cx = (stage.w / 2 - pos.x) / prev;
        const cy = (stage.h / 2 - pos.y) / prev;
        const np = { x: stage.w / 2 - cx * s, y: stage.h / 2 - cy * s };
        setPos(clampPos(np, s, dims));
        return s;
      });
    },
    [dims, busy, minScale, pos.x, pos.y, clampPos, stage.w, stage.h],
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
    setZoom(scale * (e.deltaY < 0 ? 1.08 : 0.92));
  };

  // Draw the framed region to a canvas and export. Returns null on failure
  // (the hook's `error` is set, so the caller's existing error slot shows it).
  const exportBlob = useCallback((): Promise<Blob | null> => {
    const img = imgRef.current;
    if (!img || !dims) return Promise.resolve(null);
    const srcW = stage.w / scale;
    const srcH = stage.h / scale;
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;

    let outW: number;
    let outH: number;
    if (opts.output.kind === "fixed") {
      outW = opts.output.size;
      outH = opts.output.size;
    } else {
      const outScale = Math.min(1, opts.output.longEdge / Math.max(srcW, srcH));
      outW = Math.max(1, Math.round(srcW * outScale));
      outH = Math.max(1, Math.round(srcH * outScale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(PROCESS_ERROR_BROWSER);
      return Promise.resolve(null);
    }
    ctx.imageSmoothingQuality = "high";
    const asPng = keepPngTransparency && file.type === "image/png";
    if (!asPng) {
      ctx.fillStyle = "#ffffff"; // flatten any transparency (JPEG has no alpha)
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, outW, outH);

    return new Promise((resolve) => {
      const done = (blob: Blob | null) => {
        if (!blob) setError(PROCESS_ERROR_FILE);
        resolve(blob);
      };
      if (asPng) canvas.toBlob(done, "image/png");
      else canvas.toBlob(done, "image/jpeg", 0.92);
    });
  }, [
    dims,
    scale,
    pos.x,
    pos.y,
    stage.w,
    stage.h,
    file.type,
    keepPngTransparency,
    opts.output,
  ]);

  return {
    /** Computed framing-window size — render the stage at exactly this. */
    stage,
    url,
    error,
    /** Source image's natural aspect (w/h), once loaded — null before. Lets an
        adjustable cropper offer an "Original" (no-crop) framing. */
    naturalAspect: dims ? dims.w / dims.h : null,
    /** True once the image is loaded and croppable. */
    ready: !!dims && !error,
    scale,
    minScale,
    maxScale: minScale * MAX_ZOOM_FACTOR,
    /** Range-input step (1% of the zoom span; never 0). */
    zoomStep: (minScale * (MAX_ZOOM_FACTOR - 1)) / 100 || 0.001,
    setZoom,
    /** Top-left of the scaled image inside the stage. */
    pos,
    /** Scaled image dimensions for the <img> style. */
    imgSize: {
      w: dims ? dims.w * scale : 0,
      h: dims ? dims.h * scale : 0,
    },
    /** Spread onto the stage div. */
    stageHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onWheel,
    },
    exportBlob,
  };
}
