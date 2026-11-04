'use client';

import React from 'react';
import { Lock, X, Check, FileAudio, Server, Cloud } from 'lucide-react';
import { SpeechBars } from '../ui/Brand';

/* ─────────────────────────────────────────────────────────
   Pipeline: voice → transcript → passages → answer
   ───────────────────────────────────────────────────────── */

const STEPS = [
  { title: 'Record, upload or paste a link', body: 'Mic, audio file, YouTube or a direct audio link.' },
  { title: 'Whisper transcribes it', body: 'On your Mac. The audio file is deleted afterwards.' },
  { title: 'Split into passages', body: 'Indexed locally so the right parts can be found fast.' },
  { title: 'Ask anything', body: 'A local model answers from the 6 closest passages, and lets you open them.' },
];

function StepArt({ i }: { i: number }) {
  if (i === 0) return <SpeechBars count={22} seed={3} className="h-10 w-full" />;
  if (i === 1)
    return (
      <div className="flex flex-col gap-1.5 w-full" aria-hidden="true">
        {[92, 76, 84, 58].map((w, j) => (
          <span key={j} className="h-1.5 rounded-full bg-line-strong" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  if (i === 2)
    return (
      <div className="grid grid-cols-8 gap-[4px] w-full" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, j) => (
          <span key={j} className={`aspect-square rounded-[3px] ${[2, 9, 13, 20].includes(j) ? 'bg-cobalt' : 'bg-line'}`} />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5 w-full" aria-hidden="true">
      <span className="self-end rounded-2xl rounded-br-md bg-ink text-bg text-[0.68rem] px-2.5 py-1">When is launch?</span>
      <span className="self-start rounded-2xl rounded-bl-md bg-cobalt-wash text-ink text-[0.68rem] px-2.5 py-1">
        The 14th
      </span>
      <span className="self-start rounded-md bg-surface border border-cobalt/30 text-[0.6rem] text-cobalt px-1.5 py-0.5">6 passages searched</span>
    </div>
  );
}

export function Pipeline() {
  return (
    <ol className="relative grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* connector behind the cards on wide screens */}
      <span aria-hidden="true" className="hidden lg:block absolute left-[12%] right-[12%] top-[3.25rem] h-px bg-line-strong" />
      {STEPS.map((s, i) => (
        <li key={s.title} className="relative rounded-[20px] bg-surface border border-line p-5 shadow-[var(--shadow-float)]">
          <div className="h-[4.5rem] flex items-center rounded-xl bg-bg px-4 mb-5">
            <StepArt i={i} />
          </div>
          <p className="flex items-baseline gap-2">
            <span className="t-num text-[0.75rem] text-cobalt">{i + 1}</span>
            <span className="font-semibold text-ink">{s.title}</span>
          </p>
          <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ─────────────────────────────────────────────────────────
   Privacy map: where your data goes
   ───────────────────────────────────────────────────────── */

function Laptop({ children, tone = 'cobalt' }: { children: React.ReactNode; tone?: 'cobalt' | 'muted' }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-full rounded-t-2xl border-[6px] ${tone === 'cobalt' ? 'border-ink' : 'border-ink-3'} bg-surface p-3 min-h-[9.5rem]`}>
        {children}
      </div>
      <div className={`w-[112%] h-3 rounded-b-xl ${tone === 'cobalt' ? 'bg-ink' : 'bg-ink-3'}`} />
    </div>
  );
}

function Chip({ children, kind = 'local' }: { children: React.ReactNode; kind?: 'local' | 'away' | 'enc' }) {
  const cls =
    kind === 'away' ? 'bg-ember-wash text-ink border-ember/30'
      : kind === 'enc' ? 'bg-sunk text-ink-2 border-line'
        : 'bg-cobalt-wash text-ink border-cobalt/20';
  return <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[0.78rem] ${cls}`}>{children}</span>;
}

export function PrivacyMap() {
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      {/* Tell Me. */}
      <figure className="rounded-[24px] bg-surface border border-line p-6 shadow-[var(--shadow-float)]">
        <figcaption className="flex items-center justify-between mb-6">
          <span className="t-title text-[1.15rem]">Tell Me.</span>
          <span className="inline-flex items-center gap-1.5 text-[0.8rem] text-success"><Check className="w-4 h-4" /> Audio stays on your Mac</span>
        </figcaption>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] items-center gap-3">
          <Laptop>
            <p className="text-[0.72rem] text-ink-3 mb-2">Your Mac</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip><FileAudio className="w-3.5 h-3.5 text-cobalt" /> Audio (deleted after use)</Chip>
              <Chip>Transcript</Chip>
              <Chip>Search index</Chip>
              <Chip>AI model</Chip>
            </div>
          </Laptop>
          <svg width="56" height="20" viewBox="0 0 56 20" aria-hidden="true" className="shrink-0 max-sm:rotate-90 max-sm:mx-auto">
            <path d="M2 10 H50" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 5" />
            <path d="M46 5 L52 10 L46 15" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" />
          </svg>
          <div className="flex sm:flex-col items-center gap-3 sm:gap-2 sm:w-[7.5rem] max-sm:justify-center">
            <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sunk border border-line">
              <Cloud className="w-6 h-6 text-ink-3" />
            </span>
            <p className="text-[0.75rem] text-center text-ink-2 leading-snug">Backup: <span className="inline-flex items-center gap-0.5"><Lock className="w-3 h-3" />encrypted</span> text, plus the search index (not encrypted)</p>
          </div>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.85rem]">
          <li className="flex items-center gap-2 text-ink-2"><Check className="w-4 h-4 text-success shrink-0" /> No audio uploaded</li>
          <li className="flex items-center gap-2 text-ink-2"><Check className="w-4 h-4 text-success shrink-0" /> No AI company in the loop</li>
          <li className="flex items-center gap-2 text-ink-2"><Check className="w-4 h-4 text-success shrink-0" /> Each account sees only its own rows</li>
          <li className="flex items-center gap-2 text-ink-2"><Check className="w-4 h-4 text-success shrink-0" /> Works offline while signed in</li>
        </ul>
      </figure>

      {/* Cloud chatbot */}
      <figure className="rounded-[24px] bg-surface border border-line p-6">
        <figcaption className="flex items-center justify-between mb-6">
          <span className="t-title text-[1.15rem] text-ink-2">A typical cloud chatbot</span>
          <span className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-3"><X className="w-4 h-4 text-ember" /> Audio leaves your device</span>
        </figcaption>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] items-center gap-3">
          <Laptop tone="muted">
            <p className="text-[0.72rem] text-ink-3 mb-2">Your computer</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip kind="enc"><FileAudio className="w-3.5 h-3.5" /> Audio</Chip>
            </div>
          </Laptop>
          <svg width="56" height="20" viewBox="0 0 56 20" aria-hidden="true" className="shrink-0 max-sm:rotate-90 max-sm:mx-auto">
            <path d="M2 10 H50" stroke="var(--ember)" strokeWidth="2" strokeDasharray="5 5" />
            <path d="M46 5 L52 10 L46 15" fill="none" stroke="var(--ember)" strokeWidth="2" />
          </svg>
          <div className="flex sm:flex-col items-center gap-3 sm:gap-2 sm:w-[7.5rem] max-sm:justify-center">
            <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-ember-wash border border-ember/30">
              <Server className="w-6 h-6 text-ember" />
            </span>
            <p className="text-[0.75rem] text-center text-ink-2 leading-snug">Provider servers: audio, transcript, chats</p>
          </div>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.85rem]">
          <li className="flex items-center gap-2 text-ink-3"><X className="w-4 h-4 text-ember shrink-0" /> Audio uploaded</li>
          <li className="flex items-center gap-2 text-ink-3"><X className="w-4 h-4 text-ember shrink-0" /> Kept under their policy</li>
          <li className="flex items-center gap-2 text-ink-3"><X className="w-4 h-4 text-ember shrink-0" /> Needs internet per question</li>
          <li className="flex items-center gap-2 text-ink-3"><X className="w-4 h-4 text-ember shrink-0" /> Often paid per use</li>
        </ul>
      </figure>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Grounding: every answer points at its passages
   ───────────────────────────────────────────────────────── */

const PASSAGES = [
  { n: 14, text: "Legal needs another week, so let's move launch to the fourteenth, not the seventh." },
  { n: 15, text: "Fine by me. Who's taking the press list? Okay, and the venue is still pending." },
  { n: 22, text: "I'll take the press list. I'll send a draft by Thursday." },
];

export function Grounding() {
  return (
    <div className="relative">
      <p className="mb-3 text-[0.85rem] text-ink-3">The closest passages found for the question (3 of the 6 shown)</p>
      <div className="grid md:grid-cols-3 gap-4">
        {PASSAGES.map((p) => (
          <div key={p.n} className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-float)]">
            <p className="t-num text-[0.72rem] text-ink-3 mb-2">Passage {p.n}</p>
            <p className="text-[0.92rem] leading-relaxed text-ink">{p.text}</p>
          </div>
        ))}
      </div>

      {/* the passages go to the model on your Mac */}
      <svg viewBox="0 0 300 56" preserveAspectRatio="none" className="hidden md:block w-full h-14" aria-hidden="true">
        {[50, 150, 250].map((x) => (
          <path key={x} d={`M${x} 0 C ${x} 30, 150 20, 150 56`} fill="none" stroke="var(--cobalt)" strokeWidth="1.5" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="md:hidden h-6" />

      <div className="mx-auto max-w-[34rem] rounded-[20px] bg-surface border border-line p-5 shadow-[var(--shadow-pop)]">
        <p className="text-[0.8rem] text-ink-3">You asked: <span className="text-ink font-medium">What changed about the launch, and who owns the press list?</span></p>
        <p className="mt-3 text-[1.02rem] leading-relaxed text-ink">
          Launch moved to the 14th because legal needs another week, and Priya will send the press-list draft by Thursday.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cobalt-wash px-2.5 py-1 text-[0.8rem] text-cobalt">
          <span className="w-1.5 h-1.5 rounded-full bg-cobalt" /> 6 passages searched · open to check
        </p>
      </div>
      <p className="mt-3 text-center text-[0.75rem] text-ink-3">Illustrative example</p>
    </div>
  );
}

export function NotFoundCard() {
  return (
    <div className="rounded-[20px] bg-surface border border-line p-5">
      <p className="text-[0.8rem] text-ink-3">You asked: <span className="text-ink font-medium">What&apos;s the ad budget?</span></p>
      <p className="mt-3 text-[1.02rem] leading-relaxed text-ink">The recording doesn&apos;t say. Nobody mentions an ad budget, so there&apos;s nothing to quote.</p>
      <p className="mt-3 inline-flex items-center gap-1.5 text-[0.8rem] text-ink-3"><span className="w-1.5 h-1.5 rounded-full bg-ink-3" /> 6 passages checked · none mention it</p>
    </div>
  );
}
