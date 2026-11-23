import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;
const ENCRYPTED_FORMAT_RE = /^[0-9a-fA-F]{32}:[0-9a-fA-F]*:[0-9a-fA-F]{32}$/;

/**
 * Get encryption key from env.
 * ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
 */
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !HEX_KEY_RE.test(key)) {
    throw new Error(
      "ENCRYPTION_KEY must be configured in .env (64 hex chars / 32 bytes)."
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Check whether a stored string matches the AES-256-GCM iv:ciphertext:authTag hex format.
 * @param {string} value
 * @returns {boolean}
 */
export function isEncryptedFormat(value) {
  return typeof value === "string" && ENCRYPTED_FORMAT_RE.test(value);
}

/**
 * Encrypt plaintext string.
 * @param {string} plaintext
 * @returns {string} Encrypted string: iv:encrypted:authTag (hex)
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Plaintext must be a non-empty string.");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/**
 * Decrypt encrypted string.
 * @param {string} encryptedText Format: iv:encrypted:authTag (hex)
 * @returns {string} Plaintext
 */
export function decrypt(encryptedText) {
  const key = getKey();
  if (!isEncryptedFormat(encryptedText)) {
    throw new Error("Invalid encrypted text format.");
  }

  const [ivHex, encrypted, authTagHex] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
