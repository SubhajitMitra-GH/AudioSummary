'use client';

import React, { useState, useEffect } from 'react';
import { Cpu, Download, Loader2, RefreshCw, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';

interface OllamaStatus {
  ollama_running: boolean;
  model_pulled: boolean;
  configured_model: string;
}

interface OllamaSetupWizardProps {
  status: OllamaStatus;
  onComplete: () => void;
}

export default function OllamaSetupWizard({ status, onComplete }: OllamaSetupWizardProps) {
  const [installState, setInstallState] = useState<'idle' | 'downloading' | 'extracting' | 'starting' | 'error'>('idle');
  const [installProgress, setInstallProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);

  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatus, setPullStatus] = useState<string>('');
  const [pullDetails, setPullDetails] = useState<string>('');

  const [verifying, setVerifying] = useState(false);

  // Poll local installation status if we triggered auto-install
  useEffect(() => {
    if (installState === 'idle' || installState === 'error') return;

    let intervalId = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:8000/ollama/install/status');
        if (res.ok) {
          const data = await res.json();
          // Map backend states
          if (data.status.startsWith('error')) {
            setInstallState('error');
            setInstallError(data.status.replace('error: ', ''));
            clearInterval(intervalId);
          } else if (data.status === 'completed') {
            setInstallState('idle');
            setInstallProgress(100);
            clearInterval(intervalId);
            handleVerify();
          } else {
            setInstallState(data.status);
            setInstallProgress(data.progress);
          }
        }
      } catch (err) {
        console.error('Error checking install status:', err);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [installState]);

  const handleAutoInstall = async () => {
    setInstallState('downloading');
    setInstallProgress(0);
    setInstallError(null);
    try {
      const res = await fetch('http://localhost:8000/ollama/install', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger installation.');
    } catch (err: any) {
      setInstallState('error');
      setInstallError(err.message || 'Failed to trigger installation.');
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    // Give backend a second to verify status
    setTimeout(() => {
      onComplete();
      setVerifying(false);
    }, 1500);
  };

  const handlePullModel = async () => {
    setPulling(true);
    setPullProgress(0);
    setPullStatus('Connecting to Ollama pull registry...');
    setPullDetails('');
    
    try {
      const res = await fetch('http://localhost:8000/ollama/pull', { method: 'POST' });
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
          try {
            const data = JSON.parse(line);
            
            if (data.status === 'error') {
              throw new Error(data.message || 'Failed to download model.');
            }
            
            setPullStatus(data.status);
            
            if (data.completed && data.total) {
              const pct = (data.completed / data.total) * 100;
              setPullProgress(Math.round(pct * 10) / 10);
              
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
          } catch (err) {
            // Ignore parse errors of partial lines
          }
        }
      }
    } catch (err: any) {
      console.error('Pull failed:', err);
      alert(`Model download failed: ${err.message}`);
      setPulling(false);
    }
  };

  const renderInstaller = () => {
    const isInstalling = ['downloading', 'extracting', 'starting'].includes(installState);

    return (
      <div className="flex flex-col gap-6 select-none">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 shadow-lg shadow-amber-900/10 shrink-0 animate-pulse">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Ollama Engine Required</h2>
            <p className="text-xs text-slate-400 font-semibold tracking-wide mt-0.5">Local AI engine missing</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed font-medium">
          To run speech transcription and answer questions securely on your own hardware, this application requires <strong>Ollama</strong> to be installed on your machine.
        </p>

        {/* Action Panel */}
        {isInstalling ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span className="capitalize">{installState === 'downloading' ? `Downloading Ollama App (${installProgress}%)` : `${installState}...`}</span>
              <Loader2 className="w-4 h-4 animate-spin text-[#562cd6]" />
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${installProgress}%` }}
              />
            </div>
            <span className="text-[10px] font-semibold text-slate-400">Please do not close the application. Extracting and launching will complete automatically.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={handleAutoInstall}
              disabled={verifying}
              className="w-full py-3.5 bg-[#562cd6] hover:bg-[#431fb5] text-white rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 cursor-pointer active:scale-98 transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Auto-Download & Install Ollama
            </button>

            <a
              href="https://ollama.com/download/Ollama-darwin.zip"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 bg-slate-800/40 hover:bg-slate-800/60 border border-slate-850 text-slate-300 rounded-full font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all text-center"
            >
              Manual Download from Ollama.com
            </a>

            <div className="h-px bg-slate-800/60 my-2" />

            <button
              onClick={handleVerify}
              disabled={verifying}
              className="w-full py-3.5 bg-slate-900/60 hover:bg-slate-950 border border-slate-800 text-slate-200 rounded-full font-bold text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-98 transition-all disabled:opacity-50"
            >
              {verifying ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              ) : (
                <>
                  I have launched Ollama - Verify Status <RefreshCw className="w-4 h-4 text-slate-400" />
                </>
              )}
            </button>
          </div>
        )}

        {installError && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold p-4 rounded-xl flex items-start gap-2 animate-fade-in leading-relaxed">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <div>
              <p className="font-bold">Installation Error</p>
              <p className="text-[11px] text-red-400/80 mt-0.5">{installError}</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderModelPuller = () => {
    return (
      <div className="flex flex-col gap-6 select-none">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-900/10 shrink-0 animate-pulse">
            <Cpu className="w-6 h-6 animate-spin" style={{ animationDuration: '3s' }} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">AI Model Setup Required</h2>
            <p className="text-xs text-slate-400 font-semibold tracking-wide mt-0.5">Model: '{status.configured_model}' missing</p>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed font-medium">
          Ollama is running successfully, but the local model <strong>{status.configured_model}</strong> (4.1 GB) is not yet downloaded. We need this file to generate answers locally on your Mac.
        </p>

        {pulling ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs font-bold text-white">
              <span className="capitalize">{pullStatus || 'Downloading model files...'}</span>
              <span className="font-mono text-indigo-400">{pullProgress}%</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300"
                style={{ width: `${pullProgress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
              <span>{pullDetails || 'Allocating disk space...'}</span>
              <span>Keep app active during pull</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              onClick={handlePullModel}
              disabled={verifying}
              className="w-full py-4 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-full font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 cursor-pointer active:scale-98 transition-all"
            >
              Download Local '{status.configured_model}' Model <ArrowRight className="w-4 h-4" />
            </button>
            <span className="text-[10px] text-center font-bold uppercase tracking-wider text-slate-500">Approx. 4.1 GB download size</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-[#070913] flex items-center justify-center p-6 relative overflow-hidden font-sans">
      {/* Background glow meshes */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-600/10 blur-[130px] pointer-events-none" />

      <div className="w-full max-w-md bg-slate-950/40 border border-slate-850 backdrop-blur-md rounded-[2.5rem] p-8 md:p-10 shadow-[0_30px_60px_rgba(0,0,0,0.5)] relative overflow-hidden">
        {!status.ollama_running ? renderInstaller() : renderModelPuller()}
      </div>
    </div>
  );
}
