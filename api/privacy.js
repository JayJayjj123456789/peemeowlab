// ─────────────────────────────────────────────────────────────────────────────
// privacy.js — PDPA helpers used across the API
//
// v2 changes (security review fixes):
//   1. FAIL-CLOSED: encryptText() no longer silently stores plaintext when
//      ENCRYPTION_KEY is missing or encryption fails — a chat message is
//      either encrypted or not stored. (Callers catch the error and skip
//      persistence; the bot still replies — only storage is withheld.)
//   2. decryptText() still returns legacy plaintext rows unchanged, and now
//      understands the v2 ciphertext format via encryption.js.
//   3. hashId() is peppered (HMAC) when USER_DATA_PEPPER is set. Hash
//      lookups also try the legacy unkeyed SHA-256 via hashIdCandidates()
//      so rows hashed before the pepper was introduced keep working.
// ─────────────────────────────────────────────────────────────────────────────
import { encrypt, decrypt, anonymize } from "./encryption.js";
import { createHash } from "crypto";

let warnedNoKey = false;

/** True when AES-256-GCM is configured (ENCRYPTION_KEY present). */
export function isEncryptionEnabled() {
  return Boolean(process.env.ENCRYPTION_KEY);
}

/**
 * Encrypt text for storage. Throws when ENCRYPTION_KEY is not set — callers
 * catch and skip persistence (fail closed: never store plaintext for a
 * PDPA-regulated deployment).
 */
export function encryptText(plaintext) {
  if (plaintext == null || plaintext === "") return plaintext;
  if (!isEncryptionEnabled()) {
    if (!warnedNoKey) {
      console.warn("[privacy] ENCRYPTION_KEY not set — refusing to store text unencrypted (fail-closed). Set APP_ENCRYPTION_KEY in GitLab CI/CD.");
      warnedNoKey = true;
    }
    throw new Error("ENCRYPTION_KEY not set — storage refused (fail-closed)");
  }
  return encrypt(String(plaintext));
}

/**
 * Decrypt text read from storage. If the value is not valid AES-256-GCM
 * ciphertext (legacy plaintext row), returns it unchanged.
 */
export function decryptText(ciphertext) {
  if (ciphertext == null || ciphertext === "") return ciphertext;
  if (!isEncryptionEnabled()) return ciphertext;
  try {
    return decrypt(String(ciphertext));
  } catch {
    return ciphertext; // legacy plaintext row
  }
}

/**
 * One-way anonymization of a LINE / web User ID (peppered SHA-256 hex).
 * Use this EVERYWHERE a user id is persisted or used as a DB write key.
 */
export function hashId(rawId) {
  return anonymize(String(rawId ?? ""));
}

/**
 * All hash candidates for DB lookups: the current (peppered) hash first,
 * then the legacy unkeyed SHA-256. Read paths pass this array to
 * `= ANY($1::text[])` so pre-pepper rows keep resolving.
 */
export function hashIdCandidates(rawId) {
  const value = String(rawId ?? "");
  const current = hashId(value);
  const legacy = createHash("sha256").update(value).digest("hex");
  return current === legacy ? [current] : [current, legacy];
}

/**
 * Full lookup candidates: peppered hash + legacy hash + the raw id itself
 * (rows that predate anonymization migration 004 store raw ids).
 */
export function idLookupCandidates(rawId) {
  return [...hashIdCandidates(rawId), String(rawId ?? "")];
}
