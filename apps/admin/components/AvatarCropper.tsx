"use client";

import { useModalA11y } from "@/lib/useModalA11y";
import { Button, useImageCropper } from "@lms/ui";
import { STR } from "@lms/types";

// Avatar cropper, admin-skinned. The pan/zoom/crop mechanism lives in
// @lms/ui's useImageCropper (shared with web's AvatarCropper and
// MediaCropper); this file is only the admin markup around it. On apply the
// framed region is exported as a fixed-size JPEG blob, so the existing upload
// endpoint stays unchanged.

const VIEWPORT = 300; // on-screen crop square (px)
const OUTPUT = 512; // exported avatar resolution (px)

type Props = {
  file: File;
  busy?: boolean;
  /** Upload error from the parent, surfaced inside the modal. */
  error?: string | null;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
};

export default function AvatarCropper({
  file,
  busy = false,
  error: uploadError = null,
  onCancel,
  onApply,
}: Props) {
  const modalRef = useModalA11y();
  const crop = useImageCropper({
    file,
    aspect: 1,
    stageMax: { w: VIEWPORT, h: VIEWPORT },
    busy,
    output: { kind: "fixed", size: OUTPUT },
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
      <div className="modal modal--crop">
        <div className="modal-header">
          <h2>Position your photo</h2>
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
                <div className="cropper-mask" aria-hidden="true" />
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
          <Button
            type="button"
            onClick={handleApply}
            disabled={busy || !crop.ready}
          >
            {busy ? "Uploading…" : "Save photo"}
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
