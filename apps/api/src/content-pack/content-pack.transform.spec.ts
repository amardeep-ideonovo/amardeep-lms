import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOrigin,
  rewriteOrigin,
  rewriteJson,
  rewriteRowOrigin,
  normalizeRowForImport,
  scrubFooterAudience,
  serializePack,
  deserializePack,
  isSafeRelPath,
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
} from './content-pack.transform';
import type { ContentPack } from './content-pack.types';

const DEMO = 'https://api.demo.thewebpaanda.com';
const TARGET = 'https://acme-api.app.thewebpaanda.com';

test('normalizeOrigin trims and strips trailing slashes', () => {
  assert.equal(normalizeOrigin('  https://x.test/  '), 'https://x.test');
  assert.equal(normalizeOrigin('https://x.test///'), 'https://x.test');
});

test('normalizeOrigin maps empty/undefined to empty string', () => {
  assert.equal(normalizeOrigin(undefined), '');
  assert.equal(normalizeOrigin(null), '');
  assert.equal(normalizeOrigin(''), '');
});

test('normalizeOrigin rejects non-origins (would corrupt the rewrite)', () => {
  assert.equal(normalizeOrigin('garbage'), '');
  assert.equal(normalizeOrigin('https:'), '');
  assert.equal(normalizeOrigin('ftp://x.test'), '');
  assert.equal(normalizeOrigin('https://x.test/some/path'), '');
  assert.equal(normalizeOrigin('https://x.test:3000'), 'https://x.test:3000');
});

test('rewriteOrigin swaps every occurrence of the source origin', () => {
  assert.equal(rewriteOrigin(`${DEMO}/media/a.jpg`, DEMO, TARGET), `${TARGET}/media/a.jpg`);
  assert.equal(
    rewriteOrigin(`see ${DEMO}/x and ${DEMO}/y`, DEMO, TARGET),
    `see ${TARGET}/x and ${TARGET}/y`,
  );
});

test('rewriteOrigin is a no-op when origins match or either is empty', () => {
  assert.equal(rewriteOrigin(`${DEMO}/m`, DEMO, DEMO), `${DEMO}/m`);
  assert.equal(rewriteOrigin(`${DEMO}/m`, '', TARGET), `${DEMO}/m`);
  // empty target must NOT strip the origin to a broken relative path
  assert.equal(rewriteOrigin(`${DEMO}/media/a.jpg`, DEMO, ''), `${DEMO}/media/a.jpg`);
});

test('rewriteOrigin does not touch bare relative paths', () => {
  assert.equal(rewriteOrigin('/media/a.jpg', DEMO, TARGET), '/media/a.jpg');
});

test('rewriteJson rewrites strings nested in objects and arrays', () => {
  const doc = {
    root: { logoUrl: `${DEMO}/media/logo.png` },
    skills: [{ title: 'A', imageUrl: `${DEMO}/media/1.jpg` }],
    n: 3,
    flag: true,
    empty: null,
  };
  assert.deepEqual(rewriteJson(doc, DEMO, TARGET), {
    root: { logoUrl: `${TARGET}/media/logo.png` },
    skills: [{ title: 'A', imageUrl: `${TARGET}/media/1.jpg` }],
    n: 3,
    flag: true,
    empty: null,
  });
});

test('rewriteJson leaves ISO date strings untouched (Date-safety contract)', () => {
  // Rows are rewritten only AFTER a JSON round-trip, so Dates are ISO strings.
  const iso = '2026-08-13T10:00:00.000Z';
  assert.equal(rewriteJson(iso, DEMO, TARGET), iso);
});

test('rewriteJson preserves a literal __proto__ key without polluting', () => {
  const parsed = JSON.parse('{"__proto__": {"x": 1}, "ok": 2}');
  const out: any = rewriteJson(parsed, DEMO, TARGET);
  assert.equal(out.ok, 2);
  assert.equal(({} as any).x, undefined); // no prototype pollution
  assert.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), true);
});

test('rewriteRowOrigin rewrites scalar columns and nested JSON in one pass', () => {
  const level = {
    id: 'lvl1',
    imageUrl: `${DEMO}/media/hero.jpg`,
    skills: [{ title: 'X', imageUrl: `${DEMO}/media/s.jpg` }],
    createdAt: '2026-08-13T00:00:00.000Z',
  };
  const out = rewriteRowOrigin(level, DEMO, TARGET);
  assert.equal(out.imageUrl, `${TARGET}/media/hero.jpg`);
  assert.equal(out.skills[0].imageUrl, `${TARGET}/media/s.jpg`);
  assert.equal(out.createdAt, '2026-08-13T00:00:00.000Z');
});

