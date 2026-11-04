'use client';

import React from 'react';
import { Session } from '../utils/supabase';
import { decryptText } from '../utils/crypto';
import { Loader2, Pencil, Trash2, Check, X, LogOut, Sun, Moon, CloudOff, Plus } from 'lucide-react';
import { supabase } from '../utils/supabase';
import type { ModelOption } from '../utils/api';
import { Wordmark, SpeechBars } from './ui/Brand';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateNewSession: () => void;
  loading: boolean;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  models: ModelOption[];
  onSelectModel: (modelId: string) => void;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateNewSession,
  loading,
  onDeleteSession,
  onRenameSession,
  isDarkMode,
  onToggleTheme,
  models,
  onSelectModel
}: SidebarProps) {
  const activeModel = models.find((m) => m.active);
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState<string>('');
  const [userEmail, setUserEmail] = React.useState<string>('');

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email || '');
    });
  }, []);

  const startEditing = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(id);
    setEditingText(currentTitle);
  };

  const handleSaveEdit = (id: string) => {
    if (editingText.trim()) {
      onRenameSession(id, editingText.trim());
    }
    setEditingSessionId(null);
  };

  return (
    <div className="h-full flex flex-col w-72 shrink-0 select-none bg-surface border-r border-line">
      <div className="px-5 pt-5 pb-4">
        <Wordmark className="text-[1.55rem]" />
      </div>

      <div className="px-4 pb-3">
        <button
          onClick={onCreateNewSession}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 font-semibold text-[0.92rem] cursor-pointer active:scale-[0.99] ${
            currentSessionId === null ? 'bg-cobalt-wash text-cobalt' : 'bg-cobalt hover:bg-cobalt-hover text-on-cobalt'
          }`}
        >
          <Plus className="w-4 h-4" />
          New recording
        </button>
      </div>

      <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pt-3 pb-2 text-[0.78rem] font-medium text-ink-3">Recordings</p>

        {loading ? (
          <p className="flex items-center gap-2 px-2 py-4 text-[0.88rem] text-ink-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
          </p>
        ) : sessions.length === 0 ? (
          <div className="mx-1 mt-2 rounded-2xl bg-bg px-4 py-5">
            <SpeechBars count={18} seed={9} className="h-6 w-full mb-3" idleClass="bg-line-strong" activeClass="bg-line-strong" />
            <p className="text-[0.88rem] leading-relaxed text-ink-3">Nothing here yet. Recordings you add will show up in this list.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((session) => {
              const decryptedTitle = decryptText(session.session_title);
              const isActive = session.id === currentSessionId;
              const isEditing = session.id === editingSessionId;

              if (isEditing) {
                return (
                  <li key={session.id} className="flex items-center gap-1 rounded-xl bg-bg border border-cobalt px-2 py-1">
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(session.id);
                        if (e.key === 'Escape') setEditingSessionId(null);
                      }}
                      aria-label="Conversation name"
                      className="flex-1 min-w-0 bg-transparent px-1.5 py-1 text-[0.9rem] text-ink focus:outline-none"
                      autoFocus
                    />
                    <button onClick={() => handleSaveEdit(session.id)} aria-label="Save name" className="p-1.5 rounded-lg text-cobalt hover:bg-cobalt-wash cursor-pointer">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingSessionId(null)} aria-label="Cancel" className="p-1.5 rounded-lg text-ink-3 hover:bg-sunk cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                );
              }

              return (
                <li key={session.id} className="relative group/item">
                  <button
                    onClick={() => onSelectSession(session.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full text-left flex items-center gap-3 pl-2.5 pr-3 group-hover/item:pr-16 group-focus-within/item:pr-16 py-2 rounded-xl cursor-pointer ${
                      isActive ? 'bg-cobalt-wash text-ink' : 'text-ink-2 hover:bg-bg hover:text-ink'
                    }`}
                  >
                    <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${isActive ? 'bg-cobalt' : 'bg-sunk'}`}>
                      <SpeechBars count={5} seed={session.id.length + session.id.charCodeAt(0)} className="h-3.5 w-4"
                        activeClass={isActive ? 'bg-on-cobalt' : 'bg-ink-3'} idleClass="bg-ink-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.92rem] font-medium leading-tight">{decryptedTitle || 'Untitled'}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-ink-3">
                        {shortDate(session.created_at)}
                        {session.synced === false && (
                          <span className="inline-flex items-center gap-1" title="Saved on this Mac; will back up when you're online">
                            <CloudOff className="w-3 h-3" /> not backed up
                          </span>
                        )}
                      </span>
                    </span>
                  </button>

                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover/item:opacity-100 focus-within:opacity-100">
                    <button
                      onClick={(e) => startEditing(session.id, decryptedTitle || '', e)}
                      aria-label="Rename conversation"
                      title="Rename"
                      className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      aria-label="Delete conversation"
                      title="Delete"
                      className="p-1.5 rounded-lg text-ink-3 hover:text-danger hover:bg-surface cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-line px-4 py-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5" title="The local model that writes answers. Models that aren't downloaded yet will offer a download.">
          <span className="text-[0.78rem] font-medium text-ink-3">Answer model</span>
          <select
            value={activeModel?.id ?? ''}
            onChange={(e) => onSelectModel(e.target.value)}
            disabled={models.length === 0}
            className="w-full rounded-xl bg-bg border border-line px-3 py-2 text-[0.9rem] text-ink cursor-pointer focus:outline-none focus:border-cobalt"
          >
            {models.length === 0 && <option value="">Loading…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}{m.installed ? '' : ` · ${m.size_gb ? `${m.size_gb} GB` : ''} download`}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {userEmail && (
              <>
                <span className="w-8 h-8 shrink-0 rounded-full bg-lime text-on-lime flex items-center justify-center text-[0.8rem] font-semibold">
                  {userEmail.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.88rem] text-ink truncate">{userEmail.split('@')[0]}</span>
                  <span className="block text-[0.75rem] text-ink-3 truncate">{userEmail}</span>
                </span>
              </>
            )}
          </div>
          <div className="flex items-center shrink-0">
            <button
              onClick={onToggleTheme}
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDarkMode ? 'Light mode' : 'Dark mode'}
              className="p-2 rounded-lg text-ink-3 hover:text-ink hover:bg-bg cursor-pointer"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => supabase.auth.signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="p-2 rounded-lg text-ink-3 hover:text-danger hover:bg-bg cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
