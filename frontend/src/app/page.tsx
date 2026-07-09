'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import ChatInterface from '../components/ChatInterface';
import AudioRecorder from '../components/AudioRecorder';
import { supabase, Session, ChatMessage } from '../utils/supabase';
import { encryptText, decryptText } from '../utils/crypto';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Auth from '../components/Auth';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // 1. Get/Listen to auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchSessions = async () => {
    if (!user) return;
    setLoadingSessions(true);
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSessions(data || []);
    } catch (e) {
      console.error('Failed to fetch sessions:', e);
    } finally {
      setLoadingSessions(false);
    }
  };

  const fetchMessages = useCallback(async (sessionId: string) => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages((data || []).map((msg: any) => ({ ...msg, message_text: decryptText(msg.message_text) })));
    } catch (e) {
      console.error('Failed to fetch messages:', e);
    }
  }, []);

  // 2. Fetch sessions when authenticated user changes
  useEffect(() => {
    if (user) {
      fetchSessions();
    } else {
      setSessions([]);
      setCurrentSessionId(null);
    }
  }, [user]);

  useEffect(() => {
    if (currentSessionId) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId, fetchMessages]);

  const handleSelectSession = (id: string) => setCurrentSessionId(id);
  const handleCreateNewSession = () => setCurrentSessionId(null);

  const handleIngestSuccess = async (sessionId: string, transcript: string) => {
    const isExisting = sessions.some(s => s.id === sessionId);

    if (isExisting) {
      try {
        const appendText = transcript
          ? `Added new source to workspace transcript:\n\n"${transcript}"\n\nYou can query information across all uploaded audio files in this session.`
          : `Audio source added, no speech recognized in the stream.`;
        const { error } = await supabase.from('chat_messages').insert({
          id: crypto.randomUUID(),
          session_id: sessionId,
          sender: 'assistant',
          message_text: encryptText(appendText)
        });
        if (error) throw error;
        await fetchMessages(sessionId);
      } catch (e) {
        console.error('Failed to insert append status:', e);
      }
      return;
    }

    const rawTitle = `Session ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    try {
      const { error: sErr } = await supabase.from('sessions').insert({
        id: sessionId,
        session_title: encryptText(rawTitle),
        user_id: user?.id
      });
      if (sErr) throw sErr;
      await fetchSessions();
      setCurrentSessionId(sessionId);
      
      const introText = transcript
        ? `RAG indexing complete. Transcript excerpt:\n\n"${transcript}"\n\nAsk questions about the recording details, statements, or timelines.`
        : `Ingestion complete. No vocal speech was detected in the audio.`;
      const { error: mErr } = await supabase.from('chat_messages').insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        sender: 'assistant',
        message_text: encryptText(introText)
      });
      if (mErr) throw mErr;
      await fetchMessages(sessionId);
    } catch (e) {
      console.error('Failed to initialize session:', e);
      alert('Failed to sync session with cloud database.');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!currentSessionId || sendingMessage) return;
    setSendingMessage(true);
    const uid = crypto.randomUUID();
    setMessages(prev => [
      ...prev,
      { id: uid, session_id: currentSessionId, sender: 'user', message_text: text, created_at: new Date().toISOString() }
    ]);
    try {
      await supabase.from('chat_messages').insert({
        id: uid,
        session_id: currentSessionId,
        sender: 'user',
        message_text: encryptText(text)
      });
    } catch {}

    try {
      const { data: { session: sAuth } } = await supabase.auth.getSession();
      const token = sAuth?.access_token;

      const res = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ question: text, audio_id: currentSessionId }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const aid = crypto.randomUUID();
      try {
        await supabase.from('chat_messages').insert({
          id: aid,
          session_id: currentSessionId,
          sender: 'assistant',
          message_text: encryptText(data.answer)
        });
      } catch {}
      setMessages(prev => [
        ...prev,
        { id: aid, session_id: currentSessionId, sender: 'assistant', message_text: data.answer, created_at: new Date().toISOString() }
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          session_id: currentSessionId,
          sender: 'assistant',
          message_text: 'Error: Could not retrieve answer from local RAG server. Make sure Python app.main is running.',
          created_at: new Date().toISOString()
        }
      ]);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      // Delete child messages first to satisfy database constraints
      await supabase.from('chat_messages').delete().eq('session_id', id);
      const { error } = await supabase.from('sessions').delete().eq('id', id);
      if (error) throw error;
      
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
      alert('Failed to delete session.');
    }
  };

  const handleRenameSession = async (id: string, newTitle: string) => {
    try {
      const encrypted = encryptText(newTitle);
      const { error } = await supabase.from('sessions').update({ session_title: encrypted }).eq('id', id);
      if (error) throw error;
      setSessions(prev => prev.map(s => s.id === id ? { ...s, session_title: encrypted } : s));
    } catch (e) {
      console.error('Failed to rename session:', e);
      alert('Failed to rename session.');
    }
  };

  const activeTitle = (() => {
    if (!currentSessionId) return 'Workspace Ingest';
    const s = sessions.find(s => s.id === currentSessionId);
    return s ? (decryptText(s.session_title) || 'Untitled') : 'Workspace Chat';
  })();

  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#f4f6fc]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1a237e] flex items-center justify-center shadow-md animate-pulse">
            <span className="text-white text-lg font-bold">✨</span>
          </div>
          <span className="text-xs font-semibold text-slate-400">Restoring active session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <main className="h-screen w-screen flex overflow-hidden screenshot-bg">
      {/* Sidebar navigation */}
      <div
        className={`h-full overflow-hidden transition-all duration-300 ease-in-out shrink-0 ${
          isSidebarOpen ? 'w-72 border-r border-slate-200' : 'w-0'
        }`}
      >
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onCreateNewSession={handleCreateNewSession}
          loading={loadingSessions}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
        />
      </div>

      {/* Main app space */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-14 border-b border-slate-200/80 bg-white px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 border border-slate-200 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-all cursor-pointer"
            >
              {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <span className="text-xs font-semibold text-slate-800 tracking-tight truncate max-w-[320px]">
              {activeTitle}
            </span>
          </div>
        </header>

        {/* Dynamic content view */}
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
          {currentSessionId === null ? (
            <div className="w-full h-full overflow-y-auto flex items-center justify-center p-6 screenshot-bg">
              <AudioRecorder
                onIngestSuccess={handleIngestSuccess}
                currentSessionId={currentSessionId}
                variant="landing"
              />
            </div>
          ) : (
            <ChatInterface
              messages={messages}
              currentSessionId={currentSessionId}
              onSendMessage={handleSendMessage}
              sending={sendingMessage}
            />
          )}
        </div>
      </div>
    </main>
  );
}
