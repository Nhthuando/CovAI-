import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Lấy encryption key từ env.
 * ENCRYPTION_KEY phải là chuỗi hex 64 ký tự (32 bytes).
 */
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY phải được cấu hình trong .env (64 hex chars / 32 bytes)."
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt một chuỗi plaintext.
 * @param {string} plaintext
 * @returns {string} Chuỗi encrypted dạng: iv:encrypted:authTag (hex)
 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/**
 * Decrypt một chuỗi đã encrypt.
 * @param {string} encryptedText Dạng: iv:encrypted:authTag (hex)
 * @returns {string} Plaintext
 */
export function decrypt(encryptedText) {
  const key = getKey();
  const parts = encryptedText.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format.");
  }

  const [ivHex, encrypted, authTagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
