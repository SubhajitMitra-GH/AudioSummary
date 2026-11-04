'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { ArrowDown, ArrowUp, Copy, Check, ChevronDown, Plus, X } from 'lucide-react';
import { ChatMessage } from '../utils/supabase';
import { ENGINE_PLACE, type Passage } from '../utils/api';
import { parseBlocks, InlineRun } from '../utils/richText';
import AudioRecorder from './AudioRecorder';
import { SpeechBars, Thinking } from './ui/Brand';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  currentSessionId: string | null;
  sessionTitle: string;
  onSendMessage: (text: string) => void;
  onIngestSuccess: (sessionId: string, transcript: string) => void;
  sending: boolean;
  /** Passages behind each answer, by message id (kept for this app session only). */
  sources: Record<string, Passage[]>;
}

const SUGGESTIONS = [
  'Summarize the key points',
  'List the decisions and action items',
  'What questions were left open?',
];

// Intro messages written after a recording is indexed (old and new wording).
const INTRO_MARKERS = ['indexing complete', 'Ingestion complete', 'Added new source', 'Transcribed and indexed', 'Added another recording'];
const isIntro = (m: ChatMessage) => m.sender === 'assistant' && INTRO_MARKERS.some((k) => m.message_text.includes(k));
const isError = (m: ChatMessage) => m.sender === 'assistant' && /^(Error:|Note:)/.test(m.message_text);

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) => (r.bold ? <strong key={i} className="font-semibold">{r.text}</strong> : <React.Fragment key={i}>{r.text}</React.Fragment>))}
    </>
  );
}

