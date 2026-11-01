import { supabase } from './supabase';

// The backend only listens on the loopback interface.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

// Keep in sync with MAX_UPLOAD_MB on the backend (backend/app/config.py), which is the real limit.
export const MAX_UPLOAD_MB = 200;

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
