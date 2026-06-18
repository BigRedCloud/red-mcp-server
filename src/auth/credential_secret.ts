import {
  decryptCredentialSecret,
  encodeCredentialSecretForMemory,
  decodeCredentialSecretFromMemory,
  encryptCredentialSecret,
} from "./credential_encryption.js";

/** Encodes an API key for storage (encrypt when configured, else dev memory encoding). */
export function encodeStoredApiKey(apiKey: string): string {
  const encryptionKey = process.env.RED_CONNECT_ENCRYPTION_KEY?.trim();
  if (encryptionKey) {
    return `enc:${encryptCredentialSecret(apiKey)}`;
  }

  return encodeCredentialSecretForMemory(apiKey);
}

/** Decodes a stored API key value. Never log the result. */
export function decodeStoredApiKey(stored: string): string {
  if (stored.startsWith("mem:")) {
    return decodeCredentialSecretFromMemory(stored);
  }

  if (stored.startsWith("enc:")) {
    return decryptCredentialSecret(stored.slice(4));
  }

  throw new Error("Stored credential secret is not in a recognised format.");
}
