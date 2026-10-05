// ─────────────────────────────────────────────────────────────────────────────
// encryption.js — AES-256-GCM encryption for PDPA compliance
//
// v2 changes (security review fixes):
//   • Key derived with scrypt (N=2^15) instead of a single SHA-256 — brute-
//     forcing the key material is no longer cheap.
//   • The per-record salt is now actually USED in key derivation (per-record
//     keys), instead of being dead weight in the output format.
//   • Legacy format (salt unused, single SHA-256 key) still decrypts: try the
//     v2 layout first, fall back to legacy when GCM auth fails.
//   • anonymize() is now an HMAC with a server pepper, not bare SHA-256 —
//     LINE user ids have a tiny search space (U + 32 hex) and were trivially
//     brute-forceable. The pepper makes the hash non-invertible.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
  scryptSync,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

// Key caches — scrypt is deliberately slow, so derive once per salt.
const v2KeyCache = new Map(); // saltHex -> Buffer
let legacyKey = null;

function getSecret() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY environment variable not set");
  }
  return secret;
}

/** v2: per-record key = scrypt(ENCRYPTION_KEY, salt). */
function getV2Key(salt) {
  const saltHex = salt.toString("hex");
  let key = v2KeyCache.get(saltHex);
  if (!key) {
    key = scryptSync(getSecret(), salt, 32, SCRYPT_PARAMS);
    if (v2KeyCache.size > 256) v2KeyCache.clear(); // bound memory
    v2KeyCache.set(saltHex, key);
  }
  return key;
}

/** Legacy: single SHA-256 of the secret (rows written before v2). */
function getLegacyKey() {
  if (!legacyKey) {
    legacyKey = createHash("sha256").update(getSecret()).digest();
  }
  return legacyKey;
}

/**
 * Encrypt plaintext using AES-256-GCM with a per-record derived key.
 * @param {string} plaintext
 * @returns {string} Base64-encoded: salt(32) + iv(16) + authTag(16) + ciphertext
 */
export function encrypt(plaintext) {
  if (!plaintext) return null;

  const salt = randomBytes(SALT_LENGTH);
  const key = getV2Key(salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  // Format v2: salt | iv | authTag | ciphertext (salt-first marks the new layout)
  const combined = Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, "base64")]);

  return combined.toString("base64");
}

/**
 * Decrypt ciphertext — auto-detects v2 (salt-first) and legacy (iv-first).
 * @param {string} ciphertext Base64-encoded encrypted data
 * @returns {string} Decrypted plaintext
 */
export function decrypt(ciphertext) {
  if (!ciphertext) return null;

  const combined = Buffer.from(ciphertext, "base64");
  const headerLen = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;

  if (combined.length <= headerLen) {
    throw new Error("Ciphertext too short");
  }

  // Legacy rows start with iv(16); v2 rows start with salt(32). Try v2 first;
  // if GCM auth fails, retry as legacy. Plaintext rows are handled upstream
  // by privacy.js (it only calls decrypt() when encryption is enabled).
  try {
    return decryptV2(combined);
  } catch {
    return decryptLegacy(combined);
  }
}

function decryptV2(combined) {
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getV2Key(salt), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, null, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function decryptLegacy(combined) {
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH + SALT_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getLegacyKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, null, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * One-way anonymization of a LINE / web user id.
 *
 * v2: HMAC-SHA256 with USER_DATA_PEPPER. The pepper changes the hash value —
 * callers that look up by hash must go through hashId() in privacy.js, which
 * handles legacy matching.
 */
export function anonymize(data) {
  const pepper = process.env.USER_DATA_PEPPER || process.env.APP_USER_DATA_PEPPER;
  const value = String(data ?? "");
  if (pepper) {
    return createHmac("sha256", pepper).update(value).digest("hex");
  }
  // No pepper configured: legacy behaviour (unkeyed SHA-256).
  return createHash("sha256").update(value).digest("hex");
}
