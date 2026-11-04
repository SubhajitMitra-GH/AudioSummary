'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Pause, Play, Square, Upload, Link2, ArrowRight, Trash2, Mic, Loader2 } from 'lucide-react';
import { encryptText } from '../utils/crypto';
import { apiFetch, readErrorDetail, MAX_UPLOAD_MB, ENGINE_IS_SERVER, ENGINE_PLACE } from '../utils/api';
import { LevelMeter, SpeechBars } from './ui/Brand';
import { newId } from '../utils/ids';

interface AudioRecorderProps {
  onIngestSuccess: (sessionId: string, transcript: string) => void;
  currentSessionId: string | null;
  /** 'landing' = full deck for a new conversation; 'compact' = add a recording inside a conversation */
  variant?: 'landing' | 'compact';
}

type Tab = 'record' | 'upload' | 'link';
type RecordState = 'idle' | 'recording' | 'paused' | 'processing' | 'ready';

const FORMATS = ['MP3', 'WAV', 'M4A', 'OGG', 'FLAC', 'WEBM'];

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'record', label: 'Record' },
  { tab: 'upload', label: 'File' },
  { tab: 'link', label: 'Link' },
];

function PrimaryButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt px-5 py-2.5 font-semibold text-[0.95rem] cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label} <ArrowRight className="w-4 h-4" />
    </button>
  );
}

function SecondaryButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2.5 text-[0.92rem] text-ink hover:border-ink cursor-pointer"
    >
      {icon} {label}
    </button>
  );
}

