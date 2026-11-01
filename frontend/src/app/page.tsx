'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import ChatInterface from '../components/ChatInterface';
import AudioRecorder from '../components/AudioRecorder';
import LandingPage from '../components/LandingPage';
import OllamaSetupWizard from '../components/OllamaSetupWizard';
import { supabase, Session, ChatMessage } from '../utils/supabase';
import { encryptText, decryptText } from '../utils/crypto';
import { API_BASE, apiFetch, readErrorDetail } from '../utils/api';
import { PanelLeftClose, PanelLeftOpen, AudioLines } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

type OllamaStatus = {
  ollama_running: boolean;
  model_pulled: boolean;
  configured_model: string;
};

function LoadingSkeleton({ title, status }: { title: string; status: string }) {
  return (
    <div className="h-screen w-screen flex overflow-hidden select-none" style={{ background: 'var(--bg-surface)' }}>
      {/* Sidebar Skeleton */}
      <div className="w-72 h-full p-6 flex flex-col gap-6 shrink-0"
        style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg animate-pulse" style={{ background: 'var(--skeleton-bg)' }} />
          <div className="h-4 w-24 rounded animate-pulse" style={{ background: 'var(--skeleton-bg)' }} />
        </div>
        <div className="w-full h-9 rounded-full animate-pulse mt-2" style={{ background: 'var(--skeleton-bg)', opacity: 0.6 }} />
        <div className="flex-1 flex flex-col gap-4 mt-6">
          <div className="h-8 w-[85%] rounded-lg animate-pulse" style={{ background: 'var(--skeleton-bg)', opacity: 0.8 }} />
          <div className="h-8 w-[70%] rounded-lg animate-pulse" style={{ background: 'var(--skeleton-bg)', opacity: 0.5 }} />
          <div className="h-8 w-[90%] rounded-lg animate-pulse" style={{ background: 'var(--skeleton-bg)', opacity: 0.5 }} />
          <div className="h-8 w-[60%] rounded-lg animate-pulse" style={{ background: 'var(--skeleton-bg)', opacity: 0.3 }} />
        </div>
      </div>
      {/* Main Workspace Skeleton */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="h-14 px-6 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded animate-pulse" style={{ background: 'var(--skeleton-bg)' }} />
            <div className="h-4 w-px" style={{ background: 'var(--border)' }} />
            <div className="h-3 w-32 rounded animate-pulse" style={{ background: 'var(--skeleton-bg)' }} />
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4"
          style={{ background: 'var(--bg-primary)' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center animate-bounce shadow-sm"
            style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}>
            <AudioLines className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-base font-bold tracking-tight mt-2" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <p className="text-xs font-semibold max-w-sm leading-relaxed animate-pulse" style={{ color: 'var(--text-muted)' }}>
            {status}
          </p>
        </div>
      </div>
    </div>
  );
}

function localNote(sessionId: string, text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    session_id: sessionId,
    sender: 'assistant',
    message_text: text,
    created_at: new Date().toISOString(),
    synced: true,
  };
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState<boolean>(true);
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // State to manage the Auth modal visibility on the landing page
  const [showAuth, setShowAuth] = useState<boolean>(false);

  // Dark mode state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved === 'dark' || (!saved && prefersDark);
    setIsDarkMode(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const next = !isDarkMode;
    setIsDarkMode(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  // States to manage local API startup checks
  const [isBackendReady, setIsBackendReady] = useState<boolean>(false);
  const [backendStatus, setBackendStatus] = useState<string>('Initializing...');

  // State to check Ollama and local model installation status
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  // Keep a mutable reference to the active session ID to avoid trigger re-runs inside event listeners
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Keep track of the last fetched user ID to prevent redundant re-fetching on focus validation
  const lastFetchedUserIdRef = useRef<string | null>(null);

  // Keep track of the last synced user ID to prevent redundant synchronization on focus validation
  const lastSyncedUserIdRef = useRef<string | null>(null);

  // 0. Startup Health Check: Ping the FastAPI backend /health endpoint
  useEffect(() => {
    let active = true;

    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'healthy') {
            if (active) {
              setIsBackendReady(true);
              setBackendStatus('Connected');
            }
            return;
          }
        }
        if (active) {
          setBackendStatus('Redis connection startup in progress...');
          setTimeout(checkHealth, 1500);
        }
      } catch {
        if (active) {
          setBackendStatus('Waiting for local audio summarization engines to boot...');
          setTimeout(checkHealth, 1500);
        }
      }
    };

    checkHealth();
    return () => {
      active = false;
    };
  }, []);

  const checkOllamaStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ollama/status`);
      if (res.ok) {
        setOllamaStatus(await res.json());
      }
    } catch (err) {
      console.error('Failed to check Ollama status:', err);
    }
  }, []);

  useEffect(() => {
    if (isBackendReady) {
      checkOllamaStatus();
    }
  }, [isBackendReady, checkOllamaStatus]);

  // 1. Get/Listen to auth state (ONLY after backend is ready)
  useEffect(() => {
    if (!isBackendReady) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [isBackendReady]);

  const fetchSessions = useCallback(async () => {
    if (!user) return;
    const attempt = async (retryCount: number) => {
      setLoadingSessions(true);
      try {
        // Fetch from local-first mediator backend API
        const res = await apiFetch('/sessions');
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        setSessions(data || []);
      } catch (e) {
        console.error('Failed to fetch sessions:', e);
        // Auto-retry on connection failures (e.g. backend starting up)
        if (e instanceof TypeError && retryCount < 10) {
          setTimeout(() => attempt(retryCount + 1), 2000);
        }
      } finally {
        setLoadingSessions(false);
      }
    };
    await attempt(0);
  }, [user]);

  const fetchMessages = useCallback(async (sessionId: string) => {
    const attempt = async (retryCount: number) => {
      try {
        // Fetch messages from local-first mediator backend API
        const res = await apiFetch(`/sessions/${sessionId}/messages`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data: ChatMessage[] = await res.json();
        setMessages((data || []).map((msg) => ({ ...msg, message_text: decryptText(msg.message_text) })));
      } catch (e) {
        console.error('Failed to fetch messages:', e);
        // Auto-retry on connection failures
        if (e instanceof TypeError && retryCount < 10) {
          setTimeout(() => attempt(retryCount + 1), 2000);
        }
      }
    };
    await attempt(0);
  }, []);

  /** Encrypt and store one message. Throws if the backend did not save it. */
  const saveMessage = useCallback(async (msg: ChatMessage) => {
    const res = await apiFetch('/messages', {
      method: 'POST',
      body: JSON.stringify({
        id: msg.id,
        session_id: msg.session_id,
        sender: msg.sender,
        message_text: encryptText(msg.message_text),
        created_at: msg.created_at,
      }),
    });
    if (!res.ok) throw new Error(await readErrorDetail(res));
  }, []);

  // 2. Fetch sessions initially when user logs in
  useEffect(() => {
    if (user) {
      if (lastFetchedUserIdRef.current !== user.id) {
        lastFetchedUserIdRef.current = user.id;
        fetchSessions();
      }
    } else {
      lastFetchedUserIdRef.current = null;
      setSessions([]);
      setCurrentSessionId(null);
    }
  }, [user, fetchSessions]);

  // 3. Configure browser online reconnect sync listener (triggered ONLY on reconnect, NOT on sidebar navigation)
  useEffect(() => {
    if (!user) {
      lastSyncedUserIdRef.current = null;
      return;
    }

    const handleOnlineSync = async (retryCount = 0) => {
      try {
        const res = await apiFetch('/sync', { method: 'POST' });
        if (!res.ok) throw new Error(await readErrorDetail(res));
        fetchSessions();
        const activeSessionId = currentSessionIdRef.current;
        if (activeSessionId) {
          fetchMessages(activeSessionId);
        }
      } catch (err) {
        console.error('Failed to trigger automatic sync:', err);
        // Auto-retry on connection failures
        if (err instanceof TypeError && retryCount < 10) {
          setTimeout(() => handleOnlineSync(retryCount + 1), 2000);
        }
      }
    };

    // Trigger sync once on mount/user login changes
    if (lastSyncedUserIdRef.current !== user.id) {
      lastSyncedUserIdRef.current = user.id;
      handleOnlineSync();
    }

    const onOnlineEvent = () => {
      handleOnlineSync(0);
    };

    window.addEventListener('online', onOnlineEvent);
    return () => {
      window.removeEventListener('online', onOnlineEvent);
    };
  }, [user, fetchSessions, fetchMessages]);

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
    // Check if messages already exist in this session to see if it's an existing workspace
    let isExisting = false;
    try {
      const res = await apiFetch(`/sessions/${sessionId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) isExisting = true;
      }
    } catch (err) {
      console.error('Error checking message count:', err);
    }

    const text = isExisting
      ? (transcript
        ? `Added new source to workspace transcript:\n\n"${transcript}"\n\nYou can query information across all uploaded audio files in this session.`
        : `Audio source added, no speech recognized in the stream.`)
      : (transcript
        ? `RAG indexing complete. Transcript excerpt:\n\n"${transcript}"\n\nAsk questions about the recording details, statements, or timelines.`
        : `Ingestion complete. No vocal speech was detected in the audio.`);

    try {
      if (!isExisting) {
        await fetchSessions();
        setCurrentSessionId(sessionId);
      }
      await saveMessage({
        id: crypto.randomUUID(),
        session_id: sessionId,
        sender: 'assistant',
        message_text: text,
        created_at: new Date().toISOString(),
      });
      await fetchMessages(sessionId);
    } catch (e) {
      console.error('Failed to initialize session:', e);
      alert('The audio was indexed, but the summary message could not be saved.');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!currentSessionId || sendingMessage) return;
    const sessionId = currentSessionId;
    setSendingMessage(true);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      sender: 'user',
      message_text: text,
      created_at: new Date().toISOString(),
      synced: false,
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      // 1. Save user message to backend local-first endpoint
      await saveMessage(userMessage);

      // 2. Query RAG backend (which searches local Redis vector store)
      const res = await apiFetch('/chat', {
        method: 'POST',
        body: JSON.stringify({ question: text, audio_id: sessionId }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data = await res.json();

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        sender: 'assistant',
        message_text: data.answer,
        created_at: new Date().toISOString(),
        synced: false,
      };
      setMessages(prev => [...prev, assistantMessage]);

      // 3. Save assistant response to backend local-first endpoint
      try {
        await saveMessage(assistantMessage);
        fetchMessages(sessionId); // Refresh message list to update sync indicators
      } catch (saveErr) {
        console.error('Failed to save answer:', saveErr);
        setMessages(prev => [...prev, localNote(sessionId,
          'Note: this answer could not be saved and will not appear when you reopen this conversation.')]);
      }
    } catch (e) {
      console.error('Error during chat:', e);
      const reason = e instanceof TypeError
        ? 'Could not reach the local server. Make sure the backend is running.'
        : (e instanceof Error ? e.message : 'Unknown error.');
      setMessages(prev => [...prev, localNote(sessionId, `Error: ${reason}`)]);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      // Call mediator backend API to delete from local Redis and trigger background Supabase delete
      const res = await apiFetch(`/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readErrorDetail(res));

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
      const res = await apiFetch(`/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ session_title: encryptText(newTitle) }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const updated: Session = await res.json();
      setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updated } : s));
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

  if (!isBackendReady) {
    return <LoadingSkeleton title="Initializing Workspace Environment" status={backendStatus} />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md animate-pulse" style={{ background: 'var(--accent)' }}>
            <span className="text-lg font-bold" style={{ color: 'var(--text-on-accent)' }}>✨</span>
          </div>
          <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Restoring active session...</span>
        </div>
      </div>
    );
  }

  // Display the landing page if the user is not authenticated.
  // Sign-in comes before the Ollama setup because installing/pulling requires a signed-in user.
  if (!user) {
    return (
      <LandingPage
        onLaunchApp={() => setShowAuth(true)}
        showAuth={showAuth}
        onCloseAuth={() => setShowAuth(false)}
      />
    );
  }

  if (ollamaStatus === null) {
    return <LoadingSkeleton title="Checking Local AI Engines" status="Verifying model config status..." />;
  }

  if (!ollamaStatus.ollama_running || !ollamaStatus.model_pulled) {
    return (
      <OllamaSetupWizard
        status={ollamaStatus}
        onComplete={checkOllamaStatus}
      />
    );
  }

  return (
    <main className="h-screen w-screen flex overflow-hidden app-bg">
      {/* Sidebar navigation */}
      <div
        className={`h-full overflow-hidden transition-all duration-300 ease-in-out shrink-0 ${
          isSidebarOpen ? 'w-72' : 'w-0'
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
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
        />
      </div>

      {/* Main app space */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-14 px-6 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 rounded-lg transition-all cursor-pointer"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            <div className="h-4 w-px" style={{ background: 'var(--border)' }} />
            <span className="text-xs font-semibold tracking-tight truncate max-w-[320px]"
              style={{ color: 'var(--text-primary)' }}>
              {activeTitle}
            </span>
          </div>
        </header>

        {/* Dynamic content view */}
        <div className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--bg-surface)' }}>
          {currentSessionId === null ? (
            <div className="w-full h-full overflow-y-auto flex items-center justify-center p-6 app-bg">
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
