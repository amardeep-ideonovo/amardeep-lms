import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { STORAGE_DIRS, STORAGE_DIR_IDS, WRITABLE_STORAGE_DIR_IDS } from './storage-dirs';

// Static check that the deploy actually pins what the API expects. The boot
// guard in storage-dirs.ts only fires once an instance is starting; this fails
// the build instead, and it reads the dirs off the same table the API does, so
// a NEW storage dir is covered the moment it's declared — no one has to
// remember to extend this file.
//
// __dirname is safe here (unlike in the app): specs only ever run from src via
// ts-node — see the "test" script in apps/api/package.json.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const COMPOSE = path.join(REPO_ROOT, 'deploy/instance/docker-compose.instance.yml');
const DOCKERFILE = path.join(REPO_ROOT, 'apps/api/Dockerfile');
const MIGRATION = path.join(REPO_ROOT, 'deploy/scripts/migrate-media-to-volume.sh');

/** The Dockerfile's WORKDIR — what an unpinned dir resolves its fallback against. */
const CONTAINER_CWD = '/app';

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** `KEY: value` pairs. These keys are unique to the api service, so a
 *  whole-file scan can't pick up a web/admin value by accident. */
function composePins(): Map<string, string> {
  const pins = new Map<string, string>();
  for (const raw of read(COMPOSE).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*):\s*(\S.*)$/.exec(line);
    if (m) pins.set(m[1], m[2].trim());
  }
  return pins;
}

/** `ENV KEY=value` pairs from the runtime stage. */
function dockerfilePins(): Map<string, string> {
  const pins = new Map<string, string>();
  for (const raw of read(DOCKERFILE).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^ENV\s+([A-Z][A-Z0-9_]*)=(\S+)$/.exec(line);
    if (m) pins.set(m[1], m[2]);
  }
  return pins;
}

/** Where the persistent `uploads` volume is mounted, read from compose rather
 *  than hardcoded — move the mount and these assertions follow it. */
function uploadsMount(): string {
  const m = /-\s*uploads:(\/\S+)/.exec(read(COMPOSE));
  assert.ok(m, 'compose no longer mounts the `uploads` volume into the api service');
  return m[1];
}

test('compose pins every writable storage dir', () => {
  const pins = composePins();
  for (const id of WRITABLE_STORAGE_DIR_IDS) {
    assert.ok(
      pins.has(id),
      `${id} is not pinned in docker-compose.instance.yml. Unset, it falls back ` +
        `to <cwd>/${STORAGE_DIRS[id].devFallback.join('/')} — inside the container ` +
        `layer — and ${STORAGE_DIRS[id].what} are destroyed on the next recreate.`,
    );
  }
});

test('compose puts every writable dir on the persistent volume', () => {
  const mount = uploadsMount();
  const pins = composePins();
  for (const id of WRITABLE_STORAGE_DIR_IDS) {
    const pinned = pins.get(id)!;
    assert.ok(
      pinned === mount || pinned.startsWith(`${mount}/`),
      `${id} is pinned to ${pinned}, which is outside the ${mount} volume — ` +
        `it would not survive a recreate.`,
    );
  }
});

test('the api image defaults every storage dir', () => {
  // Instances are recreated with whatever compose file happens to be on the
  // host, so compose alone isn't enough: an image bump that lands before the
  // repo pull would boot against the fallback. The image default closes that.
  const pins = dockerfilePins();
  for (const id of STORAGE_DIR_IDS) {
    assert.ok(pins.has(id), `apps/api/Dockerfile does not set ENV ${id}`);
    assert.ok(
      path.isAbsolute(pins.get(id)!),
      `ENV ${id}=${pins.get(id)} must be absolute — a relative path is resolved ` +
        `against the container cwd, which is the bug this pin exists to prevent.`,
    );
  }
});

test('image defaults and compose pins agree', () => {
  const image = dockerfilePins();
  const compose = composePins();
  for (const id of WRITABLE_STORAGE_DIR_IDS) {
    assert.equal(
      compose.get(id),
      image.get(id),
      `${id} disagrees between compose and the image default. Whichever loses, ` +
        `uploads written under one path go missing when the other takes effect.`,
    );
  }
});

/** `"<src>:<dst>"` entries from the migration script's PAIRS array. */
function migrationPairs(): Array<{ src: string; dst: string }> {
  const block = /^PAIRS=\(([\s\S]*?)^\)/m.exec(read(MIGRATION));
  assert.ok(block, 'migrate-media-to-volume.sh no longer declares a PAIRS array');
  return [...block[1].matchAll(/"([^":]+):([^":]+)"/g)].map((m) => ({
    src: m[1],
    dst: m[2],
  }));
}

test('the migration script rescues into the paths compose actually pins', () => {
  // The script copies files off the container layer BEFORE an upgrade recreates
  // it. If its destination and the compose pin disagree, it reports success and
  // the files are still lost — unrecoverably, since they were never on the
  // volume and so are in no backup. That is not hypothetical: the script was
  // written against /data/certificates while the merged pin was
  // /data/files/certificates.
  const pins = composePins();
  const bySrc = new Map(
    WRITABLE_STORAGE_DIR_IDS.map((id) => [
      path.posix.join(CONTAINER_CWD, ...STORAGE_DIRS[id].devFallback),
      id,
    ]),
  );

  for (const { src, dst } of migrationPairs()) {
    const id = bySrc.get(src);
    assert.ok(
      id,
      `the script migrates from ${src}, which is no storage dir's container ` +
        `fallback. Either the dir moved in storage-dirs.ts (and the script now ` +
        `rescues nothing), or this line is dead.`,
    );
    assert.equal(
      dst,
      pins.get(id),
      `the script copies ${id} to ${dst}, but compose pins it to ${pins.get(id)}. ` +
        `The upgraded api reads the pin, so the rescued files would be invisible.`,
    );
  }
});

test('the certificate fonts pin points at real files in the image', () => {
  // Read-only repo assets, so they belong in the image, not on the volume.
  // This is the check that would have caught the shipped bug: the cwd fallback
  // resolved to /app/src/certificates/fonts, but the TTFs are copied to
  // /app/apps/api/src/certificates/fonts and every render threw ENOENT.
  const pinned = dockerfilePins().get('CERT_FONTS_DIR')!;
  const mount = uploadsMount();
  assert.ok(
    !pinned.startsWith(`${mount}/`),
    `CERT_FONTS_DIR is pinned to ${pinned}, on the uploads volume — the TTFs ` +
      `ship in the image and the volume would shadow them.`,
  );

  // The Dockerfile's WORKDIR is /app and it copies the repo there, so an
  // /app/... pin maps back onto a path in this checkout.
  assert.ok(pinned.startsWith('/app/'), `expected an /app/... path, got ${pinned}`);
  const inRepo = path.join(REPO_ROOT, pinned.slice('/app/'.length));
  assert.ok(
    fs.existsSync(inRepo),
    `CERT_FONTS_DIR points at ${pinned}, which maps to ${inRepo} — not in the repo, ` +
      `so it won't be in the image either.`,
  );
  const ttfs = fs.readdirSync(inRepo).filter((f) => f.endsWith('.ttf'));
  assert.ok(ttfs.length > 0, `no .ttf files at ${inRepo}`);
});
