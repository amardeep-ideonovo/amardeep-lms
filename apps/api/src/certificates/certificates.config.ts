import * as crypto from 'crypto';
import * as fs from 'fs';
import type { CertificateFontId } from '@lms/types';
import { resolveStorageDir } from '../storage/storage-dirs';

// ---------- Class-completion certificates: storage + serials ----------

// Rendered certificate PDFs. Deliberately NOT statically served — downloads
// stream through an access-checked route (owner or admin), like lesson notes.
// CERT_FILES_DIR must point at a persistent volume in production; storage-dirs.ts
// owns that rule and refuses to boot without it.
export const CERT_FILES_DIR = resolveStorageDir('CERT_FILES_DIR');

// Bundled OFL TTFs (see fonts/OFL.txt). Served PUBLICLY at /cert-fonts so the
// admin template editor can @font-face the exact bytes the PDF embeds. These
// ship inside the image rather than on the volume, so CERT_FONTS_DIR is pinned
// in apps/api/Dockerfile — the cwd fallback misses them entirely under Docker.
export const CERT_FONTS_DIR = resolveStorageDir('CERT_FONTS_DIR');
export const CERT_FONTS_ROUTE = '/cert-fonts';

export function ensureCertificateDirs(): void {
  fs.mkdirSync(CERT_FILES_DIR, { recursive: true });
}

// Runtime copy of CERTIFICATE_FONTS from @lms/types (the API consumes that
// package as TYPES ONLY — its raw .ts can't be require()d at runtime). The id
// set is locked together by the CertificateFontId key type; if the files ever
// change, update both places.
export const CERT_FONT_FILES: Record<CertificateFontId, string> = {
  playfair: 'PlayfairDisplay-Regular.ttf',
  greatvibes: 'GreatVibes-Regular.ttf',
  inter: 'Inter-Regular.ttf',
  ebgaramond: 'EBGaramond-Regular.ttf',
};
export const CERT_FONT_IDS = Object.keys(CERT_FONT_FILES) as CertificateFontId[];

// Human-readable certificate serial, e.g. CERT-2026-7KQ2MX. The alphabet drops
// lookalikes (0/O, 1/I/L, U/V) so serials survive being read aloud or retyped.
const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export function newSerial(now = new Date()): string {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += SERIAL_ALPHABET[bytes[i] % SERIAL_ALPHABET.length];
  return `CERT-${now.getFullYear()}-${code}`;
}
