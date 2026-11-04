import { describe, expect, it } from 'vitest';
import { detectPlatform } from './platform';
import { localEngineReachable } from './api';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it('recognises a Mac', () => expect(detectPlatform(UA.mac)).toBe('mac'));
  it('recognises Windows', () => expect(detectPlatform(UA.windows)).toBe('windows'));
  it('treats phones as mobile, even though iOS says "like Mac OS X"', () => {
    expect(detectPlatform(UA.iphone)).toBe('mobile');
    expect(detectPlatform(UA.android)).toBe('mobile');
  });
  it('treats an iPad (which reports a Mac) as mobile', () => expect(detectPlatform(UA.mac, 5)).toBe('mobile'));
  it('falls back to other', () => expect(detectPlatform(UA.linux)).toBe('other'));
});

describe('localEngineReachable', () => {
  const loopback = 'http://127.0.0.1:8000';
  it('is always true in the Mac app', () => {
    expect(localEngineReachable({ desktop: true, apiBase: loopback, pageHost: 'index.html' })).toBe(true);
  });
  it('is true for localhost development', () => {
    expect(localEngineReachable({ desktop: false, apiBase: loopback, pageHost: 'localhost' })).toBe(true);
    expect(localEngineReachable({ desktop: false, apiBase: loopback, pageHost: '127.0.0.1' })).toBe(true);
  });
  it('is false for the hosted website, so it never probes the visitor\'s computer', () => {
    expect(localEngineReachable({ desktop: false, apiBase: loopback, pageHost: 'subhajitmitra-gh.github.io' })).toBe(false);
  });
  it('is true when the API is on the page\'s own server (Wi-Fi share)', () => {
    expect(localEngineReachable({ desktop: false, apiBase: '/api', pageHost: '192.168.1.54' })).toBe(true);
  });
});

describe('isServerEngine', async () => {
  const { isServerEngine } = await import('./api');
  it('treats the Hugging Face URL as the online server', () => expect(isServerEngine('https://someone-tell-me.hf.space')).toBe(true));
  it('treats loopback and same-server APIs as local', () => {
    expect(isServerEngine('http://127.0.0.1:8000')).toBe(false);
    expect(isServerEngine('/api')).toBe(false);
  });
});
