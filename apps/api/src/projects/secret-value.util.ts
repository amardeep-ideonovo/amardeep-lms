import { decryptSecret, encryptSecret } from "../common/crypto.util";

// At-rest sealing for SECRET-typed Projects custom-field values.
//
// These live inside the shared ChatListItem.values JSON map alongside every
// other field type, so — unlike LiveSession.joinUrlEnc — we cannot mark them
// "encrypted" with a column name. The value has to identify itself, hence the
// envelope prefix below.
//
// Why a prefix and not "just try to decrypt": crypto.util's stored form is a
// bare `iv:tag:ciphertext`, which has no marker. A legacy plaintext secret that
// happens to contain two colons (`user:pass:note`, an IPv6 address, an ssh URL)
// passes that shape check and then fails at the GCM auth tag — indistinguishable
// from a wrong key. The prefix makes "is this sealed?" a total, cheap, and
// exact question, which is what lets the backfill be re-runnable without ever
// double-encrypting, and lets reads tolerate a partially-migrated store.
//
// The plaintext branch in openSecretValue() is PERMANENT, not a migration shim:
// updateField can flip a TEXT column to SECRET at any time without rewriting
// stored values, so fresh plaintext can appear under a SECRET field forever.
// Never treat an unsealed value as corrupt — that would destroy real secrets.
export const ENC_PREFIX = "enc:v1:";

// Cap on a stored secret. Sealing inflates the value (base64 ~4/3, plus IV +
// auth tag + envelope ≈ 45 bytes), and an uncapped credential field is an easy
// way to bloat a JSON column.
export const SECRET_MAX_LENGTH = 4096;

/** True when a stored value carries our envelope (i.e. we encrypted it). */
export function isSealed(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a secret for storage. Round-trips before returning: we never persist
 * a value we cannot read back (a wrong-length key, say, would otherwise write
 * bytes that decrypt to nothing and silently strand the credential).
 */
export function sealSecretValue(plaintext: string): string {
  const sealed = ENC_PREFIX + encryptSecret(plaintext);
  if (openSecretValue(sealed) !== plaintext) {
    throw new Error(
      "Secret failed its encrypt/decrypt round-trip; refusing to store it",
    );
  }
  return sealed;
}

/**
 * Read a stored secret back to plaintext.
 *
 * - sealed  -> decrypted (THROWS if the key is missing/wrong/the blob is torn)
 * - legacy plaintext -> returned unchanged (see the permanence note above)
 * - absent / non-string / '' -> null
 *
 * Deliberately throws rather than returning null on a decrypt failure. Callers
 * must surface that as an error: reporting a recoverable-but-undecryptable
 * credential as "not set" invites an overwrite that destroys the only copy.
 */
export function openSecretValue(stored: unknown): string | null {
  if (typeof stored !== "string" || stored === "") return null;
  if (!isSealed(stored)) return stored;
  return decryptSecret(stored.slice(ENC_PREFIX.length));
}
