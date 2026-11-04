'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, RefreshCw, AlertTriangle, ArrowRight, Check } from 'lucide-react';
import { SpeechBars, Wordmark } from './ui/Brand';
import { API_BASE, apiFetch, readErrorDetail, ModelOption } from '../utils/api';

type InstallState = 'idle' | 'downloading' | 'extracting' | 'starting' | 'error';

// One line of Ollama's NDJSON pull stream (or an error line from our backend).
interface PullLine {
  status?: string;
  message?: string;
  error?: string;
  completed?: number;
  total?: number;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

interface OllamaStatus {
  ollama_running: boolean;
  model_pulled: boolean;
  configured_model: string;
}

interface OllamaSetupWizardProps {
  status: OllamaStatus;
  models: ModelOption[];
  onSelectModel: (modelId: string) => Promise<void>;
  onComplete: () => void;
}

export default function OllamaSetupWizard({ status, models, onSelectModel, onComplete }: OllamaSetupWizardProps) {
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [installProgress, setInstallProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);

  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatus, setPullStatus] = useState<string>('');
  const [pullDetails, setPullDetails] = useState<string>('');
  const [pullError, setPullError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);

  const handleVerify = useCallback(() => {
    setVerifying(true);
    // Give backend a second to verify status
    setTimeout(() => {
      onComplete();
      setVerifying(false);
    }, 1500);
  }, [onComplete]);