/** Answer text with paragraphs, lists and bold, rendered from data (never raw HTML). */
function RichText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b, i) => {
        if (b.type === 'h') return <p key={i} className="font-semibold pt-1"><Runs runs={b.runs} /></p>;
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type === 'ul' ? 'ul' : 'ol';
          return (
            <List key={i} className={`flex flex-col gap-1.5 pl-5 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-cobalt`}>
              {b.items.map((item, j) => <li key={j} className="pl-1"><Runs runs={item} /></li>)}
            </List>
          );
        }
        if (b.type !== 'p') return null;
        return (
          <p key={i}>
            {b.lines.map((line, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}<Runs runs={line} /></React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          // clipboard unavailable: nothing to do
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8rem] text-ink-3 hover:text-ink hover:bg-sunk cursor-pointer"
      aria-label="Copy answer"
    >
      {done ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function Sources({ passages }: { passages: Passage[] }) {
  const [open, setOpen] = useState(false);
  if (!passages.length) return null;
  const sorted = [...passages].sort((a, b) => a.score - b.score); // lower distance = closer match
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8rem] text-cobalt hover:bg-cobalt-wash cursor-pointer"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-cobalt" />
        {passages.length === 1 ? '1 passage searched' : `${passages.length} passages searched`}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="order-last basis-full mt-1 ml-2 grid gap-2 rise-in">
          {sorted.map((p) => (
            <li key={p.chunk_index} className="rounded-xl bg-surface border border-line px-4 py-3">
              <p className="t-num text-[0.72rem] text-ink-3 mb-1">Passage {p.chunk_index + 1}</p>
              <p className="text-[0.92rem] leading-relaxed text-ink-2 line-clamp-5">{p.content}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** The first message of a session: the transcript opening, collapsed when long. */
function IntroEntry({ message, onAsk, showSuggestions }: { message: ChatMessage; onAsk: (q: string) => void; showSuggestions: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = message.message_text.length > 700;
  return (
    <div className="rounded-[20px] bg-surface border border-line p-5 shadow-[var(--shadow-float)]">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-9 h-9 rounded-xl bg-cobalt-wash flex items-center justify-center shrink-0">
          <SpeechBars count={7} seed={4} className="h-4 w-5" />
        </span>
        <div>
          <p className="font-semibold text-[0.95rem]">Recording ready</p>
          <p className="text-[0.78rem] text-ink-3">Transcribed and indexed on {ENGINE_PLACE} · {time(message.created_at)}</p>
        </div>
      </div>
      <div className={`relative text-[0.98rem] leading-relaxed text-ink-2 ${long && !expanded ? 'max-h-44 overflow-hidden' : ''}`}>
        <RichText text={message.message_text} />
        {long && !expanded && (
          <div className="absolute inset-x-0 bottom-0 h-16" style={{ background: 'linear-gradient(transparent, var(--surface))' }} />
        )}
      </div>
      {long && (
        <button onClick={() => setExpanded(!expanded)} className="mt-2 text-[0.85rem] font-medium text-cobalt hover:underline cursor-pointer">
          {expanded ? 'Show less' : 'Show the full transcript'}
        </button>
      )}
      {showSuggestions && (
        <div className="mt-4 pt-4 border-t border-line flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onAsk(s)}
              className="rounded-full border border-line-strong px-3.5 py-1.5 text-[0.88rem] text-ink hover:border-cobalt hover:text-cobalt cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar() {
  return (
    <span className="w-8 h-8 shrink-0 rounded-full bg-cobalt flex items-center justify-center" aria-hidden="true">
      <span className="w-2 h-2 rounded-full bg-on-cobalt" />
    </span>
  );
}

export default function ChatInterface({
  messages,
  currentSessionId,
  sessionTitle,
  onSendMessage,
  onIngestSuccess,
  sending,
  sources,
}: ChatInterfaceProps) {
  const [inputText, setInputText] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const isLocked = !currentSessionId;
  const canSend = !isLocked && !sending && inputText.trim().length > 0;
  const hasQuestions = messages.some((m) => m.sender === 'user');

  const send = (text: string) => {
    if (!text.trim() || sending || isLocked) return;
    onSendMessage(text.trim());
    setInputText('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(inputText);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 180);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  // Grow the question box with its content (up to ~8 lines).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputText]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full bg-bg">
      {/* Conversation header: title + add another recording */}
      <div className="shrink-0 border-b border-line bg-surface">
        <div className="max-w-[50rem] mx-auto w-full px-4 sm:px-8 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="t-title text-[1.15rem] truncate">{sessionTitle}</h2>
            <p className="text-[0.8rem] text-ink-3 truncate">Answers come only from the recordings in this conversation.</p>
          </div>
          <button
            onClick={() => setShowAddSource(!showAddSource)}
            aria-expanded={showAddSource}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-1.5 text-[0.85rem] font-medium text-ink hover:border-cobalt hover:text-cobalt cursor-pointer"
          >
            {showAddSource ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAddSource ? 'Close' : 'Add recording'}
          </button>
        </div>
        {showAddSource && (
          <div className="max-w-[50rem] mx-auto w-full px-4 sm:px-8 pb-4 rise-in">
            <AudioRecorder
              variant="compact"
              currentSessionId={currentSessionId}
              onIngestSuccess={(id, transcript) => {
                setShowAddSource(false);
                onIngestSuccess(id, transcript);
              }}
            />
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto relative">
        <div className="max-w-[50rem] mx-auto w-full px-4 sm:px-8 py-8 flex flex-col gap-7">
          {messages.length === 0 && !sending ? (
            <div className="py-16 flex flex-col items-start gap-5">
              <h3 className="t-display text-[2.6rem]">Ask the recording.</h3>
              <p className="text-ink-2 max-w-[34rem] leading-relaxed">
                Answers come from what was said in this conversation&apos;s recordings, nothing else.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border border-line-strong px-3.5 py-1.5 text-[0.9rem] hover:border-cobalt hover:text-cobalt cursor-pointer">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => {
              if (message.sender === 'user') {
                return (
                  <div key={message.id} className="self-end max-w-[85%] flex flex-col items-end gap-1 rise-in">
                    <p className="rounded-[20px] rounded-br-md bg-ink text-bg px-4 py-2.5 text-[1rem] leading-relaxed whitespace-pre-line">{message.message_text}</p>
                    <span className="t-num text-[0.7rem] text-ink-3 pr-1">{time(message.created_at)}</span>
                  </div>
                );
              }
              if (isIntro(message)) {
                return (
                  <IntroEntry key={message.id} message={message} onAsk={send} showSuggestions={!hasQuestions && index === messages.length - 1} />
                );
              }
              if (isError(message)) {
                return (
                  <p key={message.id} role="alert" className="self-start rounded-xl bg-danger-wash text-danger px-4 py-3 text-[0.92rem] leading-relaxed">
                    {message.message_text.replace(/^(Error:|Note:)\s*/, '')}
                  </p>
                );
              }
              const passages = sources[message.id] ?? [];
              return (
                <div key={message.id} className="self-start w-full flex gap-3 rise-in">
                  <Avatar />
                  <div className="min-w-0 flex-1">
                    <div className="text-[1.02rem] leading-[1.7] text-ink pt-1">
                      <RichText text={message.message_text} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 -ml-2">
                      <Sources passages={passages} />
                      <CopyButton text={message.message_text} />
                      <span className="t-num text-[0.7rem] text-ink-3 px-2">{time(message.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {sending && (
            <div className="self-start flex items-center gap-3" aria-live="polite">
              <Avatar />
              <span className="inline-flex items-center gap-2.5 rounded-2xl bg-surface border border-line px-4 py-2.5 text-[0.92rem] text-ink-2">
                <Thinking /> Searching the recording on {ENGINE_PLACE}…
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to latest"
            className="sticky float-right bottom-5 mr-5 rounded-full p-2.5 bg-surface border border-line text-ink-2 hover:text-ink cursor-pointer shadow-[var(--shadow-float)]"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Question box */}
      <div className="shrink-0 bg-bg">
        <form onSubmit={handleSubmit} className="max-w-[50rem] mx-auto w-full px-4 sm:px-8 pb-5 pt-2">
          <div className="flex items-end gap-3 rounded-[22px] border border-line bg-surface focus-within:border-cobalt pl-5 pr-2 py-2 shadow-[var(--shadow-float)]">
            <label htmlFor="question" className="sr-only">Ask a question about the recording</label>
            <textarea
              id="question"
              ref={inputRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(inputText);
                }
              }}
              disabled={isLocked || sending}
              placeholder={isLocked ? 'Choose a conversation first' : 'Ask about what was said…'}
              className="flex-1 resize-none bg-transparent py-2 text-[1rem] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Ask"
              className="shrink-0 w-10 h-10 rounded-full inline-flex items-center justify-center cursor-pointer bg-cobalt text-on-cobalt hover:bg-cobalt-hover disabled:bg-sunk disabled:text-ink-3 disabled:cursor-not-allowed"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          </div>
          <p className="mt-2 text-center text-[0.75rem] text-ink-3">
            Enter to ask · Shift+Enter for a new line · Local models can be wrong, so check the passages
          </p>
        </form>
      </div>
    </div>
  );
}
