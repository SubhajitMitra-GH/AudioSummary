'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, X, Plus } from 'lucide-react';
import Auth from './Auth';
import HeroDemo from './landing/HeroDemo';
import { Pipeline, PrivacyMap, Grounding, NotFoundCard } from './landing/Illustrations';
import { TokenLineChart, SessionBars, PassageGrid, TokenTable, tokensCloud, tokensTellMe, ASSUME } from './landing/Charts';
import { Wordmark } from './ui/Brand';
import DownloadMac from './DownloadMac';


interface LandingPageProps {
  onLaunchApp: () => void;
  showAuth: boolean;
  onCloseAuth: () => void;
  /** Shown in the sign-in sheet (e.g. an expired email link). */
  authError?: string | null;
}

const FAQS = [
  {
    question: 'Is my audio ever sent to a cloud server?',
    answer:
      'Not in the Mac app. Your audio is transcribed on your Mac and the file is deleted after processing. Search and answers also run locally. So you can restore your work on another device, the transcript text, chat messages and session titles are encrypted and backed up to the cloud (Supabase), together with the search index (which is not encrypted). The encryption key is shared by everyone using the same install, so treat the backup as protected, not end-to-end private.',
  },
  {
    question: 'Can I use Tell Me on Windows or my phone?',
    answer:
      'Not yet. The Tell Me app is Mac-only for now (Apple Silicon: M1 or newer). On any device, including Windows and phones, you can sign in on this website and view your saved chats. The website is view-only and needs internet; recording, uploading and asking questions happen in the Mac app.',
  },
  {
    question: 'How did you estimate the token numbers?',
    answer: `They are estimates, not measurements: about ${ASSUME.wordsPerMin} spoken words per minute and about 1.33 tokens per word (≈${ASSUME.tokensPerMin} tokens a minute). Tell Me. sends the ${ASSUME.passagesSent} most relevant passages of about 1,000 characters each, plus its instructions (≈${ASSUME.promptTokens} tokens). The chatbot case assumes you paste the whole transcript into the chat, which is then sent with every question along with the earlier conversation.`,
  },
  {
    question: 'Are the answers always right?',
    answer:
      'No AI is. Tell Me. narrows what the model can use to passages from your recording and tells it to say when the answer isn’t there, and every answer comes with the passages it was given so you can check it in seconds. Smaller local models can still misread a passage.',
  },
  {
    question: 'Can I use it offline?',
    answer:
      'In the Mac app, mostly: recording, transcription, search and chat run on your Mac. Viewing your chats on the website always needs internet. You need internet to sign in (and to refresh your sign-in after about an hour), to fetch YouTube or web links, and to back up.',
  },
  {
    question: 'Do I pay per question?',
    answer: 'No. The models are free, open models that run through Ollama on your own computer: no subscription, API key or per-question cost.',
  },
];

const STOCK = [
  { label: 'Fast', id: 'llama3.2:1b', size: 1.3, note: 'Quickest. Good for short factual questions.' },
  { label: 'Balanced', id: 'llama3.2:3b', size: 2.0, note: 'Good answers and summaries on most Macs.', recommended: true },
  { label: 'Best quality', id: 'mistral', size: 4.1, note: 'Most detailed answers; slower, needs 8 GB+ free memory.' },
];

function Section({ id, title, intro, children }: { id?: string; title: React.ReactNode; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="max-w-[1200px] mx-auto px-4 sm:px-8 py-20 md:py-28">
      <div className="max-w-[44rem]">
        <h2 className="t-display text-[clamp(2.3rem,5vw,3.75rem)]">{title}</h2>
        <p className="mt-5 text-[1.12rem] leading-relaxed text-ink-2">{intro}</p>
      </div>
      <div className="mt-12">{children}</div>
    </section>
  );
}

