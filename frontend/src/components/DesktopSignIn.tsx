'use client';

import React from 'react';
import Auth from './Auth';
import { SpeechBars, Wordmark } from './ui/Brand';

const STEPS = [
  { title: 'Sign in', body: 'Your account keeps an encrypted backup of your conversations.' },
  { title: 'Pick an AI model', body: 'Downloaded once, then answers are written on this Mac.' },
  { title: 'Ask your recordings', body: 'Record, drop in a file or paste a link, then ask anything.' },
];

/** First screen of the Mac app: sign in (the marketing page is only on the website). */
export default function DesktopSignIn({ authError = null, authErrorKey = 0 }: { authError?: string | null; authErrorKey?: number }) {
  return (
    <div className="min-h-screen w-full bg-bg grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden lg:flex flex-col justify-between bg-surface border-r border-line p-12">
        <Wordmark className="text-[1.8rem]" />
        <div>
          <h1 className="t-display text-[clamp(2.6rem,4vw,3.6rem)]">Welcome to <span className="hl">Tell Me.</span></h1>
          <SpeechBars count={44} seed={19} progress={0.33} className="mt-8 h-12 w-full max-w-[26rem]" />
          <ol className="mt-10 flex flex-col gap-5 max-w-[26rem]">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className={`w-8 h-8 rounded-full t-num text-[0.85rem] flex items-center justify-center ${i === 0 ? 'bg-cobalt text-on-cobalt' : 'bg-sunk text-ink-2'}`}>{i + 1}</span>
                <div>
                  <p className="font-semibold text-ink">{s.title}</p>
                  <p className="text-[0.92rem] leading-relaxed text-ink-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="flex items-center gap-2 text-[0.85rem] text-ink-3">
          <span className="w-2 h-2 rounded-full bg-success" /> Audio is transcribed and answered on this Mac.
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 py-12">
        {/* Remount when a reset link reports a problem (even the same one again), so it shows on the card. */}
        <Auth key={authErrorKey} initialError={authError} />
      </main>
    </div>
  );
}
