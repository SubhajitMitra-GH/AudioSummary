'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, ArrowRight, Check } from 'lucide-react';
import { supabase, setPasswordRecovery } from '../utils/supabase';
import { describeAuthError, passwordProblem, MIN_PASSWORD } from '../utils/authHelpers';
import { Wordmark } from './ui/Brand';

/**
 * Shown after the user opens a password-reset link (or enters the reset code):
 * they hold a short-lived recovery session and must choose a new password.
 */
export default function SetNewPassword({ hasSession }: { hasSession: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The page may render this a moment before its own auth state catches up, so confirm the session here.
  const [sessionFound, setSessionFound] = useState<boolean | null>(hasSession ? true : null);
  useEffect(() => {
    if (hasSession) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSessionFound(Boolean(data.session)); });
    return () => { active = false; };
  }, [hasSession]);
  const canReset = hasSession || sessionFound === true;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(describeAuthError(updateError).message);
      return;
    }
    setDone(true);
  };

  const cancel = async () => {
    setPasswordRecovery(false);
    await supabase.auth.signOut();
  };

  const input = (label: string, value: string, onChange: (v: string) => void, autoFocus = false) => (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.85rem] font-medium text-ink-2">{label}</span>
      <input
        type="password"
        required
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="new-password"
        placeholder={`At least ${MIN_PASSWORD} characters`}
        className="w-full rounded-xl bg-bg border border-line px-4 py-3 text-[1rem] text-ink placeholder:text-ink-3 focus:outline-none focus:border-cobalt focus:bg-surface"
      />
    </label>
  );

  return (
    <div className="min-h-screen w-full bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px] rounded-[28px] bg-surface p-7 sm:p-8 shadow-[var(--shadow-pop)] pop-in">
        <Wordmark className="text-[1.6rem]" />

        {!canReset && sessionFound === null ? (
          <p className="mt-6 flex items-center gap-2 text-ink-3"><Loader2 className="w-4 h-4 animate-spin" /> Checking your reset link…</p>
        ) : !canReset ? (
          <>
            <h1 className="mt-6 t-title text-[1.6rem]">Reset link expired</h1>
            <p className="mt-2 text-[0.95rem] text-ink-3 leading-relaxed">
              This reset link can&apos;t be used any more. Go back and choose &ldquo;Forgot password?&rdquo; to get a new one.
            </p>
            <button onClick={cancel} className="mt-6 w-full rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer">
              Back to sign in
            </button>
          </>
        ) : done ? (
          <>
            <span className="mt-6 inline-flex w-11 h-11 items-center justify-center rounded-full bg-cobalt-wash text-cobalt">
              <Check className="w-5 h-5" />
            </span>
            <h1 className="mt-4 t-title text-[1.6rem]">Password updated</h1>
            <p className="mt-2 text-[0.95rem] text-ink-3 leading-relaxed">You&apos;re signed in. Use the new password next time.</p>
            <button
              onClick={() => setPasswordRecovery(false)}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer"
            >
              Continue to Tell Me <ArrowRight className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <h1 className="mt-6 t-title text-[1.6rem]">Choose a new password</h1>
            <p className="mt-1.5 text-[0.95rem] text-ink-3 leading-snug">Pick something you haven&apos;t used here before.</p>
            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              {input('New password', password, setPassword, true)}
              {input('Repeat new password', confirm, setConfirm)}
              {error && <p role="alert" className="rounded-xl bg-danger-wash px-4 py-3 text-[0.88rem] leading-relaxed text-danger">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full inline-flex items-center justify-center gap-2 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save new password'}
              </button>
            </form>
            <button onClick={cancel} className="mt-4 w-full text-center text-[0.9rem] text-ink-2 hover:text-cobalt cursor-pointer">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
