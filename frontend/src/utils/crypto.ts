import CryptoJS from 'crypto-js';

// Secret key used for Zero-Trust Application-Layer Encryption.
// Uses an environment variable in production, fallback for development.
const ENCRYPTION_KEY = process.env.NEXT_PUBLIC_ALE_KEY || 'zero-trust-audio-ale-secret-key-998877';

export function encryptText(plaintext: string): string {
  if (!plaintext) return '';
  return CryptoJS.AES.encrypt(plaintext, ENCRYPTION_KEY).toString();
}

export function decryptText(ciphertext: string): string {
  if (!ciphertext) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted) {
       return '[Decryption Failed - Invalid Ciphertext/Key]';
    }
    return decrypted;
  } catch (e) {
    console.error('ALE decryption error:', e);
    return '[Decryption Error]';
  }
}
