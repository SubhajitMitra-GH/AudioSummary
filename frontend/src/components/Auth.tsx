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
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#f4f6fc] p-6 selection:bg-indigo-100 select-none">
      <div className="w-full max-w-[420px] bg-white border border-[#e8ecf4] rounded-[2.5rem] p-8 md:p-10 shadow-[0_12px_40px_rgba(26,35,126,0.03)] flex flex-col gap-6 relative overflow-hidden">
        {/* Brand logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#1a237e] flex items-center justify-center shadow-md shadow-indigo-900/10">
            <AudioLines className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              {isSignUp ? 'Create Workspace' : 'Welcome Back'}
            </h1>
            <p className="text-xs text-slate-400 font-semibold tracking-wide mt-1">
              {isSignUp ? 'Sign up to build your audio database' : 'Sign in to access your transcript RAG indices'}
            </p>
          </div>
        </div>

        {/* Auth form */}
        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-1.5 animate-fade-in">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider pl-1">Username</label>
              <div className="relative flex items-center bg-[#f8f9fd]/50 border border-slate-200/60 focus-within:border-[#1a237e]/40 rounded-xl transition-all">
                <User className="absolute left-4 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="john_doe"
                  className="w-full pl-11 pr-4 py-3 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider pl-1">Email Address</label>
            <div className="relative flex items-center bg-[#f8f9fd]/50 border border-slate-200/60 focus-within:border-[#1a237e]/40 rounded-xl transition-all">
              <Mail className="absolute left-4 text-slate-400 w-4 h-4" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-11 pr-4 py-3 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider pl-1">Password</label>
            <div className="relative flex items-center bg-[#f8f9fd]/50 border border-slate-200/60 focus-within:border-[#1a237e]/40 rounded-xl transition-all">
              <Lock className="absolute left-4 text-slate-400 w-4 h-4" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-11 pr-4 py-3 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="bg-red-50/50 border border-red-200/50 rounded-xl p-3.5 text-xs text-red-600 font-medium leading-relaxed">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="bg-green-50/50 border border-green-200/50 rounded-xl p-3.5 text-xs text-green-600 font-medium leading-relaxed">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#1a237e] hover:bg-[#121b74] text-white font-semibold py-3.5 rounded-full shadow-md shadow-indigo-900/10 hover:shadow-indigo-900/20 transition-all flex items-center justify-center gap-2 text-xs.5 cursor-pointer active:scale-[0.98] mt-2 disabled:opacity-50"
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
            className="text-xs font-semibold text-[#1a237e] hover:underline cursor-pointer"
          >
            {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
