import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM at-rest encryption for integration secrets (Stripe / Mailchimp).
// Key comes from SETTINGS_ENC_KEY (32-byte base64). Ciphertext is stored as a
// single colon-delimited string: iv:authTag:ciphertext (all base64).

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENC_KEY;
  if (!raw) {
    throw new Error('SETTINGS_ENC_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SETTINGS_ENC_KEY must decode to 32 bytes (base64-encoded)');
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// Mask a secret for read-back to the admin UI — never expose plaintext.
export function maskSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const last4 = plaintext.slice(-4);
  return `••••••••${last4}`;
}
