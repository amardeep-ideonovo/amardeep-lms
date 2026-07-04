import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CertificateFontId } from '@lms/types';

// ---------- Class-completion certificates: storage + serials ----------

// Rendered certificate PDFs. Deliberately NOT statically served — downloads
// stream through an access-checked route (owner or admin), like lesson notes.
// On ephemeral hosts point CERT_FILES_DIR at a persistent disk.
export const CERT_FILES_DIR =
  process.env.CERT_FILES_DIR ||
  path.resolve(process.cwd(), 'src', 'files', 'certificates');

// Bundled OFL TTFs (see fonts/OFL.txt). Served PUBLICLY at /cert-fonts so the
// admin template editor can @font-face the exact bytes the PDF embeds.
export const CERT_FONTS_DIR =
  process.env.CERT_FONTS_DIR ||
  path.resolve(process.cwd(), 'src', 'certificates', 'fonts');
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
