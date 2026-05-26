import * as fs from 'fs';
import * as path from 'path';

// Where uploaded blog images are stored on disk AND served from.
//
// Default: the API's own `src/images` dir (as requested) — i.e.
// `<api>/src/images/blog-post/<timestamp>.<ext>`. The dev server runs with
// cwd = apps/api, so this resolves to apps/api/src/images.
//
// PRODUCTION NOTE: Render's container filesystem is ephemeral — files written
// here are wiped on every redeploy/restart. For persistence in prod, set
// BLOG_IMAGES_DIR to a mounted persistent disk path (or switch to object
// storage). The route + filename scheme stay identical.
export const IMAGES_ROOT =
  process.env.BLOG_IMAGES_DIR || path.resolve(process.cwd(), 'src', 'images');

// Sub-folder for blog post images, served under /images/blog-post/*.
export const BLOG_POST_DIR = path.join(IMAGES_ROOT, 'blog-post');

// Public route prefix the API serves the images directory under.
export const IMAGES_ROUTE = '/images';
export const BLOG_POST_URL_PATH = '/images/blog-post';

// Create the upload directory tree if missing (idempotent).
export function ensureUploadDirs(): void {
  fs.mkdirSync(BLOG_POST_DIR, { recursive: true });
}

// Allowed image types -> canonical extension.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
]);

// Resolve a safe extension from the mime type (preferred) or filename.
// Returns null for anything that isn't an allowed image.
export function imageExt(mime: string, originalName: string): string | null {
  const byMime = MIME_TO_EXT[mime];
  if (byMime) return byMime;
  const ext = path.extname(originalName || '').toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return null;
}
