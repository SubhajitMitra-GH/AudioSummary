'use client';

import React from 'react';
import { Session } from '../utils/supabase';
import { decryptText } from '../utils/crypto';
import { Plus, MessageSquare, Loader2, Cpu, Database, AudioLines, X, Edit3, Check, LogOut, Sun, Moon } from 'lucide-react';
import { supabase } from '../utils/supabase';

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
}

export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateNewSession,
  loading,
  onDeleteSession,
  onRenameSession,
  isDarkMode,
  onToggleTheme
}: SidebarProps) {
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
    <div className="h-full flex flex-col w-72 shrink-0 select-none"
      style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
      {/* Brand Header */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
            style={{ background: 'var(--accent)' }}>
            <AudioLines className="w-5 h-5" style={{ color: 'var(--text-on-accent)' }} />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight leading-none"
              style={{ color: 'var(--text-primary)' }}>
              Tell Me.
            </h1>
            <p className="text-[10px] font-semibold tracking-wide mt-1"
              style={{ color: 'var(--text-muted)' }}>
              Audio RAG Platform
            </p>
          </div>
        </div>
      </div>

      {/* New Conversation CTA */}
      <div className="px-4 pb-4">
        <button
          onClick={onCreateNewSession}
          className="w-full font-semibold py-3 px-6 rounded-full shadow-md transition-all flex items-center justify-center gap-2 text-xs cursor-pointer active:scale-[0.98]"
          style={{
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            boxShadow: `0 4px 14px var(--accent-shadow)`,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px" style={{ background: 'var(--border)' }} />

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-4 flex flex-col gap-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] px-3 mb-2"
          style={{ color: 'var(--text-muted)' }}>
          Conversations
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-[11px] px-3 py-4"
            style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading index...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-[11.5px] text-center py-10 px-4 leading-relaxed font-normal"
            style={{ color: 'var(--text-muted)' }}>
            No active conversations.<br />
            <span className="hover:underline cursor-pointer font-medium"
              style={{ color: 'var(--accent)' }}
              onClick={onCreateNewSession}>Start a new one.</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((session) => {
              const decryptedTitle = decryptText(session.session_title);
              const isActive = session.id === currentSessionId;
              const isEditing = session.id === editingSessionId;

              if (isEditing) {
                return (
                  <li key={session.id} className="px-2 py-1 flex items-center gap-1.5 rounded-xl"
                    style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(session.id);
                        if (e.key === 'Escape') setEditingSessionId(null);
                      }}
                      className="flex-1 rounded-lg px-2.5 py-1 text-xs focus:outline-none transition-all font-medium"
                      style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                      }}
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveEdit(session.id)}
                      className="p-1 rounded-lg cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingSessionId(null)}
                      className="p-1 rounded-lg cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              }

              return (
                <li key={session.id} className="relative group/item">
                  <button
                    onClick={() => onSelectSession(session.id)}
                    className="w-full text-left pl-4 pr-16 py-2.5 rounded-full transition-all flex items-center gap-3 cursor-pointer group"
                    style={{
                      background: isActive ? 'var(--bg-surface-raised)' : 'transparent',
                      border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                      boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.03)' : 'none',
                      color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0 transition-colors"
                      style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }} />
                    <div className="overflow-hidden flex-1 min-w-0 flex items-center justify-between gap-1.5">
                      <p className="text-xs truncate leading-tight flex-1">
                        {decryptedTitle || 'Untitled'}
                      </p>
                      {session.synced === false && (
                        <span title="Offline Queue - Syncing..." className="text-[10px] animate-pulse text-amber-500 shrink-0">
                          🔄
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Action group on hover */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-all">
                    <button
                      onClick={(e) => startEditing(session.id, decryptedTitle || '', e)}
                      title="Rename Conversation"
                      className="p-1 rounded-full cursor-pointer transition-all"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      title="Delete Conversation"
                      className="p-1 hover:text-red-500 rounded-full cursor-pointer transition-all"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sidebar Footer */}
      <div className="mt-auto flex flex-col" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="px-4 py-3 flex flex-col gap-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}>
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span>Local Embeddings</span>
          </div>
          <div className="flex items-center gap-2.5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}>
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>Supabase DB</span>
          </div>
        </div>

        {/* Theme Toggle + User Profile */}
        <div className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {userEmail && (
              <>
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                  style={{
                    background: 'var(--accent-bg)',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent-border)',
                  }}>
                  {userEmail.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate leading-none mb-1"
                    style={{ color: 'var(--text-primary)' }}>
                    {userEmail.split('@')[0]}
                  </p>
                  <p className="text-[10px] font-medium truncate"
                    style={{ color: 'var(--text-muted)' }}>
                    {userEmail}
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Theme toggle */}
            <button
              onClick={onToggleTheme}
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-xl transition-all cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {/* Sign out */}
            <button
              onClick={() => supabase.auth.signOut()}
              title="Sign Out"
              className="p-2 hover:text-red-500 rounded-xl transition-all cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
