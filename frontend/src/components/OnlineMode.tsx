'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { CloudOff, LogOut, Moon, Sun, Loader2, Laptop } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { decryptText } from '../utils/crypto';
import { SpeechBars, Wordmark } from './ui/Brand';
import DownloadMac from './DownloadMac';
import { ENGINE_IS_SERVER } from '../utils/api';

interface CloudSession {
  id: string;
  session_title: string;
  created_at: string;
}

interface CloudMessage {
  id: string;
  sender: 'user' | 'assistant';
  message_text: string;
  created_at: string;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Website, signed in, without the local engine: read-only view of the conversations backed up
 * to the cloud. Rows are read with the user's own token, so database rules (RLS) only return theirs.
 * Recording, transcription and answers need the Mac app.
 */
export default function OnlineMode({ user, isDarkMode, onToggleTheme }: { user: User; isDarkMode: boolean; onToggleTheme: () => void }) {
  const [sessions, setSessions] = useState<CloudSession[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<CloudMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('sessions')
      .select('id, session_title, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) {
          setError('Couldn’t load your backed-up conversations. Check your connection and refresh.');
          setSessions([]);
          return;
        }
        setSessions((data as CloudSession[]) ?? []);
        if (data && data.length) setSelected((data[0] as CloudSession).id);
      });
    return () => { active = false; };
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    setMessages(null);
    const { data, error: err } = await supabase
      .from('chat_messages')
      .select('id, sender, message_text, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (err) {
      setError('Couldn’t load this conversation.');
      setMessages([]);
      return;
    }
    setMessages(((data as CloudMessage[]) ?? []).map((m) => ({ ...m, message_text: decryptText(m.message_text) })));
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    // Defer so the loading state isn't set synchronously inside the effect.
    const id = setTimeout(() => { if (active) loadMessages(selected); }, 0);
    return () => { active = false; clearTimeout(id); };
  }, [selected, loadMessages]);

  const current = sessions?.find((s) => s.id === selected);

  return (
    <div className="min-h-screen w-full bg-bg flex flex-col">
      <header className="sticky top-0 z-30 bg-surface border-b border-line">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Wordmark className="text-[1.5rem]" />
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-cobalt-wash text-cobalt px-3 py-1 text-[0.8rem] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-cobalt" /> View only
          </span>
          <div className="ml-auto flex items-center gap-2">
            <DownloadMac variant="nav" label="Get the Mac app" />
            <button onClick={onToggleTheme} aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'} className="p-2 rounded-lg text-ink-3 hover:text-ink hover:bg-sunk cursor-pointer">
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={() => supabase.auth.signOut()} aria-label="Sign out" title={`Sign out ${user.email ?? ''}`} className="p-2 rounded-lg text-ink-3 hover:text-danger hover:bg-sunk cursor-pointer">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 pt-6">
        <div className="rounded-[20px] bg-surface border border-line p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="w-11 h-11 shrink-0 rounded-2xl bg-cobalt-wash text-cobalt flex items-center justify-center"><Laptop className="w-5 h-5" /></span>
          <div className="flex-1">
            {ENGINE_IS_SERVER ? (
              <>
                <p className="font-semibold text-ink inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-cobalt" /> Connecting to the online engine…</p>
                <p className="text-[0.92rem] leading-relaxed text-ink-2">
                  The Tell Me server isn&apos;t answering right now (it may be restarting). This page switches to the full app by
                  itself as soon as it&apos;s back. Meanwhile you can read your saved conversations. Online mode needs internet; it does not work offline.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-ink">You&apos;re viewing your chats online</p>
                <p className="text-[0.92rem] leading-relaxed text-ink-2">
                  The website is view-only: you can read your saved chats from any device while you&apos;re online. To record, upload or
                  ask questions, use the Tell Me app. For now it&apos;s Mac only (Apple Silicon).
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-6 flex-1 grid md:grid-cols-[18rem_minmax(0,1fr)] gap-5">
        <nav aria-label="Backed-up conversations" className="rounded-[20px] bg-surface border border-line p-3 h-fit">
          <p className="px-2 pt-1 pb-2 text-[0.78rem] font-medium text-ink-3">Backed-up conversations</p>
          {sessions === null ? (
            <p className="flex items-center gap-2 px-2 py-3 text-[0.9rem] text-ink-3"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          ) : sessions.length === 0 ? (
            <div className="px-2 py-3">
              <SpeechBars count={18} seed={9} className="h-6 w-full mb-3" activeClass="bg-line-strong" />
              <p className="text-[0.9rem] leading-relaxed text-ink-3">Nothing backed up yet. Conversations from the Mac app appear here after they sync.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((s) => {
                const active = s.id === selected;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelected(s.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full text-left rounded-xl px-3 py-2 cursor-pointer ${active ? 'bg-cobalt-wash text-ink' : 'text-ink-2 hover:bg-bg hover:text-ink'}`}
                    >
                      <span className="block truncate text-[0.92rem] font-medium">{decryptText(s.session_title) || 'Untitled'}</span>
                      <span className="block text-[0.75rem] text-ink-3">{shortDate(s.created_at)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <section className="rounded-[20px] bg-surface border border-line flex flex-col min-h-[24rem]">
          {error && <p role="alert" className="m-5 mb-0 rounded-xl bg-danger-wash px-4 py-3 text-[0.9rem] text-danger">{error}</p>}
          {!current ? (
            <div className="flex-1 flex items-center justify-center p-10 text-center text-ink-3">
              {sessions && sessions.length === 0 ? 'Record something in the Mac app to get started.' : 'Choose a conversation.'}
            </div>
          ) : (
            <>
              <div className="px-6 py-4 border-b border-line">
                <h1 className="t-title text-[1.2rem]">{decryptText(current.session_title) || 'Untitled'}</h1>
                <p className="text-[0.8rem] text-ink-3">{shortDate(current.created_at)} · read-only backup</p>
              </div>
              <div className="flex-1 px-6 py-6 flex flex-col gap-5">
                {messages === null ? (
                  <p className="flex items-center gap-2 text-ink-3"><Loader2 className="w-4 h-4 animate-spin" /> Loading conversation…</p>
                ) : messages.length === 0 ? (
                  <p className="text-ink-3">No messages backed up for this conversation yet.</p>
                ) : (
                  messages.map((m) =>
                    m.sender === 'user' ? (
                      <p key={m.id} className="self-end max-w-[85%] rounded-[20px] rounded-br-md bg-ink text-bg px-4 py-2.5 whitespace-pre-line">{m.message_text}</p>
                    ) : (
                      <p key={m.id} className="self-start max-w-[90%] text-[1rem] leading-[1.7] text-ink whitespace-pre-line">{m.message_text}</p>
                    ),
                  )
                )}
              </div>
              <div className="border-t border-line px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <p className="inline-flex items-center gap-2 text-[0.88rem] text-ink-3">
                  <CloudOff className="w-4 h-4" /> {ENGINE_IS_SERVER ? 'You can ask new questions once the online engine is back.' : 'Asking new questions needs the Mac app.'}
                </p>
                <DownloadMac variant="nav" label="Download for Mac" />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
