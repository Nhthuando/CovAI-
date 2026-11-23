import { jest } from "@jest/globals";
import { encrypt, decrypt, isEncryptedFormat } from "../utils/crypto.js";

describe("Crypto Utility (AES-256-GCM Fail-Closed)", () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });

  it("TC_LOG_25: encrypts and decrypts GitHub tokens using AES-256-GCM iv:ciphertext:authTag format", () => {
    const rawToken = "gho_superSecretToken_123456";
    const encrypted = encrypt(rawToken);

    expect(encrypted).not.toBe(rawToken);
    expect(isEncryptedFormat(encrypted)).toBe(true);
    expect(encrypted.split(":")).toHaveLength(3);
    expect(decrypt(encrypted)).toBe(rawToken);
  });

  it("rejects missing, short, or non-hex ENCRYPTION_KEY (fail-closed)", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("gho_123")).toThrow(/ENCRYPTION_KEY/);

    process.env.ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encrypt("gho_123")).toThrow(/ENCRYPTION_KEY/);

    process.env.ENCRYPTION_KEY = "abcd";
    expect(() => encrypt("gho_123")).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects tampered ciphertext or auth tag on decrypt", () => {
    const encrypted = encrypt("gho_valid");
    const [iv, cipher, tag] = encrypted.split(":");
    const flippedChar = cipher[0] === "0" ? "1" : "0";
    const tampered = `${iv}:${flippedChar}${cipher.slice(1)}:${tag}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
