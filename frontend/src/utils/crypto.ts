import CryptoJS from 'crypto-js';

// Encrypts session titles and chat messages before they are stored and backed up.
//
// IMPORTANT: NEXT_PUBLIC_* values are compiled into the app bundle, and this key is the same for
// every user. It protects data from someone who only obtains the database, NOT from someone who
// has the app. Per-user keys are needed for real end-to-end privacy.
// Changing this key makes all previously encrypted titles and messages unreadable.
const FALLBACK_KEY = 'zero-trust-audio-ale-secret-key-998877';
const ENCRYPTION_KEY = process.env.NEXT_PUBLIC_ALE_KEY || FALLBACK_KEY;

if (ENCRYPTION_KEY === FALLBACK_KEY && typeof window !== 'undefined') {
  console.warn('NEXT_PUBLIC_ALE_KEY is not set: using the public built-in encryption key.');
}

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
