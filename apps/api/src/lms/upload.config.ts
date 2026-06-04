import * as fs from 'fs';
import * as path from 'path';
import { IMAGES_ROOT, imageExt } from '../blog/upload.config';

// Reuse the blog image validator + the same public images root so all uploaded
// images share one served tree (/images/*, see main.ts).
export { imageExt };

// ---------- Public images (served at /images via express.static) ----------
// Course + lesson images sit alongside blog images under the public root.
export const COURSE_IMG_DIR = path.join(IMAGES_ROOT, 'course');
export const LESSON_IMG_DIR = path.join(IMAGES_ROOT, 'lesson');
export const COURSE_IMG_URL_PATH = '/images/course';
export const LESSON_IMG_URL_PATH = '/images/lesson';

// ---------- Private files (NEVER served statically) ----------
// Lesson note attachments. Streamed only through an access-checked endpoint so
// a locked course can't leak its materials via a guessable URL.
//
// PRODUCTION NOTE: like the images dir, this is ephemeral on Render. Point
// LESSON_FILES_DIR at a mounted persistent disk (or object storage) in prod.
export const FILES_ROOT =
  process.env.LESSON_FILES_DIR || path.resolve(process.cwd(), 'src', 'files');
export const LESSON_NOTES_DIR = path.join(FILES_ROOT, 'lesson-notes');

// Create the upload directory tree if missing (idempotent).
export function ensureLmsUploadDirs(): void {
  fs.mkdirSync(COURSE_IMG_DIR, { recursive: true });
  fs.mkdirSync(LESSON_IMG_DIR, { recursive: true });
  fs.mkdirSync(LESSON_NOTES_DIR, { recursive: true });
}

// Size caps (multer enforces these per request).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
export const MAX_NOTE_BYTES = 25 * 1024 * 1024; // 25 MB per note file
export const MAX_NOTES_PER_UPLOAD = 20;

// Allowed attachment types -> canonical extension.
const NOTE_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const NOTE_ALLOWED_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.zip',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
]);

// Resolve a safe extension for an attachment from its mime (preferred) or
// filename. Returns null for anything not in the allow-list.
export function noteFileExt(mime: string, originalName: string): string | null {
  const byMime = NOTE_MIME_TO_EXT[mime];
  if (byMime) return byMime;
  const ext = path.extname(originalName || '').toLowerCase();
  if (NOTE_ALLOWED_EXT.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  return null;
}

// Unique, timestamp-based filename (matches the blog scheme), preserving ext.
// A short random suffix avoids collisions when several files upload in the
// same millisecond (multi-file note uploads).
export function timestampName(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${rand}${ext}`;
}
