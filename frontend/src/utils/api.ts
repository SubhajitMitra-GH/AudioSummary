import { supabase } from './supabase';

// The backend only listens on the loopback interface.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

// Keep in sync with MAX_UPLOAD_MB on the backend (backend/app/config.py), which is the real limit.
// The online server allows less (deploy-web.sh sets NEXT_PUBLIC_MAX_UPLOAD_MB=100 for it).
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 200;

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/;

/**
 * Whether this page can talk to a Tell Me engine at all. The Mac app always can. A page served from
 * this computer (localhost dev) or one whose API is on its own server ("/api", the Wi-Fi share) can.
 * A hosted website (e.g. GitHub Pages) can't: its API base is this visitor's 127.0.0.1, which browsers
 * block or ask about, and the backend's CORS list refuses it anyway, so it goes straight to online mode.
 */
/** True when this build talks to the shared online server (website) rather than an engine on this Mac. */
export function isServerEngine(apiBase: string): boolean {
  try {
    const host = new URL(apiBase, 'http://relative.invalid').hostname;
    return host !== 'relative.invalid' && !LOOPBACK.test(host);
  } catch {
    return false;
  }
}

/** Fixed at build time: the website build points at the online server, the Mac app at 127.0.0.1. */
export const ENGINE_IS_SERVER = isServerEngine(API_BASE);
/** Where recordings are processed, for UI copy: "this Mac" or "the Tell Me server". */
export const ENGINE_PLACE = ENGINE_IS_SERVER ? 'the Tell Me server' : 'this Mac';

export function localEngineReachable(opts: { desktop: boolean; apiBase: string; pageHost: string }): boolean {
  if (opts.desktop) return true;
  let apiHost: string;
  try {
    apiHost = new URL(opts.apiBase, 'http://relative.invalid').hostname;
  } catch {
    return false;
  }
  if (apiHost === 'relative.invalid') return true; // same server as the page
  if (!LOOPBACK.test(apiHost)) return true; // a real remote API
  return LOOPBACK.test(opts.pageHost);
}

export function canReachLocalEngine(): boolean {
  if (typeof window === 'undefined') return true;
  return localEngineReachable({
    desktop: window.tellme?.isDesktop === true,
    apiBase: API_BASE,
    pageHost: window.location.hostname,
  });
}

export async function getAccessToken(): Promise<string | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

/** fetch() against the local backend with the signed-in user's token attached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

/** A local AI model the user can choose (GET /models). */
export interface ModelOption {
  id: string;
  label: string;
  description: string;
  size_gb: number;
  recommended: boolean;
  installed: boolean;
  active: boolean;
}

export interface ModelsResponse {
  active: string;
  ollama_running: boolean;
  models: ModelOption[];
}

/** The backend's error message (FastAPI `detail`), or a generic status line. */
export async function readErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
  } catch {
    // not JSON
  }
  return `Request failed (status ${res.status})`;
}

/** A transcript passage the backend used to answer a question (POST /chat `context`). */
export interface Passage {
  content: string;
  chunk_index: number;
  score: number;
}
