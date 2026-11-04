'use client';

import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import Sidebar from '../components/Sidebar';
import ChatInterface from '../components/ChatInterface';
import AudioRecorder from '../components/AudioRecorder';
import LandingPage from '../components/LandingPage';
import OllamaSetupWizard from '../components/OllamaSetupWizard';
import SetNewPassword from '../components/SetNewPassword';
import DesktopSignIn from '../components/DesktopSignIn';
import OnlineMode from '../components/OnlineMode';
import { isDesktopApp } from '../utils/platform';
import {
  supabase, Session, ChatMessage,
  subscribeAuthLinkError, getAuthLinkError, getAuthLinkErrorServer,
  subscribePasswordRecovery, getPasswordRecovery, getPasswordRecoveryServer,
} from '../utils/supabase';
import { encryptText, decryptText } from '../utils/crypto';
import { API_BASE, ENGINE_IS_SERVER, ENGINE_PLACE, apiFetch, canReachLocalEngine, readErrorDetail, ModelOption, ModelsResponse, Passage } from '../utils/api';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { SpeechBars, Wordmark } from '../components/ui/Brand';
import type { User } from '@supabase/supabase-js';
import { newId } from '../utils/ids';

type OllamaStatus = {
  ollama_running: boolean;
  model_pulled: boolean;
  configured_model: string;
};

/** Full-screen state used while local services start. */
function MachineLoading({ title, status }: { title: string; status: string }) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 px-6 select-none bg-bg">
      <Wordmark className="text-[2.2rem]" />
      <SpeechBars count={36} seed={17} breathing className="h-12 w-[min(320px,70vw)]" activeClass="bg-cobalt" />
      <div className="text-center flex flex-col items-center gap-1.5" aria-live="polite">
        <p className="text-[1.05rem] font-medium text-ink">{title}</p>
        <p className="text-[0.9rem] text-ink-3 max-w-sm">{status}</p>
      </div>
    </div>
  );
}

/** The desktop marker never changes after load, so there is nothing to subscribe to. */
const subscribeNothing = () => () => {};

