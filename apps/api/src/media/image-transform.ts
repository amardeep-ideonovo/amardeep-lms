import sharp from 'sharp';

// Photos land in the media library as multi-megabyte originals (a phone camera
// PNG is easily 8 MB) yet render at a few hundred pixels. We downscale to a sane
// ceiling and re-encode to WebP on upload, which typically turns an 8 MB PNG
// into ~100–200 KB with no visible quality loss — the single biggest lever on
// member-facing page weight.

// Longest edge, in pixels. 1920 is plenty for a full-bleed landing hero on a
// retina display; everything else is downscaled well below it.
const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 80;

export const OPTIMIZED_EXT = '.webp';
export const OPTIMIZED_MIME = 'image/webp';

// Raster formats worth re-encoding to WebP. SVG (vector — sanitized elsewhere)
// and GIF (may be animated; a plain sharp pass would flatten it) are handled by
// callers and deliberately excluded.
export function isOptimizableImage(mime: string): boolean {
  return /^image\/(jpe?g|png|webp|avif|tiff|bmp)$/i.test(mime);
}

export type OptimizedImage = {
  buffer: Buffer;
  ext: string; // ".webp"
  mimeType: string; // "image/webp"
  width: number;
  height: number;
};

/**
 * Downscale (never upscale) to fit MAX_DIMENSION and re-encode to WebP. Returns
 * the new bytes plus the extension/mime/dimensions so the caller can rebuild its
 * storage key and public URL. sharp throws on a buffer that isn't a real image,
 * so this doubles as content validation (a mislabeled upload is rejected).
 */
export async function optimizeImage(input: Buffer): Promise<OptimizedImage> {
  const { data, info } = await sharp(input, { failOn: 'error' })
    .rotate() // apply EXIF orientation, then drop the metadata
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    ext: OPTIMIZED_EXT,
    mimeType: OPTIMIZED_MIME,
    width: info.width,
    height: info.height,
  };
}
