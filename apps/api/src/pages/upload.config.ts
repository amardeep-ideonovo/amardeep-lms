import * as fs from 'fs';
import * as path from 'path';
import { resolveStorageDir } from '../storage/storage-dirs';

// Page-builder images share the same images root as the rest of the app.
// In prod BLOG_IMAGES_DIR points at a persistent volume; in dev it falls back
// to <api>/src/images. Page images live under a `page/` subdir and are served
// by the single /images static mount in main.ts (so /images/page/* just works).
export const IMAGES_ROOT = resolveStorageDir('BLOG_IMAGES_DIR');

export const PAGE_IMAGE_DIR = path.join(IMAGES_ROOT, 'page');
export const PAGE_IMAGE_URL_PATH = '/images/page';

// Create the upload directory tree if missing (idempotent).
export function ensurePageUploadDir(): void {
  fs.mkdirSync(PAGE_IMAGE_DIR, { recursive: true });
}

// Allowed image types -> canonical extension. SVG is intentionally excluded:
// it can carry inline script and these files are served from our own origin.
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

// Resolve a safe extension from the mime type (preferred) or filename.
// Returns null for anything that isn't an allowed image.
export function imageExt(mime: string, originalName: string): string | null {
  const byMime = MIME_TO_EXT[mime];
  if (byMime) return byMime;
  const ext = path.extname(originalName || '').toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return null;
}
