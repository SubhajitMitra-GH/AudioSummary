/**
 * Sign-in / sign-up helpers: tell emails from usernames, validate usernames,
 * and turn Supabase Auth responses into messages a person can act on.
 */

export const USERNAME_RULE = '3–30 letters, numbers, dots or underscores';
const USERNAME_RE = /^[A-Za-z0-9_.]{3,30}$/;

/** An identifier with an @ is treated as an email; anything else as a username. */
export function isEmail(identifier: string): boolean {
  return identifier.trim().includes('@');
}

/** Returns a problem description, or null when the username is acceptable. */
export function usernameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Please choose a username.';
  if (!USERNAME_RE.test(n)) return `Usernames use ${USERNAME_RULE}.`;
  return null;
}

export type AuthErrorKind = 'network' | 'unconfirmed' | 'invalid' | 'taken' | 'rate' | 'weak' | 'other';

export interface AuthProblem {
  kind: AuthErrorKind;
  message: string;
}

/** Map a Supabase Auth (or network) error to a kind + friendly message. */
export function describeAuthError(err: unknown): AuthProblem {
  const message = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : '';
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';

  if (err instanceof TypeError || /failed to fetch|network/i.test(message)) {
    return { kind: 'network', message: "Can't reach the sign-in service. Check your internet connection and try again." };
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return { kind: 'unconfirmed', message: 'Your email isn’t confirmed yet. Open the confirmation link we emailed you, then sign in.' };
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return {
      kind: 'invalid',
      message: 'That email/username and password don’t match. If you just signed up, confirm your email first.',
    };
  }
  if (code === 'user_already_exists' || /already registered|already exists/i.test(message)) {
    return { kind: 'taken', message: 'An account with this email already exists. Sign in instead.' };
  }
  if (/database error saving new user|duplicate key|profiles_username/i.test(message)) {
    return { kind: 'taken', message: 'That username is taken. Please choose another one.' };
  }
  const waitSeconds = message.match(/after (\d+) seconds?/i);
  if (waitSeconds) {
    return { kind: 'rate', message: `Please wait ${waitSeconds[1]} seconds before asking for another email.` };
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(message)) {
    return {
      kind: 'rate',
      message: 'The email limit has been reached: Supabase’s free email service only sends about 2 emails an hour. Try again later (or set up custom SMTP in Supabase to lift the limit).',
    };
  }
  if (code === 'over_request_rate_limit' || /rate limit|too many/i.test(message)) {
    return { kind: 'rate', message: 'Too many attempts. Wait a minute and try again.' };
  }
  if (code === 'same_password' || /different from the old password/i.test(message)) {
    return { kind: 'weak', message: 'Choose a password that’s different from your old one.' };
  }
  if (code === 'otp_expired' || /token has expired|otp.*(expired|invalid)|invalid.*token/i.test(message)) {
    return { kind: 'invalid', message: 'That code is wrong or has expired. Request a new reset email.' };
  }
  if (code === 'weak_password' || /password should be/i.test(message)) {
    return { kind: 'weak', message: message || 'Please choose a stronger password.' };
  }
  return { kind: 'other', message: message || 'Something went wrong while signing in.' };
}

export const MIN_PASSWORD = 6; // Supabase default minimum

/** Returns a problem with a new password (and its confirmation), or null. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== confirm) return 'The two passwords don’t match.';
  return null;
}

/** What happened after supabase.auth.signUp succeeded without an error. */
export type SignUpOutcome = 'signed-in' | 'confirm-email' | 'already-registered';

export function signUpOutcome(data: { session: unknown; user: { identities?: unknown[] | null } | null }): SignUpOutcome {
  // Supabase hides whether an email exists: for an existing account it returns a user with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return 'already-registered';
  if (data.session) return 'signed-in';
  return 'confirm-email';
}

/** Did the app open from a password-reset link? (`type=recovery` in the URL hash or query.) */
export function isRecoveryLink(fragment: string): boolean {
  return /(^|[#?&])type=recovery(&|$)/.test(fragment);
}

const EXPIRED_LINK =
  'That reset link has expired or was already used. Request a new one (only the newest email works: each new email cancels the older links).';

/** A friendly message when the app opened from an auth email link that failed (expired, used, invalid). */
export function parseAuthLinkError(fragment: string): string | null {
  if (!/(^|[#?&])(error|error_code)=/.test(fragment)) return null;
  const params = new URLSearchParams(fragment.replace(/^[#?&]+/, '').replace(/[#?]/g, '&'));
  if (params.get('error_code') === 'otp_expired') return EXPIRED_LINK;
  return params.get('error_description') || 'That email link could not be used. Request a new one.';
}

/* ── Mac app reset links ───────────────────────────────────────────────────
   The Mac app asks Supabase to send the reset link back to tellme://reset-password.
   Supabase checks the emailed token, then the browser hands tellme://reset-password?code=…
   to the app (registered for the tellme:// scheme in package.json → build.protocols).
   The code is useless without the PKCE verifier saved in the app when it asked for the email. */

export const DESKTOP_RESET_REDIRECT = 'tellme://reset-password';

export type DesktopAuthLink =
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string };

/** Read a tellme:// link from the OS. Anything that isn't a reset link is ignored (null). */
export function parseDesktopAuthLink(url: string): DesktopAuthLink | null {
  if (typeof url !== 'string' || url.length > 4096 || !url.startsWith(`${DESKTOP_RESET_REDIRECT}`)) return null;
  const rest = url.slice(DESKTOP_RESET_REDIRECT.length);
  if (rest && !/^[/]?[?#]/.test(rest)) return null; // e.g. tellme://reset-passwordX
  const hashAt = rest.indexOf('#');
  const query = (hashAt === -1 ? rest : rest.slice(0, hashAt)).replace(/^[/]?[?]?/, '');
  const hash = hashAt === -1 ? '' : rest.slice(hashAt + 1);
  const params = new URLSearchParams(`${query}&${hash}`);
  if (params.get('error') || params.get('error_code')) {
    // Fixed wording: any website can open a tellme:// link, so never show text taken from it.
    return { kind: 'error', message: params.get('error_code') === 'otp_expired' ? EXPIRED_LINK : 'That reset link could not be used. Request a new one.' };
  }
  const code = params.get('code');
  if (code && /^[A-Za-z0-9-]{8,128}$/.test(code)) return { kind: 'code', code };
  return { kind: 'error', message: 'That reset link is incomplete. Request a new one.' };
}

/** Why exchanging a reset link's code for a session failed, in plain words. */
export function describeLinkExchangeError(err: { message?: string; code?: string; name?: string } | null | undefined): string {
  const code = err?.code ?? '';
  const message = err?.message ?? '';
  if (code === 'pkce_code_verifier_not_found' || err?.name === 'AuthPKCECodeVerifierMissingError' || /code verifier/i.test(message)) {
    return 'This reset link was requested somewhere else (another app or browser). Click “Forgot password” here in the Mac app and use the link from that new email.';
  }
  if (/flow.?state|expired|invalid/i.test(`${code} ${message}`)) return EXPIRED_LINK;
  return describeAuthError({ message, code }).message;
}
