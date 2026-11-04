import { describe, expect, it } from 'vitest';
import { describeAuthError, describeLinkExchangeError, isEmail, isRecoveryLink, parseAuthLinkError, parseDesktopAuthLink, passwordProblem, signUpOutcome, usernameProblem } from './authHelpers';

describe('isEmail', () => {
  it('treats anything with @ as an email', () => {
    expect(isEmail('me@example.com')).toBe(true);
    expect(isEmail('  subhajit ')).toBe(false);
  });
});

describe('usernameProblem', () => {
  it('accepts simple handles', () => {
    expect(usernameProblem('subhajit_m')).toBeNull();
    expect(usernameProblem('a.b9')).toBeNull();
  });
  it('rejects empty, short, spaced and @ names', () => {
    expect(usernameProblem('')).toMatch(/choose/);
    expect(usernameProblem('ab')).toMatch(/letters/);
    expect(usernameProblem('two words')).toMatch(/letters/);
    expect(usernameProblem('me@x')).toMatch(/letters/);
  });
});

describe('describeAuthError', () => {
  it('explains unconfirmed emails', () => {
    expect(describeAuthError({ message: 'Email not confirmed', code: 'email_not_confirmed' }).kind).toBe('unconfirmed');
  });
  it('explains wrong credentials and mentions confirmation', () => {
    const p = describeAuthError({ message: 'Invalid login credentials', code: 'invalid_credentials' });
    expect(p.kind).toBe('invalid');
    expect(p.message).toMatch(/confirm your email/);
  });
  it('maps a duplicate username from the database trigger', () => {
    expect(describeAuthError(new Error('Database error saving new user')).kind).toBe('taken');
  });
  it('maps network failures', () => {
    expect(describeAuthError(new TypeError('Failed to fetch')).kind).toBe('network');
  });
  it('explains the hourly email limit', () => {
    const p = describeAuthError({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' });
    expect(p.kind).toBe('rate');
    expect(p.message).toMatch(/2 emails an hour/);
  });
  it('shows the exact wait time when Supabase gives one', () => {
    expect(describeAuthError({ message: 'For security purposes, you can only request this after 37 seconds.', code: 'over_email_send_rate_limit' }).message)
      .toBe('Please wait 37 seconds before asking for another email.');
  });
  it('maps general request limits', () => {
    expect(describeAuthError({ message: 'Too many requests', code: 'over_request_rate_limit' }).message).toMatch(/Too many attempts/);
  });
});

describe('signUpOutcome', () => {
  it('detects an already-registered email (no identities)', () => {
    expect(signUpOutcome({ session: null, user: { identities: [] } })).toBe('already-registered');
  });
  it('needs confirmation when there is no session', () => {
    expect(signUpOutcome({ session: null, user: { identities: [{}] } })).toBe('confirm-email');
  });
  it('is signed in when confirmation is off', () => {
    expect(signUpOutcome({ session: {}, user: { identities: [{}] } })).toBe('signed-in');
  });
});

describe('passwordProblem', () => {
  it('requires 6+ characters and a matching confirmation', () => {
    expect(passwordProblem('abc', 'abc')).toMatch(/at least 6/);
    expect(passwordProblem('abcdef', 'abcdeg')).toMatch(/match/);
    expect(passwordProblem('abcdef', 'abcdef')).toBeNull();
  });
});

describe('password reset errors', () => {
  it('explains reusing the old password', () => {
    expect(describeAuthError({ message: 'New password should be different from the old password.', code: 'same_password' }).message).toMatch(/different/);
  });
  it('explains a wrong or expired code', () => {
    expect(describeAuthError({ message: 'Token has expired or is invalid', code: 'otp_expired' }).message).toMatch(/expired/);
  });
});

describe('email links', () => {
  it('recognises a password-reset link', () => {
    expect(isRecoveryLink('#access_token=abc&expires_in=3600&type=recovery&')).toBe(true);
    expect(isRecoveryLink('#access_token=abc&type=signup&')).toBe(false);
    expect(isRecoveryLink('&')).toBe(false);
  });
  it('explains an expired link', () => {
    expect(parseAuthLinkError('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&'))
      .toMatch(/expired or was already used/);
  });
  it('passes through other link errors readably', () => {
    expect(parseAuthLinkError('#error=server_error&error_description=Something+broke&')).toBe('Something broke');
  });
  it('ignores normal URLs', () => {
    expect(parseAuthLinkError('&')).toBeNull();
    expect(parseAuthLinkError('#tokens&?v=1')).toBeNull();
  });
});

describe('Mac app reset links (tellme://)', () => {
  const code = '3b1f6a52-8d4e-4c1a-9a0b-2f7e5d6c4b3a';
  it('reads the code Supabase sends back', () => {
    expect(parseDesktopAuthLink(`tellme://reset-password?code=${code}`)).toEqual({ kind: 'code', code });
    expect(parseDesktopAuthLink(`tellme://reset-password/?code=${code}`)).toEqual({ kind: 'code', code });
  });
  it('reports an expired or used link (error in the hash or the query)', () => {
    const viaHash = parseDesktopAuthLink('tellme://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(viaHash).toMatchObject({ kind: 'error' });
    expect(viaHash && 'message' in viaHash ? viaHash.message : '').toMatch(/expired or was already used/);
    expect(parseDesktopAuthLink('tellme://reset-password?error=access_denied&error_code=otp_expired')).toMatchObject({ kind: 'error' });
  });
  it('never shows text taken from the link itself', () => {
    const link = parseDesktopAuthLink('tellme://reset-password?error=x&error_description=Call+this+number+now');
    expect(link && 'message' in link ? link.message : '').not.toMatch(/number/);
  });
  it('ignores other links and junk', () => {
    expect(parseDesktopAuthLink(`tellme://something-else?code=${code}`)).toBeNull();
    expect(parseDesktopAuthLink(`tellme://reset-passwordX?code=${code}`)).toBeNull();
    expect(parseDesktopAuthLink(`https://evil.example/reset-password?code=${code}`)).toBeNull();
    expect(parseDesktopAuthLink(`tellme://reset-password?code=${'a'.repeat(5000)}`)).toBeNull();
    expect(parseDesktopAuthLink('tellme://reset-password?code=<script>')).toMatchObject({ kind: 'error' });
    expect(parseDesktopAuthLink('tellme://reset-password')).toMatchObject({ kind: 'error' });
  });
  it('explains why a code could not be exchanged', () => {
    expect(describeLinkExchangeError({ name: 'AuthPKCECodeVerifierMissingError', code: 'pkce_code_verifier_not_found', message: 'PKCE code verifier not found in storage.' }))
      .toMatch(/requested somewhere else/);
    expect(describeLinkExchangeError({ code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' }))
      .toMatch(/expired or was already used/);
    expect(describeLinkExchangeError({ message: 'Failed to fetch' })).toMatch(/internet|connect|reach/i);
  });
});