  // Poll local installation status while an auto-install is running
  useEffect(() => {
    if (installState === 'idle' || installState === 'error') return;

    const intervalId = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/ollama/install/status`);
        if (!res.ok) return;
        const data: { status: string; progress: number } = await res.json();
        if (data.status.startsWith('error')) {
          clearInterval(intervalId);
          setInstallState('error');
          setInstallError(data.status.replace(/^error:\s*/, ''));
        } else if (data.status === 'completed' || data.status === 'launched') {
          // 'launched' = installed and opened but not answering yet; re-checking status decides.
          clearInterval(intervalId);
          setInstallState('idle');
          setInstallProgress(100);
          handleVerify();
        } else if (data.status !== 'idle') {
          setInstallState(data.status as InstallState);
          setInstallProgress(data.progress);
        }
      } catch (err) {
        console.error('Error checking install status:', err);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [installState, handleVerify]);

  const handleAutoInstall = async () => {
    setInstallState('downloading');
    setInstallProgress(0);
    setInstallError(null);
    try {
      const res = await apiFetch('/ollama/install', { method: 'POST' });
      if (!res.ok) throw new Error(await readErrorDetail(res));
    } catch (err) {
      setInstallState('error');
      setInstallError(errorText(err, 'Failed to trigger installation.'));
    }
  };

  const handlePullModel = async () => {
    setPulling(true);
    setPullProgress(0);
    setPullError(null);
    setPullStatus('Connecting to Ollama pull registry...');
    setPullDetails('');

    try {
      const res = await apiFetch('/ollama/pull', { method: 'POST' });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      if (!res.body) throw new Error('ReadableStream not supported.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let data: PullLine;
          try {
            data = JSON.parse(line);
          } catch {
            continue; // not a complete JSON line
          }

          // Errors are thrown outside the parse try/catch so they are never swallowed.
          if (data.status === 'error' || data.error) {
            throw new Error(data.message || data.error || 'Failed to download model.');
          }

          if (data.status) setPullStatus(data.status);

          if (data.completed && data.total) {
            setPullProgress(Math.round((data.completed / data.total) * 1000) / 10);
            const completedGB = (data.completed / (1024 * 1024 * 1024)).toFixed(2);
            const totalGB = (data.total / (1024 * 1024 * 1024)).toFixed(2);
            setPullDetails(`${completedGB} GB / ${totalGB} GB`);
          } else {
            setPullDetails('');
          }

          if (data.status === 'success') {
            setPullProgress(100);
            setPulling(false);
            handleVerify();
            return;
          }
        }
      }
      throw new Error('The download stopped before it finished. Please try again.');
    } catch (err) {
      console.error('Pull failed:', err);
      setPullError(errorText(err, 'Model download failed.'));
      setPulling(false);
    }
  };

  /** Make a model the active one; if it isn't downloaded yet, download it. */
  const chooseModel = async (model: ModelOption) => {
    setPullError(null);
    try {
      await onSelectModel(model.id);
    } catch (err) {
      setPullError(errorText(err, 'Could not select this model.'));
      return;
    }
    if (!model.installed) await handlePullModel();
  };

  const errorBox = (title: string, text: string) => (
    <div role="alert" className="flex items-start gap-3 rounded-2xl bg-danger-wash px-4 py-3 rise-in">
      <AlertTriangle className="w-4 h-4 shrink-0 text-danger mt-0.5" />
      <div>
        <p className="font-semibold text-[0.92rem] text-ink">{title}</p>
        <p className="text-[0.88rem] leading-relaxed text-ink-2 mt-0.5">{text}</p>
      </div>
    </div>
  );

  const progressCard = (percent: number, title: string, detail: string) => (
    <div className="rounded-[20px] bg-surface border border-line p-5 flex flex-col gap-4 shadow-[var(--shadow-float)]" aria-live="polite">
      <SpeechBars count={40} seed={13} progress={percent / 100} className="h-12 w-full" />
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium capitalize truncate">{title}</span>
        <span className="t-num text-[1.1rem] text-ink">{percent.toFixed(percent % 1 ? 1 : 0)}%</span>
      </div>
      <div className="h-2 w-full bg-sunk rounded-full overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full w-full rounded-full bg-cobalt origin-left" style={{ transform: `scaleX(${percent / 100})`, transition: 'transform 300ms var(--ease-out)' }} />
      </div>
      <div className="flex items-center justify-between gap-4 text-[0.8rem] text-ink-3">
        <span className="t-num">{detail}</span>
        <span>Keep this window open</span>
      </div>
    </div>
  );

  const renderInstaller = () => {
    const isInstalling = ['downloading', 'extracting', 'starting'].includes(installState);

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="t-display text-[2.6rem]">Install the answer engine.</h2>
          <p className="mt-4 text-[1.02rem] leading-relaxed text-ink-2">
            Tell Me. writes answers with <strong className="font-semibold text-ink">Ollama</strong>, a free app that runs open
            AI models on your Mac. It isn&apos;t running yet. If it&apos;s already installed, Tell Me starts it; otherwise it downloads and
            installs it for you.
          </p>
        </div>

        {isInstalling ? (
          progressCard(installProgress, installState === 'downloading' ? 'Downloading Ollama' : installState === 'starting' ? 'Starting Ollama…' : `${installState}…`, '')
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={handleAutoInstall}
              disabled={verifying}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer active:scale-[0.99] disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Set up Ollama
            </button>
            <a
              href="https://ollama.com/download/Ollama-darwin.zip"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 rounded-full py-3.5 border border-line-strong text-ink hover:border-ink font-medium"
            >
              Download it myself from ollama.com
            </a>
            <button
              onClick={handleVerify}
              disabled={verifying}
              className="mt-1 inline-flex items-center justify-center gap-2 py-2 text-[0.92rem] text-ink-2 hover:text-cobalt cursor-pointer disabled:opacity-50"
            >
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              I&apos;ve opened Ollama, check again
            </button>
          </div>
        )}

        {installError && errorBox('Installation failed', installError)}
      </div>
    );
  };

  const renderModelPuller = () => {
    const downloading = models.find((m) => m.id === status.configured_model);
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="t-display text-[2.6rem]">Pick the model that fits your Mac.</h2>
          <p className="mt-4 text-[1.02rem] leading-relaxed text-ink-2">
            It writes your answers, privately on this Mac. Smaller is faster; you can switch any time from the sidebar.
          </p>
        </div>

        {pulling ? (
          progressCard(pullProgress, `${downloading ? `${downloading.label}: ` : ''}${pullStatus || 'downloading'}`, pullDetails || 'preparing…')
        ) : (
          <ul className="flex flex-col gap-3">
            {models.map((model) => (
              <li
                key={model.id}
                className={`rounded-[20px] border p-4 sm:p-5 grid grid-cols-[1fr_auto] items-center gap-4 ${model.recommended ? 'border-cobalt bg-cobalt-wash' : 'border-line bg-surface'}`}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 flex-wrap">
                    <span className="t-title text-[1.1rem]">{model.label}</span>
                    {model.recommended && <span className="rounded-full bg-lime text-on-lime text-[0.7rem] font-semibold px-2 py-0.5">Recommended</span>}
                    {model.installed && <span className="inline-flex items-center gap-1 text-[0.78rem] text-success"><Check className="w-3.5 h-3.5" />Downloaded</span>}
                  </p>
                  <p className="text-[0.88rem] leading-snug text-ink-2 mt-1">{model.description}</p>
                  {model.size_gb > 0 && (
                    <p className="mt-2 t-num text-[0.75rem] text-ink-3">{model.size_gb} GB download · {model.id}</p>
                  )}
                </div>
                <button
                  onClick={() => chooseModel(model)}
                  disabled={verifying}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[0.9rem] font-semibold cursor-pointer disabled:opacity-50 ${
                    model.recommended ? 'bg-cobalt hover:bg-cobalt-hover text-on-cobalt' : 'border border-line-strong text-ink hover:border-ink bg-surface'
                  }`}
                >
                  {model.installed ? <><Check className="w-4 h-4" /> Use</> : <><Download className="w-4 h-4" /> Get</>}
                </button>
              </li>
            ))}
            {models.length === 0 && (
              <li>
                <button
                  onClick={handlePullModel}
                  disabled={verifying}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt py-3.5 font-semibold cursor-pointer"
                >
                  Download &ldquo;{status.configured_model}&rdquo; <ArrowRight className="w-4 h-4" />
                </button>
              </li>
            )}
          </ul>
        )}

        {pullError && errorBox("Couldn't download the model", pullError)}
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-bg flex flex-col">
      <header className="max-w-[1100px] w-full mx-auto px-4 sm:px-8 h-16 flex items-center justify-between">
        <Wordmark className="text-[1.5rem]" />
        <span className="text-[0.85rem] text-ink-3">Setup · {status.ollama_running ? 'step 2 of 2' : 'step 1 of 2'}</span>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 sm:px-8 py-10">
        <div className="w-full max-w-[36rem]">
          {!status.ollama_running ? renderInstaller() : renderModelPuller()}
          <p className="mt-8 flex items-center gap-2 text-[0.85rem] text-ink-3">
            <span className="w-2 h-2 rounded-full bg-success" /> One-time setup. After this, recordings are answered on this Mac, even offline while you&apos;re signed in.
          </p>
        </div>
      </div>
    </div>
  );
}