export default function LandingPage({ onLaunchApp, showAuth, onCloseAuth, authError = null }: LandingPageProps) {
  const [minutes, setMinutes] = useState(60);
  const ratio = tokensCloud(minutes) / tokensTellMe(minutes);

  // Close the sign-in sheet with Escape.
  useEffect(() => {
    if (!showAuth) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseAuth();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAuth, onCloseAuth]);

  return (
    <div className="min-h-screen w-full bg-bg text-ink overflow-x-hidden">
      {/* ═══ NAV ═══ */}
      <nav className="sticky top-0 z-40 bg-bg/85 backdrop-blur-md">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
          <Wordmark className="text-[1.6rem]" />
          <div className="hidden md:flex items-center gap-8 text-[0.92rem] text-ink-2">
            <a href="#tokens" className="hover:text-ink">Tokens</a>
            <a href="#privacy" className="hover:text-ink">Privacy</a>
            <a href="#sources" className="hover:text-ink">Accuracy</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onLaunchApp} className="rounded-full px-4 py-2 text-[0.9rem] font-medium border border-line-strong hover:border-ink cursor-pointer">
              Sign in
            </button>
            <span className="hidden sm:inline-flex"><DownloadMac variant="nav" label="Download" /></span>
          </div>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <header className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-10 md:pt-16 pb-16 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-14 lg:gap-8 items-center">
        <div>
          <h1 className="t-display text-[clamp(3.2rem,8vw,6rem)]">
            Ask your <span className="hl">recordings</span>.
          </h1>
          <p className="mt-7 text-[1.2rem] leading-relaxed text-ink-2 max-w-[31rem]">
            Tell Me. transcribes meetings, lectures and interviews on your Mac, then answers questions from what was
            actually said, with the passage to prove it.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <DownloadMac variant="primary" label="Download for Mac" />
            <button
              onClick={onLaunchApp}
              className="group inline-flex items-center gap-2 rounded-full border border-line-strong hover:border-ink px-5 py-3.5 text-[1rem] font-medium text-ink cursor-pointer"
            >
              View online
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
          <p className="mt-4 max-w-[31rem] text-[0.86rem] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">View online</span> lets you read your saved chats in any browser (Windows,
            phone or Mac). It is view-only and needs internet. To record, upload and ask questions, download the app.{' '}
            <span className="font-medium text-ink-2">For now only Mac is supported</span> (Apple Silicon, M1 or newer).
          </p>
        </div>
        <HeroDemo />
      </header>

      {/* ═══ PIPELINE ═══ */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-8">
        <Pipeline />
      </section>

      {/* ═══ TOKENS ═══ */}
      <Section
        id="tokens"
        title={<>A fraction of the tokens.</>}
        intro={<>Paste a transcript into a chatbot and the whole thing is sent with every question. Tell Me. finds the few passages that matter and sends only those to a model on your Mac. Drag across the chart to pick a recording length.</>}
      >
        <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5">
          <figure className="rounded-[24px] bg-surface border border-line p-5 sm:p-7 shadow-[var(--shadow-float)]">
            <figcaption className="flex flex-wrap items-end justify-between gap-4 mb-5">
              <div>
                <p className="font-semibold text-ink">Tokens sent to the model, per question</p>
                <p className="text-[0.85rem] text-ink-3">Estimate · recording length on the x-axis</p>
              </div>
              <div className="flex items-center gap-4 text-[0.82rem] text-ink-2">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-ember" /> Chatbot, pasted transcript</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-cobalt" /> Tell Me.</span>
              </div>
            </figcaption>
            <TokenLineChart minutes={minutes} onMinutes={setMinutes} />
            <label className="mt-4 flex items-center gap-4 text-[0.85rem] text-ink-2">
              <span className="shrink-0">Recording length</span>
              <input
                type="range"
                min={5}
                max={180}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="flex-1 accent-[var(--cobalt)]"
                aria-valuetext={`${minutes} minutes`}
              />
              <span className="t-num text-ink w-20 text-right whitespace-nowrap">{minutes} min</span>
            </label>
            <details className="mt-4 text-[0.85rem]">
              <summary className="cursor-pointer text-ink-3 hover:text-ink">Show as a table</summary>
              <div className="mt-3"><TokenTable /></div>
            </details>
          </figure>

          <div className="flex flex-col gap-5">
            <div className="rounded-[24px] bg-ink text-bg p-6 sm:p-7">
              <p className="text-[0.9rem] opacity-75">For a {minutes}-minute recording (estimate)</p>
              <p className="mt-2 t-display text-[4rem]" style={{ lineHeight: 1 }}>{ratio.toFixed(1)}×</p>
              <p className="mt-2 text-[1rem] opacity-90">fewer tokens per question, and they never leave your Mac.</p>
            </div>
            <div className="rounded-[24px] bg-surface border border-line p-6">
              <p className="font-semibold text-ink">Over a 10-question conversation</p>
              <p className="text-[0.85rem] text-ink-3 mb-5">Chatbots resend the transcript and the chat so far each time</p>
              <SessionBars minutes={minutes} />
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[24px] bg-surface border border-line p-6 sm:p-7 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-6 items-center">
          <div>
            <p className="font-semibold text-ink">What actually reaches the model</p>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-2">
              The transcript is split into passages of about 1,000 characters. For each question only the {ASSUME.passagesSent} closest
              matches are sent, so cost and speed stay flat however long the recording is.
            </p>
          </div>
          <PassageGrid minutes={minutes} />
        </div>
        <p className="mt-4 text-[0.8rem] text-ink-3">
          Estimates, not benchmarks: {ASSUME.wordsPerMin} words a minute, ≈1.33 tokens a word, {ASSUME.passagesSent} passages of ≈1,000 characters,
          and the transcript pasted into the chatbot. See the FAQ for details.
        </p>
      </Section>

      {/* ═══ PRIVACY ═══ */}
      <div className="bg-surface border-y border-line">
        <Section
          id="privacy"
          title={<>Your audio never leaves.</>}
          intro={<>Transcription, search and answers all run on your Mac, so there is no AI company holding a copy of your meetings. What does sync is your own backup.</>}
        >
          <PrivacyMap />
          <p className="mt-5 text-[0.85rem] text-ink-3 max-w-[48rem]">
            Honest exceptions: sign-in needs internet. The cloud backup holds encrypted transcript text, messages and titles, plus the
            search index, which is not encrypted. The key is shared by the install, so it protects against someone with only the database, not end-to-end.
          </p>
        </Section>
      </div>

      {/* ═══ ACCURACY ═══ */}
      <Section
        id="sources"
        title={<>Every answer shows its source.</>}
        intro={<>The model only sees passages from your recording and is told to say when the answer isn&apos;t there. Every answer comes with the passages it was given, so checking takes seconds instead of re-listening.</>}
      >
        <Grounding />
        <div className="mt-10 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-center">
          <div>
            <p className="t-title text-[1.4rem]">And when it isn&apos;t in the recording?</p>
            <p className="mt-3 text-[1rem] leading-relaxed text-ink-2">
              It says so instead of filling the gap with a confident guess from the internet. Local models can still make
              mistakes, which is exactly why the passages are always one click away.
            </p>
          </div>
          <NotFoundCard />
        </div>
      </Section>

      {/* ═══ MODELS ═══ */}
      <div className="bg-surface border-y border-line">
        <Section id="models" title={<>Pick the model that fits your Mac.</>} intro={<>Answers are written by a free, open model running locally. Switch any time from the sidebar.</>}>
          <div className="grid md:grid-cols-3 gap-4">
            {STOCK.map((m) => (
              <div key={m.id} className={`rounded-[20px] border p-6 ${m.recommended ? 'border-cobalt bg-cobalt-wash' : 'border-line bg-bg'}`}>
                <p className="flex items-center justify-between">
                  <span className="t-title text-[1.25rem]">{m.label}</span>
                  {m.recommended && <span className="rounded-full bg-lime text-on-lime text-[0.72rem] font-semibold px-2.5 py-1">Recommended</span>}
                </p>
                <p className="mt-2 text-[0.95rem] text-ink-2 leading-relaxed min-h-[3rem]">{m.note}</p>
                <p className="mt-5 flex items-center justify-between text-[0.82rem] text-ink-3">
                  <span className="t-num">{m.id}</span>
                  <span className="t-num rounded-full bg-surface border border-line px-2.5 py-1 text-ink">{m.size.toFixed(1)} GB download</span>
                </p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="max-w-[880px] mx-auto px-4 sm:px-8 py-20 md:py-28">
        <h2 className="t-display text-[clamp(2.3rem,5vw,3.75rem)]">Questions</h2>
        <div className="mt-10 flex flex-col gap-3">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group rounded-2xl bg-surface border border-line px-5">
              <summary className="list-none cursor-pointer flex items-center justify-between gap-6 py-5 font-semibold text-[1.05rem] [&::-webkit-details-marker]:hidden">
                {faq.question}
                <Plus className="w-5 h-5 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <p className="pb-5 pr-8 text-[1rem] leading-relaxed text-ink-2 max-w-[65ch]">{faq.answer}</p>
            </details>
          ))}
        </div>

        <div className="mt-16 rounded-[28px] bg-cobalt text-on-cobalt px-7 py-10 sm:px-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <p className="t-display text-[clamp(1.8rem,3.5vw,2.5rem)] max-w-[22rem]">Load a recording and ask it something.</p>
          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <DownloadMac variant="inverse" label="Download for Mac" />
            <button onClick={onLaunchApp} className="text-[0.9rem] text-on-cobalt/90 hover:text-on-cobalt underline underline-offset-4 cursor-pointer">
              or view your chats online
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <Wordmark className="text-[1.3rem]" />
          <p className="text-[0.85rem] text-ink-3">© 2026 Tell Me. Transcription by Whisper, answers by open models through Ollama.</p>
        </div>
      </footer>

      {/* Sign-in sheet */}
      {showAuth && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 rise-in"
          style={{ background: 'rgba(14, 17, 22, 0.45)' }}
          onClick={onCloseAuth}
          role="dialog"
          aria-modal="true"
          aria-label="Sign in"
        >
          <div className="relative w-full max-w-[420px]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onCloseAuth}
              aria-label="Close"
              className="absolute right-4 top-4 z-10 p-2 rounded-full text-ink-3 hover:text-ink hover:bg-sunk cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <Auth initialError={authError} />
          </div>
        </div>
      )}
    </div>
  );
}
