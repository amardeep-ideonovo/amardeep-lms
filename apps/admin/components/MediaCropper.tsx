"use client";

import { useEffect, useState } from "react";
import { useModalA11y } from "@/lib/useModalA11y";
import { Button, useImageCropper } from "@lms/ui";
import { STR } from "@lms/types";

// Generalized image cropper (rectangular, arbitrary aspect ratio), admin-
// skinned. The pan/zoom/crop mechanism lives in @lms/ui's useImageCropper
// (shared with both AvatarCroppers); this file is only the admin markup. The
// stage shrinks responsively so the modal's buttons never overflow a narrow
// or zoomed viewport, and the export is source-resolution capped to a long
// edge (JPEG for photos; PNG when the source is PNG, to keep transparency).
//
// Two shapes:
//   • fixed-ratio  — a caller passes `aspect` (e.g. a class card at 16/9); the
//     crop window is locked to it.
//   • adjustable   — `adjustable` (used for LOGOS): the window starts at the
//     image's own ratio ("Original" = no crop, just resize) and the user can
//     switch to Square / Wide / 16:9 to crop. Transparency is preserved, so a
//     transparent logo stays transparent.

const STAGE_MAX_W = 440; // on-screen framing window bounds (px)
const STAGE_MAX_H = 320;
const OUTPUT_LONG_EDGE = 1600; // max exported long edge; never upscales

// Aspect presets offered in adjustable mode. `null` = the image's own ratio.
const ASPECT_PRESETS: { key: string; label: string; value: number | null }[] = [
  { key: "orig", label: "Original", value: null },
  { key: "sq", label: "Square", value: 1 },
  { key: "wide", label: "Wide", value: 3 },
  { key: "std", label: "16:9", value: 16 / 9 },
];

type Props = {
  file: File;
  aspect: number; // width / height of the crop window (e.g. 16/9, 3/4, 1)
  // Logo mode: show aspect presets and default to the image's own ratio (no
  // forced crop). `aspect` is then only the pre-measure fallback.
  adjustable?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

export default function MediaCropper({
  file,
  aspect,
  adjustable = false,
  busy = false,
  error: uploadError = null,
  onCancel,
  onApply,
}: Props) {
  // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.
  const modalRef = useModalA11y();

  // Chosen aspect ratio while adjusting; null = "Original" (the image's own
  // ratio). Fixed-ratio mode ignores this.
  const [choice, setChoice] = useState<number | null>(null);
  // Measure the source's own ratio up front (a light, separate decode) so the
  // "Original" framing is right on first paint — otherwise the stage would flash
  // from the fallback ratio to the real one once useImageCropper finishes.
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (!adjustable) return;
    let cancelled = false;
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setMeasured(
        img.naturalWidth && img.naturalHeight
          ? img.naturalWidth / img.naturalHeight
          : 1,
      );
    };
    img.onerror = () => {
      if (!cancelled) setMeasured(1);
    };
    img.src = u;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(u);
    };
  }, [file, adjustable]);

  const effectiveAspect = adjustable ? (choice ?? measured ?? aspect) : aspect;
  // In adjustable mode, hold the stage back until we know the real ratio, so the
  // user never sees the fallback framing.
  const framingReady = !adjustable || measured != null;

  const crop = useImageCropper({
    file,
    aspect: effectiveAspect,
    stageMax: { w: STAGE_MAX_W, h: STAGE_MAX_H },
    responsive: true,
    busy,
    output: { kind: "capped", longEdge: OUTPUT_LONG_EDGE },
    keepPngTransparency: true,
  });

  const handleApply = async () => {
    if (busy || !crop.ready) return;
    const blob = await crop.exportBlob();
    if (blob) onApply(blob);
  };

  return (
    <div
      ref={modalRef}
      className="modal-overlay modal-overlay--center"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal modal--crop modal--crop-rect">
        <div className="modal-header">
          <h2>{adjustable ? "Crop & resize" : "Position the image"}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label={STR.common.close}
            onClick={onCancel}
            disabled={busy}
          >
            ×
          </button>
        </div>
        <div className="modal-body cropper-body">
          {crop.error ? (
            <p className="error">{crop.error}</p>
          ) : (
            <>
              {adjustable && (
                <div
                  className="cropper-aspects"
                  role="group"
                  aria-label="Crop shape"
                >
                  {ASPECT_PRESETS.map((p) => {
                    const active =
                      p.value === null
                        ? choice === null
                        : choice !== null && Math.abs(choice - p.value) < 0.001;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        className={
                          active
                            ? "crop-aspect-btn crop-aspect-btn--active"
                            : "crop-aspect-btn"
                        }
                        aria-pressed={active}
                        disabled={busy || !framingReady}
                        onClick={() => setChoice(p.value)}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div
                className="cropper-stage"
                style={{ width: crop.stage.w, height: crop.stage.h }}
                {...crop.stageHandlers}
                role="application"
                aria-label="Drag to reposition, scroll to zoom"
              >
                {framingReady && crop.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={crop.url}
                    alt=""
                    className="cropper-img"
                    draggable={false}
                    style={{
                      left: crop.pos.x,
                      top: crop.pos.y,
                      width: crop.imgSize.w,
                      height: crop.imgSize.h,
                    }}
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
                  min={crop.minScale}
                  max={crop.maxScale}
                  step={crop.zoomStep}
                  value={crop.scale}
                  onChange={(e) => crop.setZoom(Number(e.target.value))}
                  aria-label="Zoom"
                  disabled={busy}
                />
                <span className="cropper-zoom-ic" aria-hidden="true">
                  +
                </span>
              </div>
              <p className="muted cropper-hint">
                {adjustable
                  ? "Original keeps the whole logo (just resized). Pick a shape, drag to reposition, scroll to zoom."
                  : "Drag to reposition · scroll or use the slider to zoom."}
              </p>
            </>
          )}
          {uploadError && !crop.error && (
            <p className="error cropper-upload-error">{uploadError}</p>
          )}
        </div>
        <div className="dialog-actions cropper-actions">
          <Button
            type="button"
            onClick={handleApply}
            disabled={busy || !crop.ready}
          >
            {busy ? "Uploading…" : STR.common.save}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {STR.common.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
