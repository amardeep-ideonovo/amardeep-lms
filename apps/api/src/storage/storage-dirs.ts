import * as fs from 'fs';
import * as path from 'path';
import { isProduction } from '../common/env.util';

// ---------- Every path the API keeps files at, in ONE table ----------
//
// Each dir resolves from its env var, falling back to a cwd-relative default.
// The fallback assumes cwd = apps/api — true for `npm -w @lms/api start`, and
// true almost nowhere else. The container's WORKDIR is /app, so an unset var
// there resolves to /app/src/<...>: a path inside the image layer that no
// volume backs.
//
// Nothing crashes when that happens. The app mkdir -p's the path and writes
// member uploads into a directory that dies with the container on the next
// recreate/upgrade. It fails as silent data loss, not a broken boot, which is
// why MEDIA_DIR and CERT_FILES_DIR sat unpinned for months without anyone
// noticing. `assertStorageDirsConfigured()` (called first thing in main.ts)
// makes that loud: in production a writable dir running on the fallback aborts
// boot, the same fail-closed shape jwtSecret() uses in common/env.util.
//
// The fallbacks stay cwd-relative on purpose. __dirname is NOT interchangeable
// here: it points at src/ under ts-node and at the compiled dist/ tree in a
// real build, so anchoring to it makes dev and prod quietly disagree about
// where uploads live.
//
// Adding a storage dir? Add it here, then to apps/api/Dockerfile (image
// default) and deploy/instance/docker-compose.instance.yml (per-instance pin).
// deploy-pins.spec.ts fails the build if you forget either one.

export type StorageDirId =
  | 'MEDIA_DIR'
  | 'BLOG_IMAGES_DIR'
  | 'LESSON_FILES_DIR'
  | 'CERT_FILES_DIR'
  | 'CERT_FONTS_DIR';

export type StorageDirKind =
  // Member-generated files. Must land on a persistent volume, so production
  // demands an explicit path — the cwd fallback would eat them.
  | 'writable'
  // Read-only assets shipped inside the image. Losing the path breaks a
  // feature but destroys nothing, so a bad one is logged, not fatal.
  | 'readonly';

type StorageDirSpec = {
  kind: StorageDirKind;
  /** What lives here, for the boot-time error message. */
  what: string;
  /** Dev-only default, resolved against cwd (= apps/api). */
  devFallback: readonly string[];
};

export const STORAGE_DIRS: Record<StorageDirId, StorageDirSpec> = {
  MEDIA_DIR: {
    kind: 'writable',
    what: 'media-library uploads',
    devFallback: ['src', 'media-uploads'],
  },
  BLOG_IMAGES_DIR: {
    kind: 'writable',
    what: 'blog, page, course and lesson images',
    devFallback: ['src', 'images'],
  },
  LESSON_FILES_DIR: {
    kind: 'writable',
    what: 'lesson note attachments',
    devFallback: ['src', 'files'],
  },
  CERT_FILES_DIR: {
    kind: 'writable',
    what: 'rendered certificate PDFs',
    devFallback: ['src', 'files', 'certificates'],
  },
  CERT_FONTS_DIR: {
    kind: 'readonly',
    what: 'bundled certificate TTFs',
    devFallback: ['src', 'certificates', 'fonts'],
  },
};

export const STORAGE_DIR_IDS = Object.keys(STORAGE_DIRS) as StorageDirId[];

export const WRITABLE_STORAGE_DIR_IDS = STORAGE_DIR_IDS.filter(
  (id) => STORAGE_DIRS[id].kind === 'writable',
);

/**
 * The absolute path for a storage dir: its env var when set, else the
 * cwd-relative dev fallback. Call this at module scope — it's a pure read.
 */
export function resolveStorageDir(
  id: StorageDirId,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const configured = env[id]?.trim();
  return configured || path.resolve(cwd, ...STORAGE_DIRS[id].devFallback);
}

export type StorageDirProblem = {
  id: StorageDirId;
  path: string;
  /** 'unpinned' = fatal in production; 'missing' = logged. */
  reason: 'unpinned' | 'missing';
  message: string;
};

/**
 * The pure core of the boot guard: which dirs are misconfigured, and why.
 * Every input is injectable so the spec can drive it without touching the
 * real environment or filesystem.
 */
export function findStorageDirProblems({
  env = process.env,
  cwd = process.cwd(),
  production = isProduction(),
  exists = fs.existsSync,
}: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  production?: boolean;
  exists?: (p: string) => boolean;
} = {}): StorageDirProblem[] {
  const problems: StorageDirProblem[] = [];

  for (const id of STORAGE_DIR_IDS) {
    const spec = STORAGE_DIRS[id];
    const explicit = Boolean(env[id]?.trim());
    const dir = resolveStorageDir(id, env, cwd);

    if (spec.kind === 'writable') {
      // Only the fallback is a problem. An explicit path is the operator's
      // call — we're catching "nobody chose", not "somebody chose badly".
      if (production && !explicit) {
        problems.push({
          id,
          path: dir,
          reason: 'unpinned',
          message:
            `${id} is not set, so ${spec.what} would be written to ${dir} — ` +
            `a cwd-relative fallback meant for local dev. Under Docker (cwd=/app) ` +
            `that path lives inside the container layer and is destroyed on the ` +
            `next recreate or upgrade, losing every file silently.`,
        });
      }
      continue;
    }

    // Read-only assets: the path either points at the files or it doesn't.
    if (!exists(dir)) {
      problems.push({
        id,
        path: dir,
        reason: 'missing',
        message:
          `${id} resolves to ${dir}, which does not exist — ${spec.what} ` +
          `cannot be read. Anything that depends on them will fail at use time.`,
      });
    }
  }

  return problems;
}

/**
 * Boot guard. Aborts when a writable dir is running on the dev fallback in
 * production (silent data loss), and logs when a read-only dir is missing
 * (a broken feature, but nothing to lose).
 */
export function assertStorageDirsConfigured(
  log: { error: (message: string) => void } = console,
): void {
  const problems = findStorageDirProblems();

  for (const p of problems) {
    if (p.reason === 'missing') log.error(p.message);
  }

  const fatal = problems.filter((p) => p.reason === 'unpinned');
  if (!fatal.length) return;

  throw new Error(
    `Refusing to start: ${fatal.length} storage ` +
      `${fatal.length === 1 ? 'directory is' : 'directories are'} unconfigured.\n` +
      fatal.map((p) => `  - ${p.message}`).join('\n') +
      `\nSet ${fatal.map((p) => p.id).join(', ')} to a path on a persistent ` +
      `volume (see deploy/instance/docker-compose.instance.yml), or set ` +
      `ENV_NAME=development for local work.`,
  );
}
