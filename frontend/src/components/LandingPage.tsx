'use client';

import React, { useState } from 'react';
import { AudioLines, Shield, Cpu, CloudLightning, ArrowRight, HelpCircle, ChevronDown, X } from 'lucide-react';
import Auth from './Auth';

interface LandingPageProps {
  onLaunchApp: () => void;
  showAuth: boolean;
  onCloseAuth: () => void;
}

export default function LandingPage({ onLaunchApp, showAuth, onCloseAuth }: LandingPageProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  const faqs = [
    {
      question: "Is my audio or transcript ever sent to a cloud server?",
      answer: "Your audio files never leave your computer: transcription, search and AI answers all run locally. So you can restore your work on another device, transcripts, chat messages and session titles are encrypted and backed up to the cloud (Supabase), together with the search index used to find relevant passages."
    },
    {
      question: "Can I use the application offline?",
      answer: "Mostly. Recording, transcription, search and chat all run on your computer. You need an internet connection to sign in, and after a longer time offline you may need to reconnect so your sign-in can be refreshed. YouTube and web links of course need internet."
    },
    {
      question: "Are there any usage limits or query tokens I have to pay for?",
      answer: "No. Since the models run locally on your own computer using Ollama, it is completely free with unlimited queries, transcriptions, and database sizes."
    },
    {
      question: "How does the cloud synchronization work?",
      answer: "The application is local-first. Sessions, messages and transcripts are saved in a local database first. Each time you sign in, and whenever your connection comes back, queued changes are backed up to Supabase so you can restore them on other devices."
    }
  ];

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans relative overflow-x-hidden selection:bg-violet-500/10 selection:text-[#6c3beb] scroll-smooth">

      {/* 1. HERO SECTION (Dark to Violet Gradient Transition) */}
      <section className="w-full bg-gradient-to-b from-[#05060f] via-[#1a0c3b] via-[#6c3beb] to-white pt-6 pb-24 relative overflow-hidden flex flex-col items-center text-center">

        {/* Glow grid lines overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        {/* Floating background glowing orb */}
        <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-violet-500/20 blur-[100px] pointer-events-none" />

        {/* Navbar */}
        <div className="w-full max-w-7xl mx-auto px-6 h-16 flex items-center justify-between z-20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#6c3beb] flex items-center justify-center shadow-lg shadow-violet-900/30">
              <AudioLines className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold tracking-tight text-white text-sm">Tell Me.</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-xs font-semibold text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>

          <button
            onClick={onLaunchApp}
            className="px-5 py-2 rounded-full border border-slate-700 bg-[#05060f]/60 backdrop-blur-sm text-xs font-bold text-white hover:bg-white hover:text-slate-950 hover:border-white transition-all cursor-pointer active:scale-95"
          >
            Launch App
          </button>
        </div>

        {/* Hero Content */}
        <div className="max-w-7xl mx-auto px-6 pt-20 flex flex-col items-center z-10 relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-violet-200 text-[10px] font-bold uppercase tracking-widest mb-6">
            <Shield className="w-3.5 h-3.5 text-[#a855f7]" /> 100% Local-first Processing
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight max-w-4xl leading-[1.1] text-white">
            Crafting audio intelligence <br />
            <span className="text-violet-200/60 font-semibold font-sans">through offline RAG</span>
          </h1>

          {/* Avatar circles overlay */}
          <div className="flex items-center -space-x-2 mt-6">
            <div className="w-8 h-8 rounded-full border-2 border-[#1a0c3b] bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white">🎙️</div>
            <div className="w-8 h-8 rounded-full border-2 border-[#1a0c3b] bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white">🔒</div>
            <div className="w-8 h-8 rounded-full border-2 border-[#1a0c3b] bg-slate-800 flex items-center justify-center text-[10px] font-bold text-white">💻</div>
          </div>

          <p className="text-xs md:text-sm text-slate-300 font-medium max-w-xl mt-6 leading-relaxed">
            Record or import audio, search vector embeddings, and generate summaries with AI that runs on your own computer.
          </p>

          <div className="flex items-center gap-4 mt-8">
            <button
              onClick={onLaunchApp}
              className="px-7 py-3 bg-[#6c3beb] hover:bg-[#5a2dd4] text-white rounded-full font-bold text-xs flex items-center gap-2 shadow-lg shadow-violet-600/30 cursor-pointer active:scale-95 transition-all"
            >
              Get Started Free <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* 2. CARD SECTION (Boundary between gradient and white section) */}
      <section id="features" className="max-w-7xl mx-auto px-6 -mt-16 pb-16 relative z-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Card 1 */}
          <div className="rounded-3xl border border-slate-200/60 bg-white/95 p-8 flex flex-col gap-4 shadow-[0_15px_40px_rgba(108,59,235,0.06)] hover:shadow-[0_20px_50px_rgba(108,59,235,0.1)] transition-all">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Local-First AI</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Transcribe audio files and query vector databases locally using Whisper and Ollama models. Your audio is never sent to an AI service.
            </p>
          </div>

          {/* Card 2 */}
          <div className="rounded-3xl border border-slate-200/60 bg-white/95 p-8 flex flex-col gap-4 shadow-[0_15px_40px_rgba(108,59,235,0.06)] hover:shadow-[0_20px_50px_rgba(108,59,235,0.1)] transition-all">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-[#6c3beb]">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Encrypted Cloud Backups</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Transcripts, messages and session titles are encrypted before they are backed up, and database access rules keep each account&apos;s data separate.
            </p>
          </div>

          {/* Card 3 */}
          <div className="rounded-3xl border border-slate-200/60 bg-white/95 p-8 flex flex-col gap-4 shadow-[0_15px_40px_rgba(108,59,235,0.06)] hover:shadow-[0_20px_50px_rgba(108,59,235,0.1)] transition-all">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-600">
              <CloudLightning className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Event-Driven Sync</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Your browser registers a native online listener. Offline updates queue in Redis locally and sync instantly to the cloud the moment connection returns.
            </p>
          </div>
        </div>
      </section>

      {/* 3. FAQ ACCORDION (Pure White Background Section) */}
      <section id="faq" className="max-w-4xl mx-auto px-6 py-20 relative z-10">
        <div className="text-center mb-16 flex flex-col items-center gap-2">
          <HelpCircle className="w-8 h-8 text-[#6c3beb]" />
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-950 mt-2">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="flex flex-col gap-4">
          {faqs.map((faq, index) => {
            const isOpen = activeFaq === index;
            return (
              <div
                key={index}
                className="rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 overflow-hidden transition-all"
              >
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left font-bold text-sm text-slate-800 cursor-pointer"
                >
                  <span>{faq.question}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="px-6 pb-6 text-xs text-slate-500 leading-relaxed border-t border-slate-200/50 pt-4 bg-white font-medium">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. FOOTER (Pure White Background Section) */}
      <footer className="w-full border-t border-slate-200/80 py-10 relative z-10 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AudioLines className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-400">© 2026 Tell Me. All rights reserved.</span>
          </div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Privacy First Database
          </span>
        </div>
      </footer>

      {/* Auth Modal Overlay */}
      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md animate-fade-in px-4">
          <div className="relative w-full max-w-[420px]">
            {/* Close button positioned cleanly inside the card's top-right corner */}
            <button
              onClick={onCloseAuth}
              title="Close Panel"
              className="absolute right-6 top-6 z-50 p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-transform cursor-pointer active:scale-90"
            >
              <X className="w-4 h-4" />
            </button>
            <Auth />
          </div>
        </div>
      )}
    </div>
  );
}
