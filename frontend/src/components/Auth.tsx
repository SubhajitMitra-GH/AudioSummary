'use client';

import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../utils/supabase';
import { Loader2, ArrowRight, MailCheck, ArrowLeft } from 'lucide-react';
import { Wordmark } from './ui/Brand';
import { describeAuthError, DESKTOP_RESET_REDIRECT, isEmail, signUpOutcome, usernameProblem, USERNAME_RULE } from '../utils/authHelpers';
import { BASE_PATH, isDesktopApp } from '../utils/platform';

const NOT_CONFIGURED_MESSAGE =
  'Sign-in is not set up: add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to frontend/.env.local, then restart the app.';

const USERNAME_LOGIN_MISSING =
  'Signing in with a username isn’t set up on the server yet (run supabase/username_login.sql). Use your email for now.';

/** PostgREST "function not found" (the SQL in supabase/username_login.sql hasn't been run). */
const isMissingFunction = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === 'PGRST202' || /could not find the function/i.test(err.message ?? ''));

export default function Auth({ initialError = null }: { initialError?: string | null }) {
  const [identifier, setIdentifier] = useState(''); // sign-in: email or username
  const [email, setEmail] = useState(''); // sign-up
  const [username, setUsername] = useState(''); // sign-up
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialError);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Email to offer "resend confirmation" for (set when sign-in says the email isn't confirmed, or after sign-up).
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  // Forgot password
  const [forgot, setForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const resetMessages = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setPendingEmail(null);
    setResendState('idle');
  };

  /** Resolve a username to its account email; the server only answers when the password matches. */
  const emailForUsername = async (name: string, pw: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('email_for_login', { identifier: name.trim(), password: pw });
    if (error) {
      if (isMissingFunction(error)) throw new Error(USERNAME_LOGIN_MISSING);
      throw error;
    }
    return typeof data === 'string' && data ? data : null;
  };

  const signIn = async () => {
    const id = identifier.trim();
    let loginEmail = id;
    if (!isEmail(id)) {
      const resolved = await emailForUsername(id, password);
      if (!resolved) {
        setErrorMsg('That email/username and password don’t match.');
        return;
      }
      loginEmail = resolved;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error) {
      const problem = describeAuthError(error);
      if (problem.kind === 'unconfirmed') setPendingEmail(loginEmail);
      setErrorMsg(problem.message);
    }
    // On success, the auth listener in page.tsx opens the app.
  };

  const signUp = async () => {
    const problem = usernameProblem(username);
    if (problem) {
      setErrorMsg(problem);
      return;
    }
    // Friendly early check; the database's unique index is the real guarantee.
    const { data: available, error: checkError } = await supabase.rpc('username_available', { name: username.trim() });
    if (!checkError && available === false) {
      setErrorMsg('That username is taken. Please choose another one.');
      return;
    }

    const cleanEmail = email.trim();
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { username: username.trim() } },
    });
    if (error) throw error;

    const outcome = signUpOutcome(data);
    if (outcome === 'already-registered') {
      setErrorMsg('An account with this email already exists. Sign in with your existing password instead.');
      setIsSignUp(false);
      setIdentifier(cleanEmail);
      setPassword('');
      return;
    }
    if (outcome === 'confirm-email') {
      setSuccessMsg(`Almost done: we sent a confirmation link to ${cleanEmail}. Open it, then sign in here with your email or username.`);
      setPendingEmail(cleanEmail);
      setIsSignUp(false);
      setIdentifier(cleanEmail);
      setPassword('');
    }
    // 'signed-in': email confirmation is off, the auth listener opens the app.
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setErrorMsg(NOT_CONFIGURED_MESSAGE);
      return;
    }
    if (!password) return;
    if (isSignUp ? !email.trim() : !identifier.trim()) return;

    setLoading(true);
    resetMessages();
    try {
      if (isSignUp) await signUp();
      else await signIn();
    } catch (err) {
      setErrorMsg(describeAuthError(err).message);
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (!pendingEmail) return;
    setResendState('sending');
    const { error } = await supabase.auth.resend({ type: 'signup', email: pendingEmail });
    if (error) {
      setErrorMsg(describeAuthError(error).message);
      setResendState('idle');
    } else {
      setResendState('sent');
    }
  };

  const openForgot = () => {
    resetMessages();
    setResetSentTo(null);
    setResetEmail(isEmail(identifier) ? identifier.trim() : '');
    setForgot(true);
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setErrorMsg(NOT_CONFIGURED_MESSAGE);
      return;
    }
    const target = resetEmail.trim();
    if (!isEmail(target)) {
      setErrorMsg('Enter the email address of your account. A username can’t receive the reset email.');
      return;
    }
    setLoading(true);
    resetMessages();
    // Supabase emails a reset link. Mac app: the link comes back to the app as tellme://reset-password
    // (utils/supabase.ts handles it). Website: back to this site (falls back to the project's Site URL).
    const redirectTo = isDesktopApp() ? DESKTOP_RESET_REDIRECT : `${window.location.origin}${BASE_PATH}/`;
    const { error } = await supabase.auth.resetPasswordForEmail(target, { redirectTo });
    setLoading(false);
    if (error) {
      setErrorMsg(describeAuthError(error).message);
      return;
    }
    // Supabase answers the same way whether or not the email has an account.
    setResetSentTo(target);
  };

  const field = (
    label: string,
    type: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    autoComplete: string,
    hint?: string,
  ) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.85rem] font-medium text-ink-2">{label}</span>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        className="w-full rounded-xl bg-bg border border-line px-4 py-3 text-[1rem] text-ink placeholder:text-ink-3 focus:outline-none focus:border-cobalt focus:bg-surface"
      />
      {hint && <span className="text-[0.78rem] text-ink-3">{hint}</span>}
    </label>
  );

  if (forgot) {
    return (
      <div className="w-full max-w-[420px] rounded-[28px] bg-surface text-ink p-7 sm:p-8 shadow-[var(--shadow-pop)] pop-in">
        <Wordmark className="text-[1.6rem]" />
        <h1 className="mt-6 t-title text-[1.6rem]">Reset your password</h1>

        {!resetSentTo ? (
          <>
            <p className="mt-1.5 text-[0.95rem] text-ink-3 leading-snug">We&apos;ll email you a link to choose a new password.</p>
            <form onSubmit={sendReset} className="mt-6 flex flex-col gap-4">
              {field('Account email', 'email', resetEmail, setResetEmail, 'you@example.com', 'email')}
              {errorMsg && <p role="alert" className="rounded-xl bg-danger-wash px-4 py-3 text-[0.88rem] leading-relaxed text-danger">{errorMsg}</p>}
              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full inline-flex items-center justify-center gap-2.5 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Send reset link <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </>
        ) : (
          <>
            <p role="status" className="mt-4 flex gap-2.5 rounded-xl bg-cobalt-wash px-4 py-3 text-[0.9rem] leading-relaxed text-ink">
              <MailCheck className="w-4 h-4 shrink-0 mt-0.5 text-cobalt" />
              <span>If an account uses {resetSentTo}, we&apos;ve emailed it a reset link.</span>
            </p>
            <ol className="mt-5 flex flex-col gap-2.5 text-[0.9rem] leading-relaxed text-ink-2">
              {(isDesktopApp()
                ? [
                    'Open the email on this Mac and click “Reset Password”.',
                    'Your browser asks to open Tell Me. Click Open.',
                    'Tell Me comes back here. Choose your new password.',
                  ]
                : [
                    'Open the email and click “Reset Password”.',
                    'It opens Tell Me in your browser. Choose your new password.',
                  ]
              ).map((step, i) => (
                <li key={step} className="grid grid-cols-[1.5rem_1fr] gap-2">
                  <span className="w-6 h-6 rounded-full bg-sunk t-num text-[0.78rem] text-ink-2 flex items-center justify-center">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-[0.82rem] leading-relaxed text-ink-3">Use the newest email: each new one cancels the older links.</p>
            {errorMsg && <p role="alert" className="mt-4 rounded-xl bg-danger-wash px-4 py-3 text-[0.88rem] leading-relaxed text-danger">{errorMsg}</p>}
            <button type="button" onClick={() => { setResetSentTo(null); setErrorMsg(null); }} className="mt-4 text-[0.88rem] text-cobalt hover:underline cursor-pointer">
              Send another link
            </button>
          </>
        )}

        <button
          onClick={() => { setForgot(false); resetMessages(); }}
          className="mt-5 w-full inline-flex items-center justify-center gap-1.5 text-[0.92rem] text-ink-2 hover:text-cobalt cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[420px] rounded-[28px] bg-surface text-ink p-7 sm:p-8 shadow-[var(--shadow-pop)] pop-in">
      <Wordmark className="text-[1.6rem]" />
      <h1 className="mt-6 t-title text-[1.6rem]">{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
      <p className="mt-1.5 text-[0.95rem] text-ink-3 leading-snug">
        {isSignUp
          ? 'Your recordings stay on this Mac; the account keeps your encrypted backup.'
          : 'Sign in with your email or username.'}
      </p>

      <form onSubmit={handleAuth} className="mt-6 flex flex-col gap-4">
        {isSignUp ? (
          <>
            {field('Username', 'text', username, setUsername, 'e.g. subhajit', 'username', USERNAME_RULE)}
            {field('Email', 'email', email, setEmail, 'you@example.com', 'email')}
            {field('Password', 'password', password, setPassword, 'At least 6 characters', 'new-password')}
          </>
        ) : (
          <>
            {field('Email or username', 'text', identifier, setIdentifier, 'you@example.com or username', 'username')}
            {field('Password', 'password', password, setPassword, '••••••••', 'current-password')}
            <button type="button" onClick={openForgot} className="-mt-2 self-end text-[0.85rem] text-cobalt hover:underline cursor-pointer">
              Forgot password?
            </button>
          </>
        )}

        {errorMsg && (
          <p role="alert" className="rounded-xl bg-danger-wash px-4 py-3 text-[0.88rem] leading-relaxed text-danger">{errorMsg}</p>
        )}
        {successMsg && (
          <p role="status" className="flex gap-2.5 rounded-xl bg-cobalt-wash px-4 py-3 text-[0.88rem] leading-relaxed text-ink">
            <MailCheck className="w-4 h-4 shrink-0 mt-0.5 text-cobalt" /> {successMsg}
          </p>
        )}
        {pendingEmail && (
          <button
            type="button"
            onClick={resendConfirmation}
            disabled={resendState !== 'idle'}
            className="self-start text-[0.88rem] font-medium text-cobalt hover:underline cursor-pointer disabled:no-underline disabled:text-ink-3 disabled:cursor-default"
          >
            {resendState === 'sent' ? `Confirmation email sent again to ${pendingEmail}` : resendState === 'sending' ? 'Sending…' : 'Resend confirmation email'}
          </button>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 w-full inline-flex items-center justify-center gap-2.5 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{isSignUp ? 'Create account' : 'Sign in'} <ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <button
        onClick={() => {
          setIsSignUp(!isSignUp);
          resetMessages();
        }}
        className="mt-5 w-full text-center text-[0.92rem] text-ink-2 hover:text-cobalt cursor-pointer"
      >
        {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </div>
  );
}
