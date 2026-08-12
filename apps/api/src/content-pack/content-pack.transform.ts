// Pure, dependency-free core of the content-pack feature: origin rewriting, the
// per-row transforms applied on import, and gzip (de)serialization of the
// archive. No Nest, no Prisma, no filesystem — every function here is a total
// function over plain data, so content-pack.transform.spec.ts can exercise the
// tricky bits (URL rewriting, provider-id scrubbing, Date-safety) without a
// database.

import * as zlib from 'zlib';
import type { ContentPack, PackRow } from './content-pack.types';

export const PACK_FORMAT = 'lms-content-pack' as const;
export const PACK_FORMAT_VERSION = 1;

// Upper bound on the gunzipped archive. The import channel is service-token
// authenticated (only the control plane can reach it), so this is defense in
// depth against a malformed/hostile archive exhausting memory — not the primary
// gate. Demo packs are single-digit MB; this leaves generous headroom.
export const MAX_PACK_JSON_BYTES = 512 * 1024 * 1024;

// Trim, drop any trailing slash, and require a real http(s) origin. A short or
// malformed value (from a hand-edited or hostile manifest) would turn the
// substring rewrite `value.split(from).join(to)` into a content-corrupting
// find/replace — e.g. from="https:" would rewrite every https URL in the pack.
// Anything that isn't a clean `scheme://host[:port]` yields '' → rewrite becomes
// a no-op and content is kept verbatim (also the local round-trip case where
// source and target share an origin).
export function normalizeOrigin(raw: string | undefined | null): string {
  const s = (raw || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/.test(s) ? s : '';
}

// Swap every occurrence of the source instance's public origin for the target's.
// A plain substring replace is safe here: `from` is a full origin such as
// "https://api.demo.thewebpaanda.com", which cannot false-match a bare path. A
// no-op when EITHER origin is empty or the two are identical — in particular an
// empty `to` must not run split(from).join('') and strip absolute URLs down to
// broken relative "/media/..." paths (which resolve against the WEB origin).
export function rewriteOrigin(value: string, from: string, to: string): string {
  if (!from || !to || from === to) return value;
  return value.split(from).join(to);
}

// Recursively rewrite the origin inside any JSON value: Puck page/popup
// documents, Level.skills[], and Header/Footer/AppConfig config blobs all embed
// absolute media URLs. Strings are swapped; arrays and objects are recursed;
// numbers/booleans/null pass through untouched.
//
// IMPORTANT: only call this on values that came back from JSON.parse (plain
// objects/arrays/primitives). A live Prisma row holds Date objects, and a Date
// is `typeof 'object'` with no own enumerable keys — walking it would silently
// replace the date with `{}`. That is exactly why the import path rewrites AFTER
// deserialization (where Dates are already ISO strings), never on export.
export function rewriteJson(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return rewriteOrigin(value, from, to);
  if (Array.isArray(value)) return value.map((v) => rewriteJson(v, from, to));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const rv = rewriteJson(v, from, to);
      // JSON.parse yields a literal "__proto__" as an OWN enumerable key; a plain
      // out[k] = rv would set the prototype (and could pollute) instead of storing
      // the value. Define it as a real own property — lossless and safe.
      if (k === '__proto__') {
        Object.defineProperty(out, k, {
          value: rv,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        out[k] = rv;
      }
    }
    return out;
  }
  return value;
}

// Apply the origin rewrite across an entire deserialized row (all string columns
// + every nested JSON value), returning a new object.
export function rewriteRowOrigin(row: PackRow, from: string, to: string): PackRow {
  return rewriteJson(row, from, to) as PackRow;
}

// Fields NULLED on import. Provider price/product ids belong to the demo's own
// Stripe/PayPal account and would point a client's checkout at the wrong
// merchant (the seed models the same safety: Price rows are created with
// stripePriceId: null and back-filled per instance). Audience ids point at the
// demo's own in-house lists — tenant state we never export — so they fall back
// to the target's default "Members" audience.
const SCRUB_NULL: Record<string, string[]> = {
  level: ['stripeProductId', 'paypalProductId', 'audienceId'],
  price: ['stripePriceId', 'paypalPlanId'],
  form: ['audienceId'],
};

// Author/uploader FKs remapped to the TARGET's owner admin. A raw insert with
// the demo's admin id would violate the FK (Admin rows are not exported), and
// SetNull only fires on delete — not on a bad insert.
const REMAP_OWNER: Record<string, string[]> = {
  post: ['authorId'],
  page: ['authorId'],
  mediaAsset: ['uploadedById'],
};

// Per-visitor analytics counters reset to 0 — a fresh instance starts from zero
// impressions, not the demo's accumulated ones.
const RESET_ZERO: Record<string, string[]> = {
  popup: ['views', 'clicks', 'dismissals'],
};

// Server-managed columns stripped from every create payload: @updatedAt cannot
// be set on create, and re-supplying it errors on some Prisma versions.
const MANAGED_FIELDS = ['updatedAt'];

// Normalize one row for insertion into the target: strip managed columns, null
// scrub fields, remap author/uploader FKs to the owner admin, and zero analytics
// counters. `model` selects which rule sets apply. Returns a shallow copy.
export function normalizeRowForImport(
  model: string,
  row: PackRow,
  ownerAdminId: string | null,
): PackRow {
  const out: PackRow = { ...row };
  for (const f of MANAGED_FIELDS) delete out[f];
  for (const f of SCRUB_NULL[model] ?? []) if (f in out) out[f] = null;
  for (const f of REMAP_OWNER[model] ?? []) if (f in out) out[f] = ownerAdminId;
  for (const f of RESET_ZERO[model] ?? []) if (f in out) out[f] = 0;
  return out;
}

// Footer.config.email.audienceId points at one of the demo's own Audience rows
// (tenant state we never export). Null it in place, leaving the rest of the
// footer config — including its rewritten logo URL — intact.
export function scrubFooterAudience(config: unknown): unknown {
  if (!config || typeof config !== 'object') return config;
  const c = config as Record<string, unknown>;
  const email = c.email;
  if (email && typeof email === 'object' && 'audienceId' in email) {
    return { ...c, email: { ...(email as Record<string, unknown>), audienceId: null } };
  }
  return config;
}

// ---------- archive (de)serialization ----------

export function serializePack(pack: ContentPack): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(pack), 'utf8'));
}

