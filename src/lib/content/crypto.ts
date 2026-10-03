import crypto from "crypto";
import { getEnv } from "../env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Encrypts a buffer using AES-256-GCM.
 * The 12-byte IV is prepended to the output, and the 16-byte auth tag is appended.
 * Format: [IV (12 bytes)][Ciphertext][Auth Tag (16 bytes)]
 */
export function encryptBuffer(data: Buffer | string): Buffer {
  const keyBase64 = getEnv().CONTENT_ENCRYPTION_KEY;
  if (!keyBase64) throw new Error("CONTENT_ENCRYPTION_KEY not set");
  
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, authTag]);
}

/**
 * Decrypts a buffer encrypted by `encryptBuffer`.
 */
export function decryptBuffer(data: Buffer): string {
  const keyBase64 = getEnv().CONTENT_ENCRYPTION_KEY;
  if (!keyBase64) throw new Error("CONTENT_ENCRYPTION_KEY not set");

  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(IV_LENGTH, data.length - 16);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
