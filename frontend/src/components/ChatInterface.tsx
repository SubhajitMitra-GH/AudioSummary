'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, ArrowDown, Loader2, Play, CircleAlert } from 'lucide-react';
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
    <div className="flex-1 flex flex-col bg-[#fbfcfd] overflow-hidden h-full">

      {/* Messages Canvas */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#f8f9fd]/30 flex flex-col relative"
      >
        <div className="flex-1 max-w-5xl mx-auto w-full px-6 md:px-10 py-8 flex flex-col justify-between">
          {/* Main message feed */}
          <div className="flex-1 flex flex-col gap-8">
            {isLocked ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <div className="bg-white border border-[#e8ecf4] rounded-[2rem] p-10 max-w-md flex flex-col items-center shadow-sm">
                  <div className="w-12 h-12 rounded-xl bg-[#1a237e] flex items-center justify-center mb-5 shadow-sm">
                    <Play className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-bold text-[17px] text-slate-800 mb-1.5">No active conversation</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                    Please select an existing session or start a new conversation to begin querying audio files.
                  </p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <div className="bg-white border border-[#e8ecf4] rounded-[2rem] p-10 max-w-md flex flex-col items-center shadow-sm">
                  <span className="text-3xl mb-3">👋</span>
                  <h3 className="font-bold text-[17px] text-slate-800 mb-1.5">Session Initialized</h3>
                  <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
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
                    <div className="bg-[#1a237e] text-white rounded-[1.5rem] rounded-tr-none px-5 py-3.5 shadow-[0_2px_8px_rgba(26,35,126,0.08)] text-[14.5px] leading-relaxed">
                      <p className="whitespace-pre-line">{message.message_text}</p>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 px-1.5 font-mono select-none font-medium">
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
                        <div className="bg-white border border-[#e8ecf4] rounded-[1.5rem] rounded-tl-none px-5 py-4 shadow-[0_2px_12px_rgba(26,35,126,0.01)] text-[14.5px] leading-relaxed text-slate-800">
                          <p className="whitespace-pre-line">{message.message_text}</p>
                          
                          {/* Suggest action chips inside the bubble */}
                          {isIngestionMessage && (
                            <div className="border-t border-slate-100 mt-4 pt-4 flex flex-wrap gap-2">
                              <button
                                onClick={() => onSendMessage("Summarize key points of this audio")}
                                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200/80 hover:border-[#1a237e]/40 rounded-full text-[11px] text-[#1a237e] hover:bg-indigo-50/30 font-bold tracking-wide transition-all cursor-pointer bg-white"
                              >
                                Summarize Key Points
                              </button>
                              <button
                                onClick={() => onSendMessage("Give me a structured breakdown of the contents")}
                                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200/80 hover:border-[#1a237e]/40 rounded-full text-[11px] text-[#1a237e] hover:bg-indigo-50/30 font-bold tracking-wide transition-all cursor-pointer bg-white"
                              >
                                Structured Analysis
                              </button>
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 mt-1 px-1 font-mono select-none font-medium">
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
                <div className="bg-white border border-[#e8ecf4] rounded-[1.5rem] rounded-tl-none px-5 py-3.5 shadow-sm flex items-center gap-3">
                  <div className="flex gap-1.5 items-center">
                    <div className="w-2 h-2 rounded-full bg-slate-400 pulse-loader" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-slate-400 pulse-loader" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-slate-400 pulse-loader" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-slate-400 font-semibold">AI searching local indices...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-6 right-6 bg-white hover:bg-slate-50 border border-[#e8ecf4] text-slate-600 hover:text-slate-900 rounded-full p-3 shadow-md hover:shadow-lg transition-all cursor-pointer"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Input Bar */}
      <div className="py-6 px-6 md:px-8 border-t border-[#e8ecf4] bg-white shrink-0">
        <div className="max-w-5xl mx-auto w-full">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isLocked || sending}
              placeholder={isLocked ? "Select a session to begin..." : "Ask a question about the audio transcript..."}
              className="flex-1 border border-slate-200 focus:border-[#1a237e] rounded-xl py-3 px-5 focus:outline-none transition-all text-sm placeholder-slate-400 text-slate-800 disabled:bg-slate-50 disabled:cursor-not-allowed bg-white"
            />
            <button
              type="submit"
              disabled={isLocked || sending || !inputText.trim()}
              className="bg-[#1a237e] hover:bg-[#121b74] text-white font-medium px-5 rounded-xl shadow-sm transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center cursor-pointer shrink-0 active:scale-[0.97] text-sm"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
