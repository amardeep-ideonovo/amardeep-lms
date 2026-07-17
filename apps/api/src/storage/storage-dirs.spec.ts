import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findStorageDirProblems,
  resolveStorageDir,
  STORAGE_DIRS,
  WRITABLE_STORAGE_DIR_IDS,
} from './storage-dirs';

// The bug these guard: every storage dir falls back to <cwd>/src/..., which is
// only correct when cwd is apps/api. Under Docker cwd is /app, so an unset var
// silently points uploads at the container layer and they vanish on recreate.

// Every writable dir explicitly pinned — the shape of a real container.
const PINNED: NodeJS.ProcessEnv = {
  MEDIA_DIR: '/data/media',
  BLOG_IMAGES_DIR: '/data/images',
  LESSON_FILES_DIR: '/data/files',
  CERT_FILES_DIR: '/data/files/certificates',
  CERT_FONTS_DIR: '/app/apps/api/src/certificates/fonts',
};

const allExist = () => true;

test('resolveStorageDir: an explicit env var wins', () => {
  assert.equal(
    resolveStorageDir('MEDIA_DIR', { MEDIA_DIR: '/data/media' }, '/app'),
    '/data/media',
  );
});

test('resolveStorageDir: unset falls back under cwd, NOT __dirname', () => {
  // Anchored to cwd on purpose: __dirname points at src/ under ts-node and at
  // dist/ in a build, so it would resolve differently in dev and prod.
  assert.equal(
    resolveStorageDir('MEDIA_DIR', {}, '/repo/apps/api'),
    '/repo/apps/api/src/media-uploads',
  );
});

test('resolveStorageDir: whitespace-only env is treated as unset', () => {
  assert.equal(
    resolveStorageDir('MEDIA_DIR', { MEDIA_DIR: '   ' }, '/app'),
    '/app/src/media-uploads',
  );
});

test('production + fully pinned: no problems', () => {
  const problems = findStorageDirProblems({
    env: PINNED,
    cwd: '/app',
    production: true,
    exists: allExist,
  });
  assert.deepEqual(problems, []);
});

test('production + nothing pinned: every writable dir is fatal', () => {
  const problems = findStorageDirProblems({
    env: {},
    cwd: '/app',
    production: true,
    exists: allExist,
  });
  const unpinned = problems.filter((p) => p.reason === 'unpinned');
  assert.deepEqual(
    unpinned.map((p) => p.id).sort(),
    [...WRITABLE_STORAGE_DIR_IDS].sort(),
  );
  // The message has to name the doomed path, or nobody can act on it.
  const media = unpinned.find((p) => p.id === 'MEDIA_DIR');
  assert.ok(media && media.path === '/app/src/media-uploads');
  assert.match(media.message, /destroyed on the next recreate/);
});

test('the exact production bug: MEDIA_DIR unset under Docker is caught', () => {
  // The regression that shipped — everything else pinned, MEDIA_DIR forgotten.
  const { MEDIA_DIR: _omitted, ...withoutMedia } = PINNED;
  const problems = findStorageDirProblems({
    env: withoutMedia,
    cwd: '/app',
    production: true,
    exists: allExist,
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, 'MEDIA_DIR');
  assert.equal(problems[0].reason, 'unpinned');
});

test('dev: unpinned writable dirs are fine (the fallback is the point)', () => {
  const problems = findStorageDirProblems({
    env: {},
    cwd: '/repo/apps/api',
    production: false,
    exists: allExist,
  });
  assert.deepEqual(problems.filter((p) => p.reason === 'unpinned'), []);
});

test('fonts: a read-only dir that exists is fine, in prod or dev', () => {
  for (const production of [true, false]) {
    const problems = findStorageDirProblems({
      env: PINNED,
      cwd: '/app',
      production,
      exists: allExist,
    });
    assert.deepEqual(problems, []);
  }
});

test('fonts: a missing read-only dir is reported but never fatal', () => {
  // The real container failure: CERT_FONTS_DIR unset resolves to
  // /app/src/certificates/fonts, but the TTFs live at /app/apps/api/src/...
  const problems = findStorageDirProblems({
    env: { ...PINNED, CERT_FONTS_DIR: '' },
    cwd: '/app',
    production: true,
    exists: (p) => p !== '/app/src/certificates/fonts',
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, 'CERT_FONTS_DIR');
  // Missing fonts break certificates; they don't destroy data. Don't kill boot.
  assert.equal(problems[0].reason, 'missing');
});

test('an unpinned writable dir is fatal even if the fallback exists on disk', () => {
  // The trap that hid this for months: /app/src/media-uploads DOES exist in the
  // image (it was copied in from a stray host dir), so an existence check would
  // have passed while the data still died on every recreate.
  const problems = findStorageDirProblems({
    env: {},
    cwd: '/app',
    production: true,
    exists: allExist,
  });
  assert.ok(problems.some((p) => p.id === 'MEDIA_DIR' && p.reason === 'unpinned'));
});

test('fonts are the only read-only dir; the rest hold member data', () => {
  // Guards the classification itself: mark a member-data dir read-only by
  // mistake and it silently drops out of the fail-closed set above.
  const readonly = Object.keys(STORAGE_DIRS).filter(
    (id) => STORAGE_DIRS[id as keyof typeof STORAGE_DIRS].kind === 'readonly',
  );
  assert.deepEqual(readonly, ['CERT_FONTS_DIR']);
});
