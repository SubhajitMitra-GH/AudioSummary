'use client';

import React, { useEffect, useRef } from 'react';

/* Shared brand pieces: wordmark, speech bars, live mic meter. */

/** "Tell Me." — the full stop is a cobalt dot. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`t-display inline-flex items-baseline text-ink ${className}`} style={{ letterSpacing: '-0.04em', lineHeight: 1 }}>
      Tell Me
      <span
        aria-hidden="true"
        className="inline-block rounded-full ml-[0.05em] bg-cobalt"
        style={{ width: '0.22em', height: '0.22em' }}
      />
      <span className="sr-only">.</span>
    </span>
  );
}

/** Deterministic pseudo-random bar heights so server and client render the same. */
function barHeights(count: number, seed: number) {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < count; i++) {
    x = (x * 9301 + 49297) % 233280;
    const r = x / 233280;
    const envelope = 0.45 + 0.55 * Math.sin((i / count) * Math.PI);
    out.push(Math.max(0.12, Math.min(1, envelope * (0.35 + r * 0.75))));
  }
  return out;
}

/** A speech waveform drawn as rounded bars. `progress` (0..1) colours the played part. */
export function SpeechBars({
  count = 48,
  seed = 7,
  progress = 1,
  breathing = false,
  className = '',
  activeClass = 'bg-cobalt',
  idleClass = 'bg-line-strong',
}: {
  count?: number;
  seed?: number;
  progress?: number;
  breathing?: boolean;
  className?: string;
  activeClass?: string;
  idleClass?: string;
}) {
  const heights = barHeights(count, seed);
  return (
    <div className={`flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          className={`flex-1 min-w-[2px] rounded-full ${i / count < progress ? activeClass : idleClass} ${breathing ? 'bar-breathe' : ''}`}
          style={{ height: `${h * 100}%`, animationDelay: breathing ? `${(i % 12) * 90}ms` : undefined }}
        />
      ))}
    </div>
  );
}

/** Three small bars that pulse while the local model is working. */
export function Thinking({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[3px] h-4 ${className}`} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] h-full rounded-full bg-cobalt bar-breathe" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

const SEGMENTS = 40;

/**
 * Live microphone waveform. Bars follow the real input level from a Web Audio analyser;
 * drawn with refs inside requestAnimationFrame so React doesn't re-render per frame.
 */
export function LevelMeter({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const paint = (levels: number[]) => {
      barRefs.current.forEach((el, i) => {
        if (el) el.style.transform = `scaleY(${Math.max(0.08, levels[i] ?? 0)})`;
      });
    };
    if (!stream || !active) {
      paint(new Array(SEGMENTS).fill(0.08));
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const history: number[] = new Array(SEGMENTS).fill(0.08);
    let raf = 0;
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const db = 20 * Math.log10(rms + 1e-6);
      const level = Math.max(0, Math.min(1, (db + 55) / 50));
      // scroll the history left every few frames, newest level on the right
      if (++frame % 3 === 0) {
        history.shift();
        history.push(level);
      } else {
        history[history.length - 1] = Math.max(history[history.length - 1], level);
      }
      paint(history);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close();
    };
  }, [stream, active]);

  return (
    <div className="flex items-center gap-[3px] h-14 w-full" role="img" aria-label="Microphone input level">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <span
          key={i}
          ref={(el) => { barRefs.current[i] = el; }}
          className="flex-1 h-full rounded-full bg-cobalt"
          style={{ transform: 'scaleY(0.08)', transition: 'transform 90ms linear', opacity: 0.35 + (i / SEGMENTS) * 0.65 }}
        />
      ))}
    </div>
  );
}
