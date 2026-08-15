"use client";

import { useModalA11y } from "@/lib/useModalA11y";
import { useImageCropper } from "@lms/ui";
import { STR } from "@lms/types";

// Generalized image cropper (rectangular, arbitrary aspect ratio), admin-
// skinned. The pan/zoom/crop mechanism lives in @lms/ui's useImageCropper
// (shared with both AvatarCroppers); this file is only the admin markup. The
// stage shrinks responsively so the modal's buttons never overflow a narrow
// or zoomed viewport, and the export is source-resolution capped to a long
// edge (JPEG for photos; PNG when the source is PNG, to keep transparency).

const STAGE_MAX_W = 440; // on-screen framing window bounds (px)
const STAGE_MAX_H = 320;
const OUTPUT_LONG_EDGE = 1600; // max exported long edge; never upscales

type Props = {
  file: File;
  aspect: number; // width / height of the crop window (e.g. 16/9, 3/4, 1)
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

export default function MediaCropper({
  file,
  aspect,
  busy = false,
  error: uploadError = null,
  onCancel,
  onApply,
}: Props) {
  // Not dismissable by accident (backdrop/Escape) — use ×/Cancel/Save.
  const modalRef = useModalA11y();
  const crop = useImageCropper({
    file,
    aspect,
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
          <h2>Position the image</h2>
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
              <div
                className="cropper-stage"
                style={{ width: crop.stage.w, height: crop.stage.h }}
                {...crop.stageHandlers}
                role="application"
                aria-label="Drag to reposition, scroll to zoom"
              >
                {crop.url && (
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
                Drag to reposition · scroll or use the slider to zoom.
              </p>
            </>
          )}
          {uploadError && !crop.error && (
            <p className="error cropper-upload-error">{uploadError}</p>
          )}
        </div>
        <div className="dialog-actions cropper-actions">
          <button
            type="button"
            className="btn"
            onClick={handleApply}
            disabled={busy || !crop.ready}
          >
            {busy ? "Uploading…" : STR.common.save}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {STR.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
