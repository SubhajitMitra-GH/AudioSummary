import { createClient } from '@supabase/supabase-js';
import { describeLinkExchangeError, isRecoveryLink, parseAuthLinkError, parseDesktopAuthLink } from './authHelpers';
import { isDesktopApp } from './platform';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

/** False when frontend/.env.local is missing the Supabase settings, so sign-in cannot work. */
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// The Mac app uses PKCE: a reset link comes back as tellme://reset-password?code=…, and the code only
// works together with the verifier this app stored when it asked for the email (so a link grabbed by
// another app is useless). The website keeps the default implicit flow (tokens in the URL hash).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { flowType: isDesktopApp() ? 'pkce' : 'implicit' },
});

export interface Session {
  id: string; // UUIDv4
  session_title: string; // Ciphertext (AES encrypted)
  created_at: string;
  synced?: boolean;
}

export interface ChatMessage {
  id: string;
  session_id: string; // UUIDv4
  sender: 'user' | 'assistant';
  message_text: string; // Ciphertext (AES encrypted)
  created_at: string;
  synced?: boolean;
}

/* ── Password recovery ─────────────────────────────────────────────────────
   A reset link from the "forgot password" email opens the app with a recovery
   session in the URL. supabase-js reads (and clears) the URL as soon as the client
   is created, so the signal is captured here, at import time, not in a component. */

type RecoveryListener = () => void;
const recoveryListeners = new Set<RecoveryListener>();
const urlFragment = typeof window !== 'undefined' ? `${window.location.hash}&${window.location.search}` : '';
let recoveryPending = isRecoveryLink(urlFragment);

/** Error from an auth email link (e.g. an expired or already-used reset link), shown on the sign-in card.
    `seq` changes on every new problem, so the same message arriving twice still shows again. */
export interface AuthLinkProblem { message: string; seq: number }
let linkSeq = 0;
const initialLinkError = parseAuthLinkError(urlFragment);
let linkError: AuthLinkProblem | null = initialLinkError ? { message: initialLinkError, seq: ++linkSeq } : null;
const linkErrorListeners = new Set<() => void>();
export function setAuthLinkError(message: string | null) {
  linkError = message ? { message, seq: ++linkSeq } : null;
  linkErrorListeners.forEach((l) => l());
}
export function subscribeAuthLinkError(listener: () => void) {
  linkErrorListeners.add(listener);
  return () => linkErrorListeners.delete(listener);
}
export const getAuthLinkError = () => linkError;
export const getAuthLinkErrorServer = (): AuthLinkProblem | null => null;

supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
});

export function setPasswordRecovery(pending: boolean) {
  recoveryPending = pending;
  recoveryListeners.forEach((l) => l());
}

/** For useSyncExternalStore: is the user in the middle of setting a new password? */
export function subscribePasswordRecovery(listener: RecoveryListener) {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}
export const getPasswordRecovery = () => recoveryPending;
export const getPasswordRecoveryServer = () => false;

/* ── Mac app: reset links arrive as tellme://reset-password?code=… ────────────
   electron.js receives the link from macOS (open-url), keeps it, and pings the page;
   the page takes it (also once at startup, for a link that launched the app). */

async function handleDesktopAuthLink(url: string) {
  const link = parseDesktopAuthLink(url);
  if (!link) return;
  if (link.kind === 'error') {
    setAuthLinkError(link.message);
    return;
  }
  const { error } = await supabase.auth.exchangeCodeForSession(link.code);
  if (error) {
    setAuthLinkError(describeLinkExchangeError(error));
    return;
  }
  setAuthLinkError(null);
  setPasswordRecovery(true); // page.tsx shows "Choose a new password"
}

if (typeof window !== 'undefined' && window.tellme?.takeAuthLink) {
  const bridge = window.tellme;
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      for (let url = await bridge.takeAuthLink!(); url; url = await bridge.takeAuthLink!()) {
        await handleDesktopAuthLink(url);
      }
    } catch {
      setAuthLinkError('Couldn’t open that reset link. Request a new one.');
    } finally {
      draining = false;
    }
  };
  bridge.onAuthLink?.(() => void drain());
  void drain();
}
