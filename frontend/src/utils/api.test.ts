import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: () => getSession() } } }));

import { API_BASE, MAX_UPLOAD_MB, apiFetch, readErrorDetail } from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  getSession.mockResolvedValue({ data: { session: { access_token: 'token-123' } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: url as string, init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
}

describe('apiFetch', () => {
  it('calls the loopback backend by default', () => {
    expect(API_BASE).toBe('http://127.0.0.1:8000');
  });

  it("attaches the signed-in user's token", async () => {
    await apiFetch('/sessions');
    const { url, headers } = lastRequest();
    expect(url).toBe(`${API_BASE}/sessions`);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
  });

  it('sends no Authorization header when signed out', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await apiFetch('/sessions');
    expect(lastRequest().headers.has('Authorization')).toBe(false);
  });

  it('marks string bodies as JSON and keeps method/body', async () => {
    await apiFetch('/messages', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    const { init, headers } = lastRequest();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('leaves FormData bodies alone so the browser sets the multipart boundary', async () => {
    await apiFetch('/upload', { method: 'POST', body: new FormData() });
    expect(lastRequest().headers.has('Content-Type')).toBe(false);
  });

  it('keeps headers passed by the caller', async () => {
    await apiFetch('/x', { headers: { 'X-Custom': '1' } });
    expect(lastRequest().headers.get('X-Custom')).toBe('1');
  });
});

describe('readErrorDetail', () => {
  it("returns FastAPI's detail message", async () => {
    const res = new Response(JSON.stringify({ detail: 'Access denied to session.' }), { status: 403 });
    expect(await readErrorDetail(res)).toBe('Access denied to session.');
  });

  it('falls back to the status for non-JSON responses', async () => {
    expect(await readErrorDetail(new Response('<html>', { status: 502 }))).toBe('Request failed (status 502)');
  });

  it('falls back when detail is not a string (validation errors)', async () => {
    const res = new Response(JSON.stringify({ detail: [{ msg: 'field required' }] }), { status: 422 });
    expect(await readErrorDetail(res)).toBe('Request failed (status 422)');
  });
});

describe('upload limit', () => {
  it('matches the backend default in backend/app/config.py', () => {
    const config = readFileSync(resolve(__dirname, '../../../backend/app/config.py'), 'utf8');
    const match = config.match(/max_upload_mb:\s*int\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(MAX_UPLOAD_MB);
  });
});