export function deserializePack(gz: Buffer): ContentPack {
  let json: Buffer;
  try {
    json = zlib.gunzipSync(gz, { maxOutputLength: MAX_PACK_JSON_BYTES });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      `content pack is not valid gzip, or its contents exceed ${MAX_PACK_JSON_BYTES} bytes: ${why}`,
    );
  }
  let pack: ContentPack;
  try {
    pack = JSON.parse(json.toString('utf8'));
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`content pack payload is not valid JSON: ${why}`);
  }
  if (!pack?.manifest || pack.manifest.format !== PACK_FORMAT) {
    throw new Error(
      'not an LMS content pack (missing or unrecognized manifest.format)',
    );
  }
  if (!pack.content || !Array.isArray(pack.files)) {
    throw new Error('content pack is missing its content or files section');
  }
  return pack;
}

// ---------- file path safety ----------

// A pack file's relpath must be a plain relative path within its store — no
// absolute paths, no "..", no NUL. Returns true when safe to join onto a root.
export function isSafeRelPath(relpath: string): boolean {
  if (!relpath || relpath.includes('\0')) return false;
  if (relpath.startsWith('/') || relpath.startsWith('\\')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(relpath)) return false; // windows drive
  const parts = relpath.split(/[\\/]/);
  return !parts.some((p) => p === '..' || p === '.' || p === '');
}
