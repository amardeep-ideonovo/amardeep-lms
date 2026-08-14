import sharp from "sharp";

// Photos land in the media library as multi-megabyte originals (a phone camera
// PNG is easily 8 MB) yet render at a few hundred pixels. We downscale to a sane
// ceiling and re-encode on upload — turning an 8 MB PNG into ~150–300 KB with no
// visible quality loss, the single biggest lever on member-facing page weight.
//
// We deliberately re-encode to JPEG (opaque images) / PNG (anything with
// transparency), NOT WebP: these two are embeddable in the certificate PDF
// renderer (which sniffs PNG/JPEG) and render everywhere email + older clients
// do, whereas WebP would break cert artwork and email logos. JPEG still gets us
// ~30–50× smaller on photos, which is the whole point here.

// Longest edge, in pixels. 1920 is plenty for a full-bleed landing hero on a
// retina display; everything else is downscaled well below it.
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 82;
const PNG_COMPRESSION = 9;

// Raster formats worth re-encoding. SVG (vector — sanitized elsewhere) and GIF
// (may be animated; a plain sharp pass would flatten it) are handled by callers
// and deliberately excluded.
export function isOptimizableImage(mime: string): boolean {
  return /^image\/(jpe?g|png|webp|avif|tiff|bmp)$/i.test(mime);
}

export type OptimizedImage = {
  buffer: Buffer;
  ext: string; // ".jpg" or ".png"
  mimeType: string; // "image/jpeg" or "image/png"
  width: number;
  height: number;
};

/**
 * Downscale (never upscale) to fit MAX_DIMENSION and re-encode: opaque images →
 * JPEG (small), images with an alpha channel → PNG (transparency preserved).
 * Returns the new bytes plus extension/mime/dimensions so the caller can rebuild
 * its storage key and public URL. sharp throws on a buffer that isn't a real
 * image, so this doubles as content validation.
 */
export async function optimizeImage(input: Buffer): Promise<OptimizedImage> {
  const meta = await sharp(input, { failOn: "error" }).metadata();
  const hasAlpha = meta.hasAlpha === true;

  const pipeline = sharp(input, { failOn: "error" })
    .rotate() // apply EXIF orientation, then drop the metadata
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

  if (hasAlpha) {
    const { data, info } = await pipeline
      .png({ compressionLevel: PNG_COMPRESSION })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      ext: ".png",
      mimeType: "image/png",
      width: info.width,
      height: info.height,
    };
  }

  const { data, info } = await pipeline
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    ext: ".jpg",
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}
