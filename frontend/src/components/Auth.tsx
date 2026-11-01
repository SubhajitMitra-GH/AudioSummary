'use client';

import React, { useState } from 'react';
import { supabase } from '../utils/supabase';
import { Mail, Lock, Loader2, ArrowRight, AudioLines, User } from 'lucide-react';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    if (isSignUp && !username.trim()) {
      setErrorMsg('Username is required.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: {
              username: username.trim(),
            }
          }
        });
        if (error) throw error;
        setSuccessMsg('Registration successful! You can now log in.');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });
        if (error) throw error;
      }
    } catch (err) {
      setErrorMsg(err instanceof Error && err.message ? err.message : 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] rounded-[2.5rem] p-8 md:p-10 flex flex-col gap-6 relative overflow-hidden select-none animate-fade-in"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
      }}>
      {/* Brand logo */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-md"
          style={{ background: 'var(--accent)', boxShadow: '0 4px 14px var(--accent-shadow)' }}>
          <AudioLines className="w-6 h-6 animate-pulse" style={{ color: 'var(--text-on-accent)' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {isSignUp ? 'Create Workspace' : 'Welcome Back'}
          </h1>
          <p className="text-xs font-semibold tracking-wide mt-1" style={{ color: 'var(--text-muted)' }}>
            {isSignUp ? 'Sign up to build your audio database' : 'Sign in to access your transcript RAG indices'}
          </p>
        </div>
      </div>

      {/* Auth form */}
      <form onSubmit={handleAuth} className="flex flex-col gap-4">
        {isSignUp && (
          <div className="flex flex-col gap-1.5 animate-fade-in">
            <label className="text-[11px] font-bold uppercase tracking-wider pl-1"
              style={{ color: 'var(--text-muted)' }}>Username</label>
            <div className="relative flex items-center rounded-xl transition-all"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
              <User className="absolute left-4 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="john_doe"
                className="w-full pl-11 pr-4 py-3 bg-transparent text-sm focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider pl-1"
            style={{ color: 'var(--text-muted)' }}>Email Address</label>
          <div className="relative flex items-center rounded-xl transition-all"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <Mail className="absolute left-4 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full pl-11 pr-4 py-3 bg-transparent text-sm focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider pl-1"
            style={{ color: 'var(--text-muted)' }}>Password</label>
          <div className="relative flex items-center rounded-xl transition-all"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <Lock className="absolute left-4 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-11 pr-4 py-3 bg-transparent text-sm focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl p-3.5 text-xs font-medium leading-relaxed"
            style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl p-3.5 text-xs font-medium leading-relaxed"
            style={{ background: 'var(--success-bg)', color: '#22c55e' }}>
            {successMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full font-semibold py-3.5 rounded-full shadow-md transition-all flex items-center justify-center gap-2 text-sm cursor-pointer active:scale-[0.98] mt-2 disabled:opacity-50"
          style={{
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            boxShadow: '0 4px 14px var(--accent-shadow)',
          }}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              {isSignUp ? 'Register Account' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Footer switch state */}
      <div className="text-center pt-2">
        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setErrorMsg(null);
            setSuccessMsg(null);
          }}
          className="text-xs font-semibold hover:underline cursor-pointer"
          style={{ color: 'var(--accent)' }}
        >
          {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
        </button>
      </div>
    </div>
  );
}
