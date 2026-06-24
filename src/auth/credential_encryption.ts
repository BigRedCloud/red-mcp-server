import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function resolveEncryptionKey(): Buffer {
  const fromEnv =
    process.env.RED_CONNECT_ENCRYPTION_KEY?.trim() ||
    process.env.RED_CONNECT_COSMOS_CONNECTION_STRING?.trim();

  if (!fromEnv) {
    throw new Error(
      "RED_CONNECT_ENCRYPTION_KEY is required when using encrypted persistent connection storage."
    );
  }

  return createHash("sha256").update(fromEnv, "utf8").digest();
}

export function encryptCredentialSecret(plaintext: string): string {
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(".");
}

export function decryptCredentialSecret(ciphertext: string): string {
  const key = resolveEncryptionKey();
  const [ivB64, encryptedB64, authTagB64] = ciphertext.split(".");

  if (!ivB64 || !encryptedB64 || !authTagB64) {
    throw new Error("Stored credential secret is not in a valid encrypted format.");
  }

  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

/** Dev-only memory store encoding when no encryption key is configured. */
export function encodeCredentialSecretForMemory(plaintext: string): string {
  return `mem:${Buffer.from(plaintext, "utf8").toString("base64")}`;
}

export function decodeCredentialSecretFromMemory(encoded: string): string {
  if (!encoded.startsWith("mem:")) {
    throw new Error("Stored credential secret is not in a valid memory encoding.");
  }

  return Buffer.from(encoded.slice(4), "base64").toString("utf8");
}
