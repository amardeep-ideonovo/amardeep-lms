// A control-plane "demo content pack": a portable, instance-agnostic snapshot of
// everything an operator authors in the admin UI — catalog, lessons, pages,
// popups, navigation, header/footer, branding, blog, forms, certificate
// templates, and the uploaded files those reference. It carries NOTHING
// tenant-specific: no members, admins, encrypted Settings, subscriptions, issued
// certificates, audiences, email logs, or support/chat/live data.
//
// Produced by `GET /content-pack/export` on the demo instance and replayed into a
// fresh instance by `POST /content-pack/import`. The archive is a single gzipped
// JSON document (see content-pack.transform.ts) — no tar/zip dependency — with
// file bytes inlined as base64. See content-pack.service.ts for the exact model
// list, the FK-safe insert order, and the transforms applied on import.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PackRow = Record<string, any>;

// Which on-disk store a file belongs to. Mirrors the three writable upload roots
// that hold operator-authored content (rendered certificate PDFs and bundled
// fonts are deliberately excluded — the former is issued state, the latter ships
// in the image).
export type PackFileStore =
  | 'media' // MEDIA_DIR — gallery + certificate artwork, served at /media
  | 'images' // BLOG_IMAGES_DIR — per-entity images, served at /images/<subdir>
  | 'lesson-notes'; // LESSON_FILES_DIR/lesson-notes — access-checked attachments

export interface PackFile {
  store: PackFileStore;
  // Path RELATIVE to the store root, e.g. "1786-abc.jpg" (media) or
  // "course/1786-abc.jpg" (images). Validated against traversal on import.
  relpath: string;
  b64: string; // file bytes, base64
}

export interface PackManifest {
  format: 'lms-content-pack';
  formatVersion: number;
  createdAt: string; // ISO
  // PUBLIC_API_URL of the demo instance this was exported from. Import rewrites
  // this origin to the target instance's across every URL / HTML / JSON field.
  sourceOrigin: string;
  // Baked APP_VERSION of the demo instance at export time — provenance + a hook
  // for control-plane staleness checks (re-publish when the fleet moves on).
  imageTag: string | null;
  counts: Record<string, number>;
}

// Row sets, stored as plain JSON (Prisma scalars; Date columns become ISO
// strings). `levels` and `posts` additionally carry `categories: {id}[]` for
// their implicit many-to-many, reconnected on import. `footer`/`appConfig` are
// singletons and may be absent.
export interface PackContent {
  levelCategories: PackRow[];
  certificateTemplates: PackRow[];
  courses: PackRow[];
  levels: PackRow[];
  prices: PackRow[];
  courseLevels: PackRow[];
  lessons: PackRow[];
  lessonNotes: PackRow[];
  mediaAssets: PackRow[];
  menus: PackRow[];
  menuLocationAssignments: PackRow[];
  menuItems: PackRow[];
  postCategories: PackRow[];
  posts: PackRow[];
  pages: PackRow[];
  forms: PackRow[];
  popups: PackRow[];
  headers: PackRow[];
  footer: PackRow | null;
  appConfig: PackRow | null;
}

export interface ContentPack {
  manifest: PackManifest;
  content: PackContent;
  files: PackFile[];
}

export interface ImportResult {
  imported: boolean;
  // true when a pack was already present and this call was a no-op (idempotent
  // retry) rather than a fresh import.
  alreadyImported: boolean;
  packVersion: number;
  counts: Record<string, number>;
}

export interface PackStatus {
  imported: boolean;
  packVersion: number | null;
  packLabel: string | null;
  sourceOrigin: string | null;
  importedAt: string | null;
}