function localNote(sessionId: string, text: string): ChatMessage {
  return {
    id: newId(),
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
  // Passages behind each answer, by message id. Not stored: they show for answers given in this app session.
  const [sources, setSources] = useState<Record<string, Passage[]>>({});

  // State to manage the Auth modal visibility on the landing page.
  // Opened straight away when the app was launched from an expired/invalid email link.
  const [showAuth, setShowAuth] = useState<boolean>(() => Boolean(getAuthLinkError()));
  // Error from a reset link (website: in the URL; Mac app: a tellme:// link that arrives later).
  const authLink = useSyncExternalStore(subscribeAuthLinkError, getAuthLinkError, getAuthLinkErrorServer);

  // True while the user is choosing a new password after a "forgot password" link or code.
  const recoveringPassword = useSyncExternalStore(subscribePasswordRecovery, getPasswordRecovery, getPasswordRecoveryServer);

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
  const [backendStatus, setBackendStatus] = useState<string>(ENGINE_IS_SERVER ? 'Connecting to the online engine…' : 'Starting the local engine…');
  // Web only: the local engine (FastAPI on this computer) didn't answer, so offer online mode.
  const [engineOffline, setEngineOffline] = useState<boolean>(false);

  // Inside the Mac app (Electron preload sets window.tellme). Server render assumes the website.
  const desktop = useSyncExternalStore(subscribeNothing, isDesktopApp, () => false);
  // False on the hosted website: there is no engine to look for, so signed-in users get online mode at once.
  const engineReachable = useSyncExternalStore(subscribeNothing, canReachLocalEngine, () => true);

  // State to check Ollama and local model installation status
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  // Local AI models the user can choose from
  const [models, setModels] = useState<ModelOption[]>([]);

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
    if (!canReachLocalEngine()) return; // hosted website: never probe the visitor's 127.0.0.1

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
          setBackendStatus(ENGINE_IS_SERVER ? 'Starting the online engine…' : 'Starting the local database…');
          setTimeout(checkHealth, 1500);
        }
      } catch {
        if (active) {
          setBackendStatus('Starting transcription and search on this Mac… The first launch after installing can take a couple of minutes.');
          // In a browser the engine may simply not be installed: offer online mode, keep checking slowly.
          if (!isDesktopApp()) setEngineOffline(true);
          setTimeout(checkHealth, isDesktopApp() ? 1500 : 5000);
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

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/models`);
      if (res.ok) {
        const data: ModelsResponse = await res.json();
        setModels(data.models);
      }
    } catch (err) {
      console.error('Failed to load AI models:', err);
    }
  }, []);

  useEffect(() => {
    if (isBackendReady) {
      checkOllamaStatus();
      fetchModels();
    }
  }, [isBackendReady, checkOllamaStatus, fetchModels]);

  /** Switch the AI model used for answers. Throws if the backend refuses. */
  const selectModel = useCallback(async (modelId: string) => {
    const res = await apiFetch('/models/active', {
      method: 'PUT',
      body: JSON.stringify({ model: modelId }),
    });
    if (!res.ok) throw new Error(await readErrorDetail(res));
    const data: ModelsResponse = await res.json();
    setModels(data.models);
    // If the new model isn't downloaded yet, this shows the setup screen with a download button.
    await checkOllamaStatus();
  }, [checkOllamaStatus]);

  const refreshModelsAndStatus = useCallback(async () => {
    await Promise.all([checkOllamaStatus(), fetchModels()]);
  }, [checkOllamaStatus, fetchModels]);

  const handleSidebarModelChange = async (modelId: string) => {
    try {
      await selectModel(modelId);
    } catch (e) {
      console.error('Failed to switch model:', e);
      alert(`Could not switch model: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  };

  // 1. Get/Listen to auth state (doesn't need the local engine)
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
      if (!isBackendReady) return; // online mode reads the cloud directly
      if (lastFetchedUserIdRef.current !== user.id) {
        lastFetchedUserIdRef.current = user.id;
        fetchSessions();
      }
    } else {
      lastFetchedUserIdRef.current = null;
      setSessions([]);
      setCurrentSessionId(null);
    }
  }, [user, fetchSessions, isBackendReady]);

  // 3. Configure browser online reconnect sync listener (triggered ONLY on reconnect, NOT on sidebar navigation)
  useEffect(() => {
    if (!user) {
      lastSyncedUserIdRef.current = null;
      return;
    }
    if (!isBackendReady) return;

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
  }, [user, fetchSessions, fetchMessages, isBackendReady]);

  useEffect(() => {
    if (currentSessionId) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId, fetchMessages]);

  // On narrow windows the sidebar overlays the content, so tuck it away after a choice.
  const closeSidebarIfNarrow = () => {
    if (window.matchMedia('(max-width: 767px)').matches) setIsSidebarOpen(false);
  };
  const handleSelectSession = (id: string) => {
    setCurrentSessionId(id);
    closeSidebarIfNarrow();
  };
  const handleCreateNewSession = () => {
    setCurrentSessionId(null);
    closeSidebarIfNarrow();
  };

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
        ? `Added another recording to this conversation. It begins:\n\n"${transcript}"\n\nQuestions now search every recording here.`
        : `Added another recording to this conversation, but no speech was found in it.`)
      : (transcript
        ? `Transcribed and indexed on ${ENGINE_PLACE}. It begins:\n\n"${transcript}"\n\nAsk anything about what was said.`
        : `Transcribed and indexed, but no speech was found in this recording.`);

    try {
      if (!isExisting) {
        await fetchSessions();
        setCurrentSessionId(sessionId);
      }
      await saveMessage({
        id: newId(),
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
      id: newId(),
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
        id: newId(),
        session_id: sessionId,
        sender: 'assistant',
        message_text: data.answer,
        created_at: new Date().toISOString(),
        synced: false,
      };
      setMessages(prev => [...prev, assistantMessage]);
      if (Array.isArray(data.context)) {
        setSources(prev => ({ ...prev, [assistantMessage.id]: data.context as Passage[] }));
      }

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
    if (!currentSessionId) return 'New recording';
    const s = sessions.find(s => s.id === currentSessionId);
    return s ? (decryptText(s.session_title) || 'Untitled') : 'Conversation';
  })();

  if (authLoading) {
    return <MachineLoading title="Starting Tell Me…" status="Checking your sign-in." />;
  }

  // A password-reset link/code was used: choose a new password before anything else.
  if (recoveringPassword) {
    return <SetNewPassword hasSession={Boolean(user)} />;
  }

  // Signed out: the Mac app opens on sign-in; the website shows the landing page.
  if (!user) {
    if (desktop) return <DesktopSignIn authError={authLink?.message ?? null} authErrorKey={authLink?.seq ?? 0} />;
    return (
      <LandingPage
        onLaunchApp={() => setShowAuth(true)}
        showAuth={showAuth}
        onCloseAuth={() => setShowAuth(false)}
        authError={authLink?.message ?? null}
      />
    );
  }

  // Signed in, but the local engine isn't running here (website on a computer without the app).
  if (!isBackendReady) {
    if (!desktop && (engineOffline || !engineReachable)) return <OnlineMode user={user} isDarkMode={isDarkMode} onToggleTheme={toggleTheme} />;
    return <MachineLoading title="Starting Tell Me…" status={backendStatus} />;
  }

  if (ollamaStatus === null) {
    return <MachineLoading title="Checking the local AI model…" status="Asking Ollama which models are installed." />;
  }

  if (!ollamaStatus.ollama_running || !ollamaStatus.model_pulled) {
    return (
      <OllamaSetupWizard
        status={ollamaStatus}
        models={models}
        onSelectModel={selectModel}
        onComplete={refreshModelsAndStatus}
      />
    );
  }

  const activeModel = models.find((m) => m.active);

  return (
    <main className="relative h-screen w-screen flex overflow-hidden bg-bg">
      {/* Sidebar navigation */}
      <div
        className={`h-full overflow-hidden shrink-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 ${isSidebarOpen ? 'w-72 max-md:shadow-2xl' : 'w-0'}`}
        style={{ transition: 'width 320ms var(--ease-out)' }}
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
          models={models}
          onSelectModel={handleSidebarModelChange}
        />
      </div>

      {/* Main app space */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        <header className="h-14 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 border-b border-line bg-surface">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label={isSidebarOpen ? 'Hide conversations' : 'Show conversations'}
              className="p-2 rounded-lg text-ink-2 hover:text-ink hover:bg-sunk cursor-pointer"
            >
              {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            {currentSessionId === null && <h1 className="font-semibold text-[1rem] truncate">{activeTitle}</h1>}
          </div>
          {activeModel && (
            <p className="hidden sm:flex items-center gap-2 shrink-0 text-ink-3" title="The local model writing answers. Change it in the sidebar.">
              <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true" />
              <span className="text-[0.85rem] text-ink-2">{activeModel.label}</span>
              <span className="t-num text-[0.72rem]">{activeModel.id}</span>
            </p>
          )}
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">
          {currentSessionId === null ? (
            <div className="w-full h-full overflow-y-auto flex items-start lg:items-center justify-center">
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
              sessionTitle={activeTitle}
              onSendMessage={handleSendMessage}
              onIngestSuccess={handleIngestSuccess}
              sending={sendingMessage}
              sources={sources}
            />
          )}
        </div>
      </div>
    </main>
  );
}
