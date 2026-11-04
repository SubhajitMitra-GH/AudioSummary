import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses crypto.randomUUID when the page is secure', () => {
    expect(newId()).toMatch(V4);
  });
  it('still makes v4 UUIDs on plain http (no crypto.randomUUID)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    ids.forEach((id) => expect(id).toMatch(V4));
  });
});
