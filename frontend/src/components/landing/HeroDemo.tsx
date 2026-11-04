'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { SpeechBars, Thinking } from '../ui/Brand';
import { tokensCloud, tokensTellMe, passageCount } from './Charts';

/* Floating app cards: a question is asked about an (illustrative) recording,
   the answer appears with its source, and the source passage lights up.
   Cards drift at different depths as the page scrolls. */

const MINUTES = 48;

const QUESTIONS = [
  { q: 'When is the launch now?', a: 'The 14th. Marco moved it from the 7th because legal needs another week.', passage: 14 },
  { q: 'Who owns the press list?', a: 'Priya. She said she would send a draft by Thursday.', passage: 22 },
  { q: "What's the ad budget?", a: "The recording doesn't say. Nobody mentions an ad budget.", passage: 0 },
];

const PASSAGE_TEXT: Record<number, { before: string; mark: string; after: string }> = {
  14: { before: 'Legal needs another week, ', mark: "so let's move launch to the fourteenth", after: ', not the seventh.' },
  22: { before: "I'll take the press list. ", mark: "I'll send a draft by Thursday.", after: ' Great, next item.' },
};

type Phase = 'ask' | 'think' | 'answer' | 'hold';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function HeroDemo() {
  const [qi, setQi] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>('ask');
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]);

  // Pause when off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Depth parallax on scroll (transform only, written straight to the DOM).
  useEffect(() => {
    if (reduced() || window.matchMedia('(max-width: 1023px)').matches) return;
    const depths = [0.0, -0.08, 0.06, -0.12];
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      layers.current.forEach((el, i) => {
        if (el) el.style.transform = `translate3d(0, ${(y * depths[i]).toFixed(1)}px, 0)`;
      });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  // Reduced motion: one finished exchange.
  useEffect(() => {
    if (!reduced()) return;
    const id = setTimeout(() => { setTyped(QUESTIONS[0].q.length); setPhase('answer'); }, 0);
    return () => clearTimeout(id);
  }, []);

  // Conversation loop.
  useEffect(() => {
    if (!visible || reduced()) return;
    const cur = QUESTIONS[qi];
    let id: ReturnType<typeof setTimeout>;
    if (phase === 'ask') {
      id = typed < cur.q.length ? setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 700 : 38) : setTimeout(() => setPhase('think'), 300);
    } else if (phase === 'think') {
      id = setTimeout(() => setPhase('answer'), 1200);
    } else if (phase === 'answer') {
      id = setTimeout(() => setPhase('hold'), 3800);
    } else {
      id = setTimeout(() => { setQi((i) => (i + 1) % QUESTIONS.length); setTyped(0); setPhase('ask'); }, 250);
    }
    return () => clearTimeout(id);
  }, [qi, typed, phase, visible]);

  const cur = QUESTIONS[qi];
  const answered = phase === 'answer' || phase === 'hold';
  const passage = PASSAGE_TEXT[cur.passage] ?? PASSAGE_TEXT[14];
  const lit = answered && cur.passage > 0;

  return (
    <div ref={rootRef} className="relative h-[37rem] sm:h-[35rem] w-full max-w-[36rem] mx-auto lg:mx-0 lg:ml-auto">
      <p className="sr-only">Illustrative example: you ask a question about a recording, Tell Me. answers on your Mac and shows the passage it used.</p>

      {/* Passage card (behind) */}
      <div ref={(el) => { layers.current[1] = el; }} className="absolute left-0 top-2 w-[58%] z-10" aria-hidden="true">
        <div className={`rounded-[20px] bg-surface border p-4 transition-[border-color,box-shadow] duration-500 ${lit ? 'border-cobalt/50 shadow-[var(--shadow-pop)]' : 'border-line shadow-[var(--shadow-float)]'}`}>
          <p className="flex items-center justify-between text-[0.72rem] text-ink-3">
            <span className="t-num">Passage {lit ? cur.passage : 14}</span>
            <span className="hidden sm:inline">from your transcript</span>
          </p>
          <p className="mt-2 text-[0.88rem] leading-relaxed text-ink">
            {passage.before}
            <span className={lit ? 'src-mark' : ''}>{passage.mark}</span>
            {passage.after}
          </p>
        </div>
      </div>

      {/* Token card (top right) */}
      <div ref={(el) => { layers.current[3] = el; }} className="absolute right-0 top-0 w-[39%] z-20" aria-hidden="true">
        <div className="rounded-[18px] bg-ink text-bg p-4 shadow-[var(--shadow-pop)]">
          <p className="text-[0.72rem] opacity-75">Tokens for this question (est.)</p>
          <p className="mt-1 t-display text-[2rem]" style={{ lineHeight: 1 }}>{tokensTellMe(MINUTES).toLocaleString('en-US')}</p>
          <p className="mt-1.5 text-[0.75rem] opacity-75">vs <span className="t-num">{tokensCloud(MINUTES).toLocaleString('en-US')}</span> pasting the whole transcript into a chatbot</p>
        </div>
      </div>

      {/* Main chat card */}
      <div ref={(el) => { layers.current[0] = el; }} className="absolute left-[4%] right-0 sm:left-[8%] sm:right-[4%] top-[12rem] sm:top-[8.5rem] z-30" aria-hidden="true">
        <div className="rounded-[24px] bg-surface border border-line shadow-[var(--shadow-pop)] overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line">
            <span className="w-9 h-9 rounded-xl bg-cobalt-wash flex items-center justify-center shrink-0">
              <SpeechBars count={7} seed={5} className="h-4 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-[0.92rem] text-ink truncate">Product sync</p>
              <p className="text-[0.72rem] text-ink-3"><span className="t-num">{MINUTES}:12</span> · transcribed on this Mac</p>
            </div>
            <SpeechBars count={30} seed={11} progress={0.62} className="hidden sm:flex h-6 w-32 ml-auto" />
          </div>

          <div className="px-5 py-5 min-h-[13rem] flex flex-col gap-3">
            <div className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-ink text-bg px-4 py-2.5 text-[0.92rem] min-h-[2.6rem]">
              {cur.q.slice(0, typed)}
              {phase === 'ask' && <span className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-[1px] bg-bg caret" />}
            </div>
            {phase === 'think' && (
              <div className="self-start inline-flex items-center gap-2.5 rounded-2xl rounded-bl-md bg-sunk px-4 py-3 text-[0.85rem] text-ink-2 rise-in">
                <Thinking /> Searching {passageCount(MINUTES)} passages…
              </div>
            )}
            {answered && (
              <div className="self-start max-w-[90%] pop-in">
                <div className="rounded-2xl rounded-bl-md bg-cobalt-wash px-4 py-3 text-[0.95rem] leading-relaxed text-ink">{cur.a}</div>
                <div className="mt-2 flex items-center gap-2 text-[0.75rem] text-ink-3">
                  {cur.passage > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-cobalt/30 px-2 py-1 text-ink">
                      <span className="w-1.5 h-1.5 rounded-full bg-cobalt" /> 6 passages searched · best: {cur.passage}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-line px-2 py-1">6 passages checked · none mention it</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* On-device badge */}
      <div ref={(el) => { layers.current[2] = el; }} className="absolute left-0 bottom-0 z-40" aria-hidden="true">
        <div className="inline-flex items-center gap-2.5 rounded-full bg-surface border border-line pl-3 pr-4 py-2 shadow-[var(--shadow-float)]">
          <span className="relative flex w-2.5 h-2.5">
            <span className="absolute inset-0 rounded-full bg-success pulse-ring" />
            <span className="relative w-2.5 h-2.5 rounded-full bg-success" />
          </span>
          <span className="text-[0.8rem] text-ink">Running on this Mac</span>
          <Lock className="w-3.5 h-3.5 text-ink-3" />
        </div>
      </div>

      <p className="absolute right-0 bottom-1 text-[0.7rem] text-ink-3">Illustrative example</p>
    </div>
  );
}
