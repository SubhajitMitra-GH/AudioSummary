'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, ArrowDown, Loader2, Play } from 'lucide-react';
import { ChatMessage } from '../utils/supabase';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  currentSessionId: string | null;
  onSendMessage: (text: string) => void;
  sending: boolean;
}

export default function ChatInterface({
  messages,
  currentSessionId,
  onSendMessage,
  sending,
}: ChatInterfaceProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;
    onSendMessage(inputText);
    setInputText('');
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

  const isLocked = !currentSessionId;

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full"
      style={{ background: 'var(--bg-surface)' }}>

      {/* Messages Canvas */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto flex flex-col relative"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div className="flex-1 max-w-5xl mx-auto w-full px-6 md:px-10 py-8 flex flex-col justify-between">
          {/* Main message feed */}
          <div className="flex-1 flex flex-col gap-8">
            {isLocked ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <div className="rounded-[2rem] p-10 max-w-md flex flex-col items-center shadow-sm"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 shadow-sm"
                    style={{ background: 'var(--accent)' }}>
                    <Play className="w-6 h-6" style={{ color: 'var(--text-on-accent)' }} />
                  </div>
                  <h3 className="font-bold text-[17px] mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    No active conversation
                  </h3>
                  <p className="text-sm leading-relaxed max-w-xs" style={{ color: 'var(--text-secondary)' }}>
                    Please select an existing session or start a new conversation to begin querying audio files.
                  </p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <div className="rounded-[2rem] p-10 max-w-md flex flex-col items-center shadow-sm"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <span className="text-3xl mb-3">👋</span>
                  <h3 className="font-bold text-[17px] mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Session Initialized
                  </h3>
                  <p className="text-sm leading-relaxed max-w-xs" style={{ color: 'var(--text-secondary)' }}>
                    This RAG conversation is active. Ask questions about the uploaded audio transcript chunks.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => {
                const isUser = message.sender === 'user';
                return isUser ? (
                  /* User message */
                  <div
                    key={message.id}
                    className="flex flex-col items-end max-w-[80%] self-end"
                  >
                    <div className="rounded-[1.5rem] rounded-tr-none px-5 py-3.5 text-[14.5px] leading-relaxed"
                      style={{
                        background: 'var(--user-bubble)',
                        color: 'var(--text-on-accent)',
                        boxShadow: '0 2px 8px var(--accent-shadow)',
                      }}>
                      <p className="whitespace-pre-line">{message.message_text}</p>
                    </div>
                    <span className="text-[10px] mt-1 px-1.5 font-mono select-none font-medium"
                      style={{ color: 'var(--text-muted)' }}>
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ) : (
                  /* Assistant message */
                  (() => {
                    const isIngestionMessage =
                      message.message_text.includes('indexing complete') ||
                      message.message_text.includes('Ingestion complete') ||
                      message.message_text.includes('Added new source');

                    return (
                      <div
                        key={message.id}
                        className="flex flex-col items-start max-w-[80%] self-start"
                      >
                        <div className="rounded-[1.5rem] rounded-tl-none px-5 py-4 text-[14.5px] leading-relaxed"
                          style={{
                            background: 'var(--ai-bubble-bg)',
                            border: '1px solid var(--ai-bubble-border)',
                            borderLeft: '3px solid var(--accent)',
                            color: 'var(--text-primary)',
                            boxShadow: `0 2px 12px var(--ai-bubble-shadow)`,
                          }}>
                          <p className="whitespace-pre-line">{message.message_text}</p>

                          {/* Suggest action chips inside the bubble */}
                          {isIngestionMessage && (
                            <div className="mt-4 pt-4 flex flex-wrap gap-2"
                              style={{ borderTop: '1px solid var(--border)' }}>
                              <button
                                onClick={() => onSendMessage("Summarize key points of this audio")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide transition-all cursor-pointer"
                                style={{
                                  border: '1px solid var(--border)',
                                  color: 'var(--accent)',
                                  background: 'var(--bg-surface)',
                                }}
                              >
                                Summarize Key Points
                              </button>
                              <button
                                onClick={() => onSendMessage("Give me a structured breakdown of the contents")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold tracking-wide transition-all cursor-pointer"
                                style={{
                                  border: '1px solid var(--border)',
                                  color: 'var(--accent)',
                                  background: 'var(--bg-surface)',
                                }}
                              >
                                Structured Analysis
                              </button>
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] mt-1 px-1 font-mono select-none font-medium"
                          style={{ color: 'var(--text-muted)' }}>
                          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })()
                );
              })
            )}

            {/* Thinking Indicator */}
            {sending && (
              <div className="flex flex-col items-start max-w-[80%] self-start">
                <div className="rounded-[1.5rem] rounded-tl-none px-5 py-3.5 shadow-sm flex items-center gap-3"
                  style={{
                    background: 'var(--ai-bubble-bg)',
                    border: '1px solid var(--ai-bubble-border)',
                    borderLeft: '3px solid var(--accent)',
                  }}>
                  <div className="flex gap-1.5 items-center">
                    <div className="w-2 h-2 rounded-full pulse-loader" style={{ background: 'var(--accent)', animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full pulse-loader" style={{ background: 'var(--accent)', animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full pulse-loader" style={{ background: 'var(--accent)', animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs font-semibold thinking-shimmer">AI searching local indices...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-6 right-6 rounded-full p-3 shadow-md hover:shadow-lg transition-all cursor-pointer"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Input Bar */}
      <div className="py-6 px-6 md:px-8 shrink-0"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <div className="max-w-5xl mx-auto w-full">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isLocked || sending}
              placeholder={isLocked ? "Select a session to begin..." : "Ask a question about the audio transcript..."}
              className="flex-1 rounded-xl py-3 px-5 focus:outline-none transition-all text-sm disabled:cursor-not-allowed"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <button
              type="submit"
              disabled={isLocked || sending || !inputText.trim()}
              className="font-medium px-5 rounded-xl shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer shrink-0 active:scale-[0.97] text-sm"
              style={{
                background: isLocked || sending || !inputText.trim() ? 'var(--bg-hover)' : 'var(--accent)',
                color: isLocked || sending || !inputText.trim() ? 'var(--text-muted)' : 'var(--text-on-accent)',
              }}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
