'use client';

import React, { useState, useRef } from 'react';
import { Mic, Square, Play, Pause, Upload, Link2, Loader2, ArrowRight, AudioLines } from 'lucide-react';

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
      const res = await fetch('http://localhost:8000/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const result = await res.json();
      onIngestSuccess(sessionId, result.transcript);
      resetRecorder();
    } catch {
      alert('RAG ingestion failed. Make sure your local Python server is running.');
      setRecordState('ready');
    }
  };

  const submitLinkIngestion = async () => {
    if (!linkUrl.trim()) return;
    setRecordState('processing');
    const sessionId = currentSessionId || crypto.randomUUID();
    try {
      const res = await fetch('http://localhost:8000/upload-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkUrl, session_id: sessionId }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || `Status ${res.status}`);
      }
      const result = await res.json();
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
        {/* Floating Top Pill Bar matching Screenshot 2 */}
        <div className="w-full bg-white border border-[#e8ecf4] shadow-[0_2px_12px_rgba(26,35,126,0.02)] rounded-full px-5 py-2.5 flex items-center justify-between">
          {/* Left: Current Source Tag */}
          <div className="flex items-center gap-2.5 min-w-0">
            <AudioLines className="w-4 h-4 text-[#1a237e] shrink-0" />
            <span className="text-xs text-slate-500 font-semibold shrink-0">Current Source:</span>
            <span className="bg-[#f0f4ff] text-[#1a237e] border border-indigo-100/60 px-3 py-1 rounded-full text-[11px] font-bold font-mono truncate max-w-[220px]">
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                    isOn
                      ? 'bg-slate-100 text-[#1a237e]'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
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
          <div className="bg-slate-50/80 border border-[#e8ecf4] rounded-2xl p-4 flex items-center gap-3 w-full shadow-sm">
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
                  <span className="text-xs font-semibold text-slate-700 font-mono">
                    {recordState === 'idle' ? '00:00' : recordState === 'ready' ? 'Captured' : fmt(recordingTime)}
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
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
                      <button onClick={pauseRecording} className="text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-full cursor-pointer">
                        Pause
                      </button>
                      <button onClick={stopRecording} className="text-xs font-semibold bg-[#1a237e] text-white px-3 py-1.5 rounded-full cursor-pointer">
                        Stop
                      </button>
                    </>
                  )}
                  {recordState === 'paused' && (
                    <>
                      <button onClick={resumeRecording} className="text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-full cursor-pointer">
                        Resume
                      </button>
                      <button onClick={stopRecording} className="text-xs font-semibold bg-[#1a237e] text-white px-3 py-1.5 rounded-full cursor-pointer">
                        Stop
                      </button>
                    </>
                  )}
                  {recordState === 'ready' && (
                    <>
                      <button onClick={submitIngestion} className="text-xs font-semibold bg-[#1a237e] hover:bg-[#121b74] text-white px-4 py-1.5 rounded-full shadow-sm cursor-pointer">
                        Add to Context
                      </button>
                      <button onClick={resetRecorder} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                        ✕
                      </button>
                    </>
                  )}
                  {recordState === 'processing' && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1a237e]" /> Ingesting...
                    </span>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'upload' && (
              <div className="flex items-center justify-between w-full">
                {uploadFile ? (
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[280px]">
                      {uploadFile.name}
                    </span>
                    <div className="flex items-center gap-2">
                      {recordState === 'processing' ? (
                        <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold animate-pulse">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1a237e]" /> Indexing...
                        </span>
                      ) : (
                        <>
                          <button onClick={submitIngestion} className="text-xs font-semibold bg-[#1a237e] hover:bg-[#121b74] text-white px-4 py-1.5 rounded-full cursor-pointer">
                            Upload & Index
                          </button>
                          <button onClick={resetRecorder} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="relative w-full border border-dashed border-slate-300 hover:border-slate-400 rounded-xl py-2 text-center cursor-pointer transition-colors bg-white">
                    <span className="text-xs text-slate-500 font-semibold">Click to choose audio file</span>
                    <input type="file" accept="audio/*" onChange={handleFileChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                  </div>
                )}
              </div>
            )}

            {activeTab === 'link' && (
              <div className="flex items-center gap-2 w-full bg-white border border-slate-200/50 rounded-full py-1 pl-4 pr-1">
                <Link2 className="text-slate-400 w-3.5 h-3.5 mr-1 shrink-0" />
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  disabled={recordState === 'processing'}
                  placeholder="Paste YouTube or audio link..."
                  className="flex-1 text-xs bg-transparent outline-none placeholder-slate-400 text-slate-800 transition-all py-1.5"
                />
                {recordState === 'processing' ? (
                  <span className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold animate-pulse shrink-0 px-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1a237e]" /> Ingesting...
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={submitLinkIngestion}
                      disabled={!linkUrl.trim()}
                      className="text-xs font-semibold bg-[#1a237e] hover:bg-[#121b74] text-white px-4 py-1.5 rounded-full disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer animate-fade-in"
                    >
                      Fetch
                    </button>
                    <button onClick={resetRecorder} className="text-slate-400 hover:text-slate-600 p-2 cursor-pointer">
                      ✕
                    </button>
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
        <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#1a237e] mb-2">
          Ingest & Query Audio
        </h2>
        <p className="text-slate-500 text-sm leading-relaxed">
          Convert your spoken ideas into a searchable knowledge base. Securely index podcasts, meetings, and voice notes with on-device AI.
        </p>
      </div>

      {/* Main card panel matching Screenshot 1 */}
      <div className="w-full bg-white rounded-[2.5rem] border border-slate-100 shadow-[0_12px_40px_rgba(26,35,126,0.03)] p-6 md:p-8 flex flex-col items-center gap-6 relative overflow-hidden">
        
        {/* Segmented controls matching Screenshot 1 */}
        <div className="bg-slate-50 border border-slate-200/50 rounded-full p-1.5 flex items-center justify-between gap-1 w-full max-w-md mx-auto">
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
                className={`flex items-center justify-center gap-2 px-4 py-2.5 text-[11.5px] font-semibold rounded-full transition-all cursor-pointer flex-1 ${
                  isSelected
                    ? 'bg-white text-slate-800 shadow-sm border border-slate-200/40'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
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
              {/* Pill-shaped Link Bar matching Screenshot 1 */}
              <div className="bg-[#f4f6fc]/80 border border-slate-200/50 rounded-full py-1.5 pl-6 pr-2.5 flex items-center justify-between w-full max-w-xl mx-auto focus-within:border-[#1a237e]/40 focus-within:ring-2 focus-within:ring-indigo-50 transition-all">
                <Link2 className="text-slate-400 w-4 h-4 mr-3 shrink-0" />
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  disabled={recordState === 'processing'}
                  placeholder="Paste a podcast, YouTube, or audio link..."
                  className="bg-transparent text-[13.5px] w-full outline-none placeholder-slate-400 text-slate-800 py-1.5"
                />
                <button
                  onClick={submitLinkIngestion}
                  disabled={!linkUrl.trim() || recordState === 'processing'}
                  className="bg-[#1a237e] hover:bg-[#121b74] text-white font-semibold text-xs px-5 py-3 rounded-full flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 shrink-0 ml-2"
                >
                  {recordState === 'processing' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Ingesting...
                    </>
                  ) : (
                    <>
                      Analyze <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {/* Supported Text */}
              <p className="text-[10px] tracking-[0.15em] font-bold text-slate-400 text-center w-full mt-2 uppercase">
                SUPPORTED: MP3 • WAV • M4A • YOUTUBE • SPOTIFY • DIRECT LINKS
              </p>
            </div>
          )}

          {/* Upload Panel matching Screenshot 4 */}
          {activeTab === 'upload' && (
            <div className="w-full flex flex-col items-center gap-5">
              <div className="text-center mb-1">
                <h3 className="text-lg font-bold text-slate-800">Populate Workspace</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed mt-1">
                  Upload your audio recordings to begin the RAG processing. Our engine will transcribe, index, and prepare your data for high-fidelity retrieval.
                </p>
              </div>

              {uploadFile ? (
                <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 max-w-md mx-auto flex items-center justify-between w-full shadow-sm">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate max-w-[280px]">
                      {uploadFile.name}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                      {(uploadFile.size / 1048576).toFixed(2)} MB
                    </p>
                  </div>
                  {recordState === 'processing' ? (
                    <div className="flex items-center gap-1.5 text-slate-500 text-xs font-semibold animate-pulse">
                      <Loader2 className="w-4 h-4 animate-spin text-[#1a237e]" /> Ingesting...
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={submitIngestion}
                        className="bg-[#1a237e] hover:bg-[#121b74] text-white text-xs font-semibold px-4 py-2 rounded-full cursor-pointer shadow-sm active:scale-95"
                      >
                        Ingest File
                      </button>
                      <button
                        onClick={resetRecorder}
                        className="bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-semibold px-3 py-2 rounded-full cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative w-full max-w-xl mx-auto border-2 border-dashed border-[#d5dbec] hover:border-indigo-400 bg-[#f9fafc]/50 hover:bg-[#f9fafc] rounded-[2rem] p-6 text-center flex flex-col items-center gap-3 transition-all group cursor-pointer">
                  {/* Upload Graphic */}
                  <div className="w-14 h-14 rounded-full bg-[#f4f6fc] flex items-center justify-center relative">
                    <div className="w-10 h-10 rounded-xl bg-white shadow-md flex items-center justify-center border border-slate-100">
                      <Upload className="w-4.5 h-4.5 text-[#1a237e]" />
                    </div>
                  </div>

                  <div>
                    <p className="font-bold text-slate-800 text-sm">Drag and drop audio files</p>
                    <p className="text-[11px] text-slate-400 max-w-xs mx-auto mt-1 leading-normal">
                      Your files will be encrypted at rest and processed using our proprietary acoustic model.
                    </p>
                  </div>

                  <button className="bg-[#1a237e] hover:bg-[#121b74] text-white px-5 py-2.5 rounded-full text-xs font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer mt-1 pointer-events-none">
                    <Upload className="w-3.5 h-3.5" /> Select File from Desktop
                  </button>

                  <div className="flex flex-col items-center gap-1 mt-2">
                    <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">SUPPORTED FORMATS</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      {['MP3', 'WAV', 'WEBM', 'M4A', 'FLAC'].map((fmt) => (
                        <span key={fmt} className="text-[9.5px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          {fmt}
                        </span>
                      ))}
                    </div>
                    <span className="text-[9px] font-semibold text-slate-400 mt-1">MAX 50MB PER FILE</span>
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
                <h3 className="text-lg font-bold text-slate-800">Voice Recording</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed mt-1">
                  Record live speech directly from your browser. The stream will be transcribed and indexed locally.
                </p>
              </div>

              <div className="w-full max-w-xl mx-auto border border-slate-200/50 bg-[#f9fafc]/50 rounded-[2rem] p-6 flex flex-col items-center gap-4">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {recordState === 'idle' && 'Microphone Ready'}
                    {recordState === 'recording' && 'Recording Audio'}
                    {recordState === 'paused' && 'Recording Paused'}
                    {recordState === 'ready' && 'Audio Captured'}
                    {recordState === 'processing' && 'RAG Indexing...'}
                  </span>
                  
                  <span className="text-3xl font-bold text-slate-800 font-mono tracking-tight my-1">
                    {fmt(recordingTime)}
                  </span>

                  {recordState === 'recording' && (
                    <div className="flex items-center gap-[3px] h-3.5 mt-1">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="w-[2.5px] h-4 bg-[#1a237e] rounded-full wave-line" />
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {recordState === 'idle' && (
                    <button
                      onClick={startRecording}
                      className="bg-[#1a237e] hover:bg-[#121b74] text-white font-semibold py-2.5 px-6 rounded-full text-xs cursor-pointer flex items-center gap-2 active:scale-95 transition-all shadow-sm"
                    >
                      <Mic className="w-3.5 h-3.5" /> Start Recording
                    </button>
                  )}
                  {recordState === 'recording' && (
                    <>
                      <button onClick={pauseRecording} className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-full text-xs cursor-pointer">
                        Pause
                      </button>
                      <button onClick={stopRecording} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 px-4 rounded-full text-xs cursor-pointer">
                        Stop
                      </button>
                    </>
                  )}
                  {recordState === 'paused' && (
                    <>
                      <button onClick={resumeRecording} className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-full text-xs cursor-pointer">
                        Resume
                      </button>
                      <button onClick={stopRecording} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 px-4 rounded-full text-xs cursor-pointer">
                        Stop
                      </button>
                    </>
                  )}
                  {recordState === 'ready' && (
                    <>
                      <button
                        onClick={submitIngestion}
                        className="bg-[#1a237e] hover:bg-[#121b74] text-white font-semibold py-2.5 px-6 rounded-full text-xs shadow-sm cursor-pointer transition-all flex items-center gap-1.5"
                      >
                        Ingest Recording <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={resetRecorder} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold py-2.5 px-4 rounded-full text-xs cursor-pointer">
                        Discard
                      </button>
                    </>
                  )}
                  {recordState === 'processing' && (
                    <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold animate-pulse">
                      <Loader2 className="w-4 h-4 animate-spin text-[#1a237e]" /> Indexing stream...
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