export default function AudioRecorder({
  onIngestSuccess,
  currentSessionId,
  variant = 'landing',
}: AudioRecorderProps) {
  const compact = variant === 'compact';
  const [activeTab, setActiveTab] = useState<Tab>('record');
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState<string>('');
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /** Stop the microphone and timer without keeping the recording. */
  const releaseMic = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setMicStream(null);
  }, []);

  // Turn the microphone off if the component goes away mid-recording.
  useEffect(() => releaseMic, [releaseMic]);

  const startRecording = async () => {
    setError(null);
    // Browsers only allow the microphone on secure pages (https, localhost, the Mac app).
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Recording isn’t available on this page: browsers only allow the microphone over https or on the Mac itself. You can still upload a file or paste a link.');
      return;
    }
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
        setMicStream(null);
        if (timerRef.current) clearInterval(timerRef.current);
      };
      mediaRecorder.start(250);
      setMicStream(stream);
      setRecordState('recording');
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      setError('Tell Me. needs microphone access to record. Allow it in System Settings → Privacy & Security → Microphone.');
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

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`This file is larger than the ${MAX_UPLOAD_MB} MB limit.`);
      return;
    }
    setUploadFile(file);
    setAudioBlob(file);
    setRecordState('ready');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const resetRecorder = () => {
    releaseMic();
    setAudioBlob(null);
    setUploadFile(null);
    setLinkUrl('');
    setRecordState('idle');
    setRecordingTime(0);
  };

  /** Create the session record after a successful ingestion into a brand-new session. */
  const createSessionIfNew = async (sessionId: string) => {
    if (currentSessionId) return;
    const now = new Date();
    const rawTitle = `Session ${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const res = await apiFetch('/sessions', {
      method: 'POST',
      body: JSON.stringify({ id: sessionId, session_title: encryptText(rawTitle) }),
    });
    if (!res.ok) throw new Error(`Could not create the session: ${await readErrorDetail(res)}`);
  };

  const errorMessage = (e: unknown) =>
    e instanceof TypeError
      ? 'Could not reach the local server. Make sure the backend is running.'
      : (e instanceof Error ? e.message : String(e));

  const submitIngestion = async () => {
    if (!audioBlob) return;
    setError(null);
    setRecordState('processing');
    const sessionId = currentSessionId || newId();
    const formData = new FormData();
    formData.append('file', audioBlob, uploadFile ? uploadFile.name : `rec_${Date.now()}.webm`);
    formData.append('session_id', sessionId);
    try {
      const res = await apiFetch('/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const result = await res.json();
      await createSessionIfNew(sessionId);
      onIngestSuccess(sessionId, result.transcript);
      resetRecorder();
    } catch (e) {
      setError(`Couldn't transcribe this recording. ${errorMessage(e)}`);
      setRecordState('ready');
    }
  };

  const submitLinkIngestion = async () => {
    if (!linkUrl.trim()) return;
    setError(null);
    setRecordState('processing');
    const sessionId = currentSessionId || newId();
    try {
      const res = await apiFetch('/upload-link', {
        method: 'POST',
        body: JSON.stringify({ url: linkUrl.trim(), session_id: sessionId }),
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const result = await res.json();
      await createSessionIfNew(sessionId);
      onIngestSuccess(sessionId, result.transcript);
      resetRecorder();
    } catch (e) {
      setError(`Couldn't use this link. ${errorMessage(e)}`);
      setRecordState('idle');
    }
  };

  const fmt = (s: number) => {
    const mins = Math.floor(s / 60).toString().padStart(2, '0');
    const secs = (s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const switchTab = (tab: Tab) => {
    if (tab === activeTab || recordState === 'processing') return;
    releaseMic();
    setActiveTab(tab);
    setRecordState('idle');
    setRecordingTime(0);
    setAudioBlob(null);
    setUploadFile(null);
    setLinkUrl('');
    setError(null);
  };

  const processing = recordState === 'processing';
  const recording = recordState === 'recording';

  /* ── Pieces ─────────────────────────────── */

  const tabBar = (
    <div role="tablist" aria-label="Source" className="inline-grid grid-cols-3 gap-1 rounded-full bg-sunk p-1">
      {TABS.map(({ tab, label }) => {
        const on = activeTab === tab;
        const Icon = tab === 'record' ? Mic : tab === 'upload' ? Upload : Link2;
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={on}
            onClick={() => switchTab(tab)}
            disabled={processing && !on}
            className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[0.9rem] font-medium cursor-pointer disabled:cursor-not-allowed ${
              on ? 'bg-surface text-ink shadow-[var(--shadow-float)]' : 'text-ink-3 hover:text-ink'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        );
      })}
    </div>
  );

  const processingNote = (
    <div className="flex items-center gap-3" aria-live="polite">
      <Loader2 className="w-5 h-5 text-cobalt animate-spin shrink-0" />
      <div>
        <p className="text-ink font-medium">Transcribing and indexing on {ENGINE_PLACE}…</p>
        <p className="text-[0.85rem] text-ink-3">Long recordings can take a few minutes. Keep {ENGINE_IS_SERVER ? 'this page' : 'the app'} open.</p>
      </div>
    </div>
  );

  const recordPanel = (
    <div className="flex flex-col gap-5">
      <div className={`rounded-2xl bg-bg px-4 ${compact ? 'py-3' : 'py-6'}`}>
        {recording || recordState === 'paused' ? (
          <LevelMeter stream={micStream} active={recording} />
        ) : (
          <SpeechBars count={40} seed={recordState === 'ready' ? 21 : 2} className="h-14 w-full"
            activeClass={recordState === 'ready' ? 'bg-cobalt' : 'bg-line-strong'} idleClass="bg-line-strong" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-baseline gap-3 mr-auto">
          <span className={`t-num ${compact ? 'text-[1.6rem]' : 'text-[2.4rem]'} leading-none text-ink`} aria-label="Recording time">{fmt(recordingTime)}</span>
          <span className="inline-flex items-center gap-1.5 text-[0.85rem] text-ink-3">
            {recording && <span className="w-2 h-2 rounded-full bg-danger caret" aria-hidden="true" />}
            {recordState === 'idle' && 'Ready to record'}
            {recording && 'Recording'}
            {recordState === 'paused' && 'Paused'}
            {recordState === 'ready' && 'Captured'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {recordState === 'idle' && (
            <button
              onClick={startRecording}
              className="inline-flex items-center gap-2.5 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt pl-4 pr-5 py-2.5 font-semibold cursor-pointer active:scale-[0.98]"
            >
              <Mic className="w-4 h-4" /> Start recording
            </button>
          )}
          {recording && (
            <>
              <SecondaryButton label="Pause" icon={<Pause className="w-4 h-4" />} onClick={pauseRecording} />
              <SecondaryButton label="Stop" icon={<Square className="w-3.5 h-3.5" />} onClick={stopRecording} />
            </>
          )}
          {recordState === 'paused' && (
            <>
              <SecondaryButton label="Resume" icon={<Play className="w-4 h-4" />} onClick={resumeRecording} />
              <SecondaryButton label="Stop" icon={<Square className="w-3.5 h-3.5" />} onClick={stopRecording} />
            </>
          )}
          {recordState === 'ready' && (
            <>
              <PrimaryButton label="Transcribe & index" onClick={submitIngestion} />
              <SecondaryButton label="Discard" icon={<Trash2 className="w-4 h-4" />} onClick={resetRecorder} />
            </>
          )}
        </div>
      </div>
      {processing && processingNote}
    </div>
  );

  const uploadPanel = uploadFile ? (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-2xl bg-bg px-4 py-4">
        <span className="w-11 h-11 rounded-xl bg-cobalt-wash flex items-center justify-center shrink-0"><Upload className="w-5 h-5 text-cobalt" /></span>
        <div className="min-w-0">
          <p className="text-ink font-medium truncate">{uploadFile.name}</p>
          <p className="t-num text-[0.75rem] text-ink-3 mt-0.5">{(uploadFile.size / 1048576).toFixed(1)} MB</p>
        </div>
      </div>
      {processing ? processingNote : (
        <div className="flex flex-wrap items-center gap-2.5">
          <PrimaryButton label="Transcribe & index" onClick={submitIngestion} />
          <SecondaryButton label="Remove" icon={<Trash2 className="w-4 h-4" />} onClick={resetRecorder} />
        </div>
      )}
    </div>
  ) : (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files?.[0]); }}
      className={`flex ${compact ? 'flex-row items-center gap-4 py-4' : 'flex-col items-center text-center gap-3 py-12'} px-5 rounded-2xl border-2 border-dashed cursor-pointer ${
        dragging ? 'border-cobalt bg-cobalt-wash' : 'border-line-strong hover:border-cobalt bg-bg'
      }`}
    >
      <span className="w-12 h-12 rounded-2xl bg-surface border border-line flex items-center justify-center shrink-0">
        <Upload className="w-5 h-5 text-cobalt" />
      </span>
      <div>
        <p className="text-ink font-medium">{dragging ? 'Drop to add it' : 'Drop an audio file here, or click to choose'}</p>
        <p className="mt-1 t-num text-[0.72rem] text-ink-3">{FORMATS.join(' · ')} · up to {MAX_UPLOAD_MB} MB</p>
      </div>
      <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm" onChange={handleFileChange} className="sr-only" />
    </label>
  );

  const linkPanel = (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => { e.preventDefault(); submitLinkIngestion(); }}
        className="flex flex-col sm:flex-row gap-2.5"
      >
        <label className="flex-1 flex items-center gap-3 rounded-full border border-line bg-bg px-4 focus-within:border-cobalt focus-within:bg-surface">
          <Link2 className="w-4 h-4 text-ink-3 shrink-0" />
          <span className="sr-only">Audio or YouTube link</span>
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            disabled={processing}
            placeholder="Paste a YouTube or direct audio link"
            className="w-full bg-transparent py-3 text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>
        {!processing && (
          <button
            type="submit"
            disabled={!linkUrl.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt px-5 py-3 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Fetch & index <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </form>
      {processing ? processingNote : (
        <p className="text-[0.85rem] text-ink-3 px-1">The audio is downloaded to {ENGINE_PLACE}, transcribed, then deleted. Links need internet.</p>
      )}
    </div>
  );

  const card = (
    <div className={`rounded-[24px] bg-surface border border-line ${compact ? 'p-4' : 'p-5 sm:p-7'} shadow-[var(--shadow-pop)]`}>
      {tabBar}
      <div className={compact ? 'pt-4' : 'pt-6'}>
        {activeTab === 'record' && recordPanel}
        {activeTab === 'upload' && uploadPanel}
        {activeTab === 'link' && linkPanel}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-danger-wash px-4 py-3 text-[0.9rem] leading-relaxed text-danger">{error}</p>
        )}
      </div>
    </div>
  );

  if (compact) return card;

  return (
    <div className="w-full max-w-[42rem] mx-auto flex flex-col gap-8 py-10 px-4 sm:px-6">
      <div>
        <h2 className="t-display text-[clamp(2.6rem,6vw,4rem)]">Add a recording.</h2>
        <p className="mt-4 text-[1.08rem] leading-relaxed text-ink-2 max-w-[34rem]">
          Record now, drop in a file, or paste a link. It&apos;s transcribed on {ENGINE_PLACE}, then you can ask it anything.
        </p>
      </div>
      {card}
      <p className="flex items-center gap-2 text-[0.85rem] text-ink-3">
        <span className="w-2 h-2 rounded-full bg-success shrink-0" />
        {ENGINE_IS_SERVER
          ? 'Online, audio is sent to the Tell Me server, transcribed there and deleted. The Mac app keeps it on your Mac.'
          : 'Audio is processed on this Mac and deleted after transcription.'}
      </p>
    </div>
  );
}
