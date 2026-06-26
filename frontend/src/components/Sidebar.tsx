'use client';

import React from 'react';
import { Session } from '../utils/supabase';
import { decryptText } from '../utils/crypto';
import { Plus, MessageSquare, Loader2, Cpu, Database, AudioLines, X, Edit3, Check } from 'lucide-react';

interface SidebarProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateNewSession: () => void;
  loading: boolean;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
}

export default function Sidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onCreateNewSession,
  loading,
  onDeleteSession,
  onRenameSession
}: SidebarProps) {
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState<string>('');

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
    <div className="h-full flex flex-col bg-[#fcfcfd] w-72 shrink-0 select-none border-r border-[#e8ecf4]">
      {/* Brand Header */}
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1a237e] flex items-center justify-center shadow-sm">
            <AudioLines className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">
              Summarize
            </h1>
            <p className="text-[10px] text-slate-400 font-semibold tracking-wide mt-1">
              Audio RAG Platform
            </p>
          </div>
        </div>
      </div>

      {/* New Conversation CTA */}
      <div className="px-4 pb-4">
        <button
          onClick={onCreateNewSession}
          className="w-full bg-[#1a237e] hover:bg-[#121b74] text-white font-semibold py-3 px-6 rounded-full shadow-md shadow-indigo-900/10 hover:shadow-indigo-900/20 transition-all flex items-center justify-center gap-2 text-xs.5 cursor-pointer active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          New Conversation
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-slate-100" />

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-4 flex flex-col gap-1">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] px-3 mb-2">
          Conversations
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-400 px-3 py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading index...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-[11.5px] text-slate-400 text-center py-10 px-4 leading-relaxed font-normal">
            No active summaries.<br />
            <span className="text-[#1a237e] hover:underline cursor-pointer font-medium" onClick={onCreateNewSession}>Start a new one.</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((session) => {
              const decryptedTitle = decryptText(session.session_title);
              const isActive = session.id === currentSessionId;
              const isEditing = session.id === editingSessionId;

              if (isEditing) {
                return (
                  <li key={session.id} className="px-2 py-1 flex items-center gap-1.5 bg-slate-50 border border-slate-200/50 rounded-xl">
                    <input
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(session.id);
                        if (e.key === 'Escape') setEditingSessionId(null);
                      }}
                      className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:border-[#1a237e] transition-all font-medium"
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveEdit(session.id)}
                      className="p-1 text-[#1a237e] hover:bg-indigo-50 rounded-lg cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingSessionId(null)}
                      className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg cursor-pointer"
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
                    className={`w-full text-left pl-4 pr-16 py-2.5 rounded-full transition-all flex items-center gap-3 cursor-pointer group ${
                      isActive
                        ? 'bg-white border border-[#e8ecf4] shadow-[0_2px_8px_rgba(0,0,0,0.03)] text-[#1a237e] font-semibold'
                        : 'text-slate-600 hover:bg-slate-100/50 hover:text-slate-900'
                    }`}
                  >
                    <MessageSquare className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? 'text-[#1a237e]' : 'text-slate-400 group-hover:text-[#1a237e]'
                    }`} />
                    <div className="overflow-hidden flex-1 min-w-0">
                      <p className="text-xs truncate leading-tight">
                        {decryptedTitle || 'Untitled'}
                      </p>
                    </div>
                  </button>
                  
                  {/* Action group on hover */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 transition-all">
                    <button
                      onClick={(e) => startEditing(session.id, decryptedTitle || '', e)}
                      title="Rename Conversation"
                      className="p-1 text-slate-400 hover:text-[#1a237e] hover:bg-indigo-50 rounded-full cursor-pointer transition-all"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      title="Delete Conversation"
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full cursor-pointer transition-all"
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
      <div className="mt-auto border-t border-slate-100/80 bg-slate-50/30">
        <div className="px-4 py-3 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-500 font-medium">
            <Cpu className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Local Embeddings</span>
          </div>
          <div className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-500 font-medium">
            <Database className="w-4 h-4 text-slate-400 shrink-0" />
            <span>Supabase DB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
