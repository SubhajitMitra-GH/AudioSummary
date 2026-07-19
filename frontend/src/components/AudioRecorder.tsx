'use client';

import React, { useState, useRef } from 'react';
import { Mic, Square, Play, Pause, Upload, Link2, Loader2, ArrowRight, AudioLines } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { encryptText } from '../utils/crypto';

interface AudioRecorderProps {
  onIngestSuccess: (sessionId: string, transcript: string) => void;
  currentSessionId: string | null;
  variant?: 'landing' | 'compact';
  sessionTitle?: string;
}

type Tab = 'record' | 'upload' | 'link';
type RecordState = 'idle' | 'recording' | 'paused' | 'processing' | 'ready';

export default function AudioRecorder({
  onIngestSuccess,
  currentSessionId,
  variant = 'landing',
  sessionTitle = 'Active Workspace'
}: AudioRecorderProps) {
  const [activeTab, setActiveTab] = useState<Tab | null>(variant === 'compact' ? null : 'record');
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        setAudioBlob(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
        setRecordState('ready');
        if (timerRef.current) clearInterval(timerRef.current);
      };
      mediaRecorder.start(250);
      setRecordState('recording');
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      alert('Microphone access is required to record audio.');
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && recordState === 'recording') {
      mediaRecorderRef.current.pause();
      setRecordState('paused');
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && recordState === 'paused') {
      mediaRecorderRef.current.resume();
      setRecordState('recording');
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (recordState === 'recording' || recordState === 'paused')) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setAudioBlob(file);
      setRecordState('ready');
    }
  };

  const resetRecorder = () => {
    setAudioBlob(null);
    setUploadFile(null);
    setLinkUrl('');
    setRecordState('idle');
    setRecordingTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
    if (variant === 'compact') setActiveTab(null);
  };

  const submitIngestion = async () => {
    if (!audioBlob) return;
    setRecordState('processing');
    const sessionId = currentSessionId || crypto.randomUUID();
    const formData = new FormData();
    formData.append('file', audioBlob, uploadFile ? uploadFile.name : `rec_${Date.now()}.webm`);
    formData.append('session_id', sessionId);
    try {
      const { data: { session: sAuth } } = await supabase.auth.getSession();
      const token = sAuth?.access_token;
      const user = sAuth?.user;

      const res = await fetch('http://localhost:8000/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const result = await res.json();

      if (!currentSessionId) {
        // Pre-create the session via mediator API so keys exist locally and in cloud
        const rawTitle = `Session ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const sRes = await fetch('http://localhost:8000/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            id: sessionId,
            session_title: encryptText(rawTitle)
          })
        });
        if (!sRes.ok) throw new Error(`Could not initialize session: status ${sRes.status}`);
      }

      onIngestSuccess(sessionId, result.transcript);
      resetRecorder();
    } catch (e: any) {
      alert(`RAG ingestion failed: ${e.message || 'Make sure your local Python server is running.'}`);
      setRecordState('ready');
    }
  };

  const submitLinkIngestion = async () => {
    if (!linkUrl.trim()) return;
    setRecordState('processing');
    const sessionId = currentSessionId || crypto.randomUUID();
    try {
      const { data: { session: sAuth } } = await supabase.auth.getSession();
      const token = sAuth?.access_token;
      const user = sAuth?.user;

      const res = await fetch('http://localhost:8000/upload-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url: linkUrl, session_id: sessionId }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || `Status ${res.status}`);
      }
      const result = await res.json();

      if (!currentSessionId) {
        // Pre-create the session via mediator API so keys exist locally and in cloud
        const rawTitle = `Session ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const sRes = await fetch('http://localhost:8000/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            id: sessionId,
            session_title: encryptText(rawTitle)
          })
        });
        if (!sRes.ok) throw new Error(`Could not initialize session: status ${sRes.status}`);
      }

      onIngestSuccess(sessionId, result.transcript);
      resetRecorder();
    } catch (e) {
      alert(`URL ingestion failed: ${e instanceof Error ? e.message : String(e)}`);
      setRecordState('idle');
    }
  };

  const fmt = (s: number) => {
    const mins = Math.floor(s / 60).toString().padStart(2, '0');
    const secs = (s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const toggleTab = (tab: Tab) => {
    if (variant === 'compact' && activeTab === tab) {
      setActiveTab(null);
      return;
    }
    setActiveTab(tab);
    setRecordState('idle');
    setAudioBlob(null);
    setUploadFile(null);
    setLinkUrl('');
  };

  // ── COMPACT INLINE CHAT VIEW TOOLBAR ──
  if (variant === 'compact') {
    return (
      <div className="w-full flex flex-col gap-3">
        {/* Floating Top Pill Bar */}
        <div className="w-full rounded-full px-5 py-2.5 flex items-center justify-between"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 2px 12px var(--accent-shadow)' }}>
          {/* Left: Current Source Tag */}
          <div className="flex items-center gap-2.5 min-w-0">
            <AudioLines className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--text-secondary)' }}>Current Source:</span>
            <span className="px-3 py-1 rounded-full text-[11px] font-bold font-mono truncate max-w-[220px]"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}>
              {sessionTitle}
            </span>
          </div>

          {/* Right: Add Source buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {([
              { tab: 'record' as Tab, icon: <Mic className="w-3.5 h-3.5" />, label: 'Record' },
              { tab: 'upload' as Tab, icon: <Upload className="w-3.5 h-3.5" />, label: 'Upload' },
              { tab: 'link' as Tab, icon: <Link2 className="w-3.5 h-3.5" />, label: 'Link' },
            ] as const).map(({ tab, icon, label }) => {
              const isOn = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => toggleTab(tab)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer"
                  style={{
                    background: isOn ? 'var(--bg-hover)' : 'transparent',
                    color: isOn ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Input panels aligned below the bar */}
        {activeTab && (
          <div className="rounded-2xl p-4 flex items-center gap-3 w-full shadow-sm"
            style={{ background: 'var(--bg-surface-raised)', border: '1px solid var(--border)' }}>
            {activeTab === 'record' && (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  {recordState === 'recording' && (
                    <div className="flex items-center gap-[3px] h-3">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="w-[2px] h-3 bg-red-500 rounded-full wave-line" />
                      ))}
                    </div>
                  )}
                  <span className="text-xs font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                    {recordState === 'idle' ? '00:00' : recordState === 'ready' ? 'Captured' : fmt(recordingTime)}
                  </span>
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                    {recordState === 'idle' && 'Microphone ready'}
                    {recordState === 'recording' && 'Recording live'}
                    {recordState === 'paused' && 'Recording paused'}
                    {recordState === 'processing' && 'RAG indexing...'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {recordState === 'idle' && (
                    <button onClick={startRecording} className="text-xs font-semibold bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-full cursor-pointer">
                      Start
                    </button>
                  )}
                  {recordState === 'recording' && (
                    <>
                      <button onClick={pauseRecording} className="text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>Pause</button>
                      <button onClick={stopRecording} className="text-xs font-semibold text-white px-3 py-1.5 rounded-full cursor-pointer"
                        style={{ background: 'var(--accent)' }}>Stop</button>
                    </>
                  )}
                  {recordState === 'paused' && (
                    <>
                      <button onClick={resumeRecording} className="text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>Resume</button>
                      <button onClick={stopRecording} className="text-xs font-semibold text-white px-3 py-1.5 rounded-full cursor-pointer"
                        style={{ background: 'var(--accent)' }}>Stop</button>
                    </>
                  )}
                  {recordState === 'ready' && (
                    <>
                      <button onClick={submitIngestion} className="text-xs font-semibold text-white px-4 py-1.5 rounded-full shadow-sm cursor-pointer"
                        style={{ background: 'var(--accent)' }}>Add to Context</button>
                      <button onClick={resetRecorder} className="p-1 cursor-pointer" style={{ color: 'var(--text-muted)' }}>✕</button>
                    </>
                  )}
                  {recordState === 'processing' && (
                    <span className="flex items-center gap-1.5 text-xs font-semibold animate-pulse" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} /> Ingesting...
                    </span>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'upload' && (
              <div className="flex items-center justify-between w-full">
                {uploadFile ? (
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-semibold truncate max-w-[280px]" style={{ color: 'var(--text-primary)' }}>
                      {uploadFile.name}
                    </span>
                    <div className="flex items-center gap-2">
                      {recordState === 'processing' ? (
                        <span className="flex items-center gap-1.5 text-xs font-semibold animate-pulse" style={{ color: 'var(--text-muted)' }}>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} /> Indexing...
                        </span>
                      ) : (
                        <>
                          <button onClick={submitIngestion} className="text-xs font-semibold text-white px-4 py-1.5 rounded-full cursor-pointer"
                            style={{ background: 'var(--accent)' }}>Upload & Index</button>
                          <button onClick={resetRecorder} className="p-1 cursor-pointer" style={{ color: 'var(--text-muted)' }}>✕</button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full rounded-xl py-2 text-center cursor-pointer transition-colors"
                    style={{ border: '1px dashed var(--border)', background: 'var(--bg-surface)' }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Click to choose audio file</span>
                    <input type="file" accept="audio/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'link' && (
              <div className="flex items-center gap-2 w-full rounded-full py-1 pl-4 pr-1"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <Link2 className="w-3.5 h-3.5 mr-1 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  disabled={recordState === 'processing'}
                  placeholder="Paste YouTube or audio link..."
                  className="flex-1 text-xs bg-transparent outline-none py-1.5"
                  style={{ color: 'var(--text-primary)' }}
                />
                {recordState === 'processing' ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold animate-pulse shrink-0 px-2" style={{ color: 'var(--text-muted)' }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} /> Ingesting...
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={submitLinkIngestion}
                      disabled={!linkUrl.trim()}
                      className="text-xs font-semibold text-white px-4 py-1.5 rounded-full disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer animate-fade-in"
                      style={{ background: 'var(--accent)' }}
                    >
                      Fetch
                    </button>
                    <button onClick={resetRecorder} className="p-2 cursor-pointer" style={{ color: 'var(--text-muted)' }}>✕</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── LANDING PAGE VIEW ──
  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6 select-none py-6 px-6">
      {/* Hero Header */}
      <div className="text-center max-w-xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2"
          style={{ color: 'var(--accent)' }}>
          Ingest & Query Audio
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Convert your spoken ideas into a searchable knowledge base. Securely index podcasts, meetings, and voice notes with on-device AI.
        </p>
      </div>

      {/* Main card panel */}
      <div className="w-full rounded-[2.5rem] p-6 md:p-8 flex flex-col items-center gap-6 relative overflow-hidden"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: '0 12px 40px var(--accent-shadow)' }}>
        
        {/* Segmented controls */}
        <div className="rounded-full p-1.5 flex items-center justify-between gap-1 w-full max-w-md mx-auto"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          {([
            { tab: 'link' as Tab, icon: <Link2 className="w-3.5 h-3.5" />, label: 'Fetch Web Link' },
            { tab: 'upload' as Tab, icon: <Upload className="w-3.5 h-3.5" />, label: 'Upload Audio' },
            { tab: 'record' as Tab, icon: <Mic className="w-3.5 h-3.5" />, label: 'Voice Record' },
          ]).map(({ tab, icon, label }) => {
            const isSelected = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => toggleTab(tab)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 text-[11.5px] font-semibold rounded-full transition-all cursor-pointer flex-1"
                style={{
                  background: isSelected ? 'var(--bg-surface)' : 'transparent',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.05)' : 'none',
                  border: isSelected ? '1px solid var(--border)' : '1px solid transparent',
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Dynamic Panels */}
        <div className="w-full">
          {/* Link Panel */}
          {activeTab === 'link' && (
            <div className="w-full flex flex-col items-center gap-6">
              {/* Pill-shaped Link Bar */}
              <div className="rounded-full py-1.5 pl-6 pr-2.5 flex items-center justify-between w-full max-w-xl mx-auto transition-all"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                <Link2 className="w-4 h-4 mr-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  disabled={recordState === 'processing'}
                  placeholder="Paste a podcast, YouTube, or audio link..."
                  className="bg-transparent text-[13.5px] w-full outline-none py-1.5"
                  style={{ color: 'var(--text-primary)' }}
                />
                <button
                  onClick={submitLinkIngestion}
                  disabled={!linkUrl.trim() || recordState === 'processing'}
                  className="font-semibold text-xs px-5 py-3 rounded-full flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 shrink-0 ml-2"
                  style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                >
                  {recordState === 'processing' ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Ingesting...</>
                  ) : (
                    <>Analyze <ArrowRight className="w-3.5 h-3.5" /></>
                  )}
                </button>
              </div>

              {/* Supported Text */}
              <p className="text-[10px] tracking-[0.15em] font-bold text-center w-full mt-2 uppercase"
                style={{ color: 'var(--text-muted)' }}>
                SUPPORTED: MP3 • WAV • M4A • YOUTUBE • SPOTIFY • DIRECT LINKS
              </p>
            </div>
          )}

          {/* Upload Panel */}
          {activeTab === 'upload' && (
            <div className="w-full flex flex-col items-center gap-5">
              <div className="text-center mb-1">
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Populate Workspace</h3>
                <p className="text-xs max-w-md mx-auto leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Upload your audio recordings to begin the RAG processing. Our engine will transcribe, index, and prepare your data for high-fidelity retrieval.
                </p>
              </div>

              {uploadFile ? (
                <div className="rounded-2xl p-5 max-w-md mx-auto flex items-center justify-between w-full shadow-sm"
                  style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate max-w-[280px]" style={{ color: 'var(--text-primary)' }}>
                      {uploadFile.name}
                    </p>
                    <p className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--text-muted)' }}>
                      {(uploadFile.size / 1048576).toFixed(2)} MB
                    </p>
                  </div>
                  {recordState === 'processing' ? (
                    <div className="flex items-center gap-1.5 text-xs font-semibold animate-pulse" style={{ color: 'var(--text-secondary)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} /> Ingesting...
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={submitIngestion}
                        className="text-white text-xs font-semibold px-4 py-2 rounded-full cursor-pointer shadow-sm active:scale-95"
                        style={{ background: 'var(--accent)' }}
                      >
                        Ingest File
                      </button>
                      <button
                        onClick={resetRecorder}
                        className="text-xs font-semibold px-3 py-2 rounded-full cursor-pointer"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative w-full max-w-xl mx-auto border-2 border-dashed rounded-[2rem] p-6 text-center flex flex-col items-center gap-3 transition-all group cursor-pointer"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                  {/* Upload Graphic */}
                  <div className="w-14 h-14 rounded-full flex items-center justify-center relative"
                    style={{ background: 'var(--accent-bg)' }}>
                    <div className="w-10 h-10 rounded-xl shadow-md flex items-center justify-center"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                      <Upload className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
                    </div>
                  </div>

                  <div>
                    <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Drag and drop audio files</p>
                    <p className="text-[11px] max-w-xs mx-auto mt-1 leading-normal" style={{ color: 'var(--text-muted)' }}>
                      Your files will be encrypted at rest and processed using our proprietary acoustic model.
                    </p>
                  </div>

                  <button className="text-white px-5 py-2.5 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer mt-1 pointer-events-none"
                    style={{ background: 'var(--accent)' }}>
                    <Upload className="w-3.5 h-3.5" /> Select File from Desktop
                  </button>

                  <div className="flex flex-col items-center gap-1 mt-2">
                    <span className="text-[9px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>SUPPORTED FORMATS</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      {['MP3', 'WAV', 'WEBM', 'M4A', 'FLAC'].map((f) => (
                        <span key={f} className="text-[9.5px] font-bold px-2 py-0.5 rounded-md"
                          style={{ color: 'var(--text-secondary)', background: 'var(--bg-hover)' }}>
                          {f}
                        </span>
                      ))}
                    </div>
                    <span className="text-[9px] font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>MAX 50MB PER FILE</span>
                  </div>

                  <input type="file" accept="audio/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
              )}
            </div>
          )}

          {/* Voice Record Panel */}
          {activeTab === 'record' && (
            <div className="w-full flex flex-col items-center gap-5">
              <div className="text-center mb-1">
                <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Voice Recording</h3>
                <p className="text-xs max-w-md mx-auto leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Record live speech directly from your browser. The stream will be transcribed and indexed locally.
                </p>
              </div>

              <div className="w-full max-w-xl mx-auto rounded-[2rem] p-6 flex flex-col items-center gap-4"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-input)' }}>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                    {recordState === 'idle' && 'Microphone Ready'}
                    {recordState === 'recording' && 'Recording Audio'}
                    {recordState === 'paused' && 'Recording Paused'}
                    {recordState === 'ready' && 'Audio Captured'}
                    {recordState === 'processing' && 'RAG Indexing...'}
                  </span>
                  
                  <span className="text-3xl font-bold font-mono tracking-tight my-1" style={{ color: 'var(--text-primary)' }}>
                    {fmt(recordingTime)}
                  </span>

                  {recordState === 'recording' && (
                    <div className="flex items-center gap-[3px] h-3.5 mt-1">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="w-[2.5px] h-4 rounded-full wave-line" style={{ background: 'var(--accent)' }} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {recordState === 'idle' && (
                    <button
                      onClick={startRecording}
                      className="font-semibold py-2.5 px-6 rounded-full text-xs cursor-pointer flex items-center gap-2 active:scale-95 transition-all shadow-sm"
                      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                    >
                      <Mic className="w-3.5 h-3.5" /> Start Recording
                    </button>
                  )}
                  {recordState === 'recording' && (
                    <>
                      <button onClick={pauseRecording} className="font-semibold py-2 px-4 rounded-full text-xs cursor-pointer"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>Pause</button>
                      <button onClick={stopRecording} className="font-semibold py-2 px-4 rounded-full text-xs cursor-pointer text-white"
                        style={{ background: 'var(--text-primary)' }}>Stop</button>
                    </>
                  )}
                  {recordState === 'paused' && (
                    <>
                      <button onClick={resumeRecording} className="font-semibold py-2 px-4 rounded-full text-xs cursor-pointer"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}>Resume</button>
                      <button onClick={stopRecording} className="font-semibold py-2 px-4 rounded-full text-xs cursor-pointer text-white"
                        style={{ background: 'var(--text-primary)' }}>Stop</button>
                    </>
                  )}
                  {recordState === 'ready' && (
                    <>
                      <button
                        onClick={submitIngestion}
                        className="font-semibold py-2.5 px-6 rounded-full text-xs shadow-sm cursor-pointer transition-all flex items-center gap-1.5"
                        style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                      >
                        Ingest Recording <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={resetRecorder} className="font-semibold py-2.5 px-4 rounded-full text-xs cursor-pointer"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>Discard</button>
                    </>
                  )}
                  {recordState === 'processing' && (
                    <div className="flex items-center gap-2 text-xs font-semibold animate-pulse" style={{ color: 'var(--text-secondary)' }}>
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} /> Indexing stream...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