test('normalizeRowForImport strips updatedAt and nulls provider ids on a price', () => {
  const out = normalizeRowForImport(
    'price',
    {
      id: 'p1',
      levelId: 'lvl1',
      stripePriceId: 'price_123',
      paypalPlanId: 'P-9',
      amount: 1000,
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    'admin1',
  );
  assert.equal(out.stripePriceId, null);
  assert.equal(out.paypalPlanId, null);
  assert.equal(out.amount, 1000);
  assert.equal('updatedAt' in out, false);
});

test('normalizeRowForImport nulls level provider + audience ids but keeps featured/cert refs', () => {
  const out = normalizeRowForImport(
    'level',
    {
      id: 'lvl1',
      stripeProductId: 'prod_1',
      paypalProductId: 'PPP',
      audienceId: 'aud1',
      featuredCourseId: 'course1',
      certificateTemplateId: 'cert1',
    },
    'admin1',
  );
  assert.equal(out.stripeProductId, null);
  assert.equal(out.paypalProductId, null);
  assert.equal(out.audienceId, null);
  assert.equal(out.featuredCourseId, 'course1');
  assert.equal(out.certificateTemplateId, 'cert1');
});

test('normalizeRowForImport leaves rows without a rule set unchanged (minus managed)', () => {
  const out = normalizeRowForImport('lesson', { id: 'l1', title: 'T', updatedAt: 'x' }, 'admin1');
  assert.deepEqual(out, { id: 'l1', title: 'T' });
});

test('normalizeRowForImport remaps author/uploader FKs to the target owner admin', () => {
  assert.equal(
    normalizeRowForImport('post', { id: 'p1', authorId: 'demoAdmin' }, 'admin1').authorId,
    'admin1',
  );
  assert.equal(
    normalizeRowForImport('page', { id: 'pg1', authorId: 'demoAdmin' }, 'admin1').authorId,
    'admin1',
  );
  assert.equal(
    normalizeRowForImport('mediaAsset', { id: 'm1', uploadedById: 'demoAdmin' }, 'admin1')
      .uploadedById,
    'admin1',
  );
});

test('normalizeRowForImport remaps author to null when target has no owner admin', () => {
  assert.equal(
    normalizeRowForImport('post', { id: 'p1', authorId: 'demoAdmin' }, null).authorId,
    null,
  );
});

test('normalizeRowForImport zeros popup analytics counters', () => {
  const out = normalizeRowForImport(
    'popup',
    { id: 'pop1', name: 'Promo', views: 42, clicks: 7, dismissals: 3 },
    'admin1',
  );
  assert.equal(out.views, 0);
  assert.equal(out.clicks, 0);
  assert.equal(out.dismissals, 0);
  assert.equal(out.name, 'Promo');
});

test('scrubFooterAudience nulls email.audienceId in place', () => {
  const cfg = { logoUrl: 'x', email: { audienceId: 'aud1', heading: 'Join' } };
  assert.deepEqual(scrubFooterAudience(cfg), {
    logoUrl: 'x',
    email: { audienceId: null, heading: 'Join' },
  });
});

test('scrubFooterAudience passes through configs without an email block', () => {
  assert.deepEqual(scrubFooterAudience({ logoUrl: 'x' }), { logoUrl: 'x' });
  assert.equal(scrubFooterAudience(null), null);
});

const samplePack = (): ContentPack => ({
  manifest: {
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    createdAt: '2026-08-13T00:00:00.000Z',
    sourceOrigin: DEMO,
    imageTag: 'sha-abc',
    counts: { levels: 2 },
  },
  content: {
    levelCategories: [],
    certificateTemplates: [],
    courses: [],
    levels: [{ id: 'lvl1', name: 'Music' }],
    prices: [],
    courseLevels: [],
    lessons: [],
    lessonNotes: [],
    mediaAssets: [],
    menus: [],
    menuLocationAssignments: [],
    menuItems: [],
    postCategories: [],
    posts: [],
    pages: [],
    forms: [],
    popups: [],
    headers: [],
    footer: null,
    appConfig: null,
  },
  files: [{ store: 'media', relpath: 'a.jpg', b64: Buffer.from('hi').toString('base64') }],
});

test('serialize / deserialize round-trips a pack through gzip', () => {
  const restored = deserializePack(serializePack(samplePack()));
  assert.equal(restored.manifest.sourceOrigin, DEMO);
  assert.equal(restored.content.levels[0].id, 'lvl1');
  assert.equal(Buffer.from(restored.files[0].b64, 'base64').toString(), 'hi');
});

test('deserializePack rejects non-gzip input', () => {
  assert.throws(() => deserializePack(Buffer.from('not gzip')), /not valid gzip/);
});

test('deserializePack rejects a gzipped blob that is not a content pack', () => {
  const bad = serializePack({ manifest: { format: 'nope' } } as unknown as ContentPack);
  assert.throws(() => deserializePack(bad), /not an LMS content pack/);
});

test('isSafeRelPath accepts plain relative paths', () => {
  assert.equal(isSafeRelPath('a.jpg'), true);
  assert.equal(isSafeRelPath('course/1786-abc.jpg'), true);
});

test('isSafeRelPath rejects traversal, absolute, and drive paths', () => {
  assert.equal(isSafeRelPath('../etc/passwd'), false);
  assert.equal(isSafeRelPath('a/../../b'), false);
  assert.equal(isSafeRelPath('/abs'), false);
  assert.equal(isSafeRelPath('C:\\x'), false);
  assert.equal(isSafeRelPath(''), false);
  assert.equal(isSafeRelPath('a/./b'), false);
});
