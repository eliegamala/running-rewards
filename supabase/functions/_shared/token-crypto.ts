/**
 * AES-256-GCM encryption for Strava tokens at rest. Uses WebCrypto only.
 * Format: "v1.<base64 iv>.<base64 ciphertext+tag>". The key is a 32-byte base64 secret
 * (STRAVA_TOKEN_ENCRYPTION_KEY) that never leaves the Edge Function environment.
 */

const VERSION = 'v1';

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type TokenCipher = {
  encrypt(plaintext: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
};

export async function createTokenCipher(base64Key: string): Promise<TokenCipher> {
  const raw = fromBase64(base64Key.trim());
  if (raw.length !== 32) {
    throw new Error('STRAVA_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  }
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  return {
    async encrypt(plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(plaintext),
      );
      return `${VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
    },
    async decrypt(payload) {
      const [version, iv, data] = payload.split('.');
      if (version !== VERSION || !iv || !data) throw new Error('Unrecognised token format.');
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(iv) },
        key,
        fromBase64(data),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}
