import { describe, expect, it } from 'vitest';
import { decryptText, encryptText } from './crypto';

describe('encryptText / decryptText', () => {
  it('round-trips text, including unicode and newlines', () => {
    const text = 'Meeting at 5pm — café ☕\nline two';
    const cipher = encryptText(text);
    expect(cipher).not.toBe(text);
    expect(cipher).not.toContain('Meeting');
    expect(decryptText(cipher)).toBe(text);
  });

  it('produces different ciphertext each time (random salt)', () => {
    expect(encryptText('same')).not.toBe(encryptText('same'));
  });

  it('returns empty strings unchanged', () => {
    expect(encryptText('')).toBe('');
    expect(decryptText('')).toBe('');
  });

  it('returns a marker instead of throwing for invalid ciphertext', () => {
    expect(decryptText('not-real-ciphertext')).toMatch(/^\[Decryption/);
  });
});
