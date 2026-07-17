import * as fs from 'fs';
import * as path from 'path';
import { resolveStorageDir } from '../storage/storage-dirs';

// Where uploaded blog images are stored on disk AND served from, i.e.
// `<IMAGES_ROOT>/blog-post/<timestamp>.<ext>`. In dev this is the API's own
// `src/images` dir; in production BLOG_IMAGES_DIR points at a persistent
// volume (storage-dirs.ts refuses to boot otherwise). The route + filename
// scheme stay identical either way.
export const IMAGES_ROOT = resolveStorageDir('BLOG_IMAGES_DIR');

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
