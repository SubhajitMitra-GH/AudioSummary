'use client';

import React, { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────
   Token estimates. These are ESTIMATES from stated assumptions,
   not measurements; the page says so next to every chart.
   ───────────────────────────────────────────────────────── */

export const ASSUME = {
  wordsPerMin: 150, // typical speaking rate
  tokensPerMin: 200, // ≈150 words × 1.33 tokens per word
  charsPerMin: 855, // ≈150 words × 5.7 characters
  passageChars: 1000, // Tell Me. chunk size (backend: chunk_size=1000)
  passageOverlap: 150, // chunk_overlap=150
  passageTokens: 235, // ≈1,000 characters
  passagesSent: 6, // retrieve_context(k=6)
  promptTokens: 250, // Tell Me.'s instruction template + question
  chatOverhead: 50, // question + short instruction when pasting into a chatbot
  turnTokens: 150, // one earlier question + answer carried in chat history
};

export const tokensCloud = (min: number) => min * ASSUME.tokensPerMin + ASSUME.chatOverhead;
export const tokensTellMe = (min: number) =>
  Math.min(min * ASSUME.tokensPerMin, ASSUME.passagesSent * ASSUME.passageTokens) + ASSUME.promptTokens;
export const passageCount = (min: number) =>
  Math.max(1, Math.ceil((min * ASSUME.charsPerMin - ASSUME.passageOverlap) / (ASSUME.passageChars - ASSUME.passageOverlap)));

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

/* ── Line chart: tokens per question vs recording length ── */

const H = 300;
const X_MAX = 180;
const Y_MAX = 40000;

export function TokenLineChart({ minutes, onMinutes }: { minutes: number; onMinutes: (m: number) => void }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width so text stays readable on phones.
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 480;
  const PAD = { l: 44, r: narrow ? 22 : 84, t: 16, b: 40 };
  const xOf = (m: number) => PAD.l + (m / X_MAX) * (W - PAD.l - PAD.r);
  const yOf = (t: number) => H - PAD.b - (t / Y_MAX) * (H - PAD.t - PAD.b);
  const shown = hover ?? minutes;

  const cloudPath = `M${xOf(0)} ${yOf(tokensCloud(0))} L${xOf(X_MAX)} ${yOf(tokensCloud(X_MAX))}`;
  const pts: string[] = [];
  for (let m = 0; m <= X_MAX; m += 1) pts.push(`${xOf(m)} ${yOf(tokensTellMe(m))}`);
  const tellPath = `M${pts.join(' L')}`;

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const m = Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * X_MAX);
    return Math.max(5, Math.min(X_MAX, m));
  };

  const cx = xOf(shown);
  const cloudY = yOf(tokensCloud(shown));
  const tellY = yOf(tokensTellMe(shown));
  const tipLeft = (cx / W) * 100;
  const xTicks = narrow ? [0, 60, 120, 180] : [0, 30, 60, 90, 120, 150, 180];

  return (
    <div ref={wrapRef} className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none select-none"
        role="img"
        aria-label={`Line chart. Tokens sent per question by recording length. At ${shown} minutes a cloud chatbot with the pasted transcript receives about ${fmt(tokensCloud(shown))} tokens; Tell Me.'s local model receives about ${fmt(tokensTellMe(shown))}.`}
        onPointerMove={(e) => setHover(pick(e))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => { const m = pick(e); if (m) onMinutes(m); }}
      >
        {[0, 10000, 20000, 30000, 40000].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yOf(t)} y2={yOf(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.l - 8} y={yOf(t) + 4} textAnchor="end" className="t-num" fontSize="12" fill="var(--ink-3)">{compact(t)}</text>
          </g>
        ))}
        {xTicks.map((m) => (
          <text key={m} x={xOf(m)} y={H - PAD.b + 22} textAnchor="middle" className="t-num" fontSize="12" fill="var(--ink-3)">
            {m === 0 ? '0' : `${m}m`}
          </text>
        ))}

        <path d={`${cloudPath} L${xOf(X_MAX)} ${yOf(0)} L${xOf(0)} ${yOf(0)} Z`} fill="var(--ember)" opacity="0.08" />
        <path d={`${tellPath} L${xOf(X_MAX)} ${yOf(0)} L${xOf(0)} ${yOf(0)} Z`} fill="var(--cobalt)" opacity="0.1" />
        <path d={cloudPath} fill="none" stroke="var(--ember)" strokeWidth="2" strokeLinecap="round" />
        <path d={tellPath} fill="none" stroke="var(--cobalt)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {!narrow && (
          <g>
            <line x1={W - PAD.r + 8} x2={W - PAD.r + 20} y1={yOf(tokensCloud(X_MAX))} y2={yOf(tokensCloud(X_MAX))} stroke="var(--ember)" strokeWidth="2" />
            <text x={W - PAD.r + 24} y={yOf(tokensCloud(X_MAX)) + 4} fontSize="12" fill="var(--ink-2)">Chatbot</text>
            <line x1={W - PAD.r + 8} x2={W - PAD.r + 20} y1={yOf(tokensTellMe(X_MAX))} y2={yOf(tokensTellMe(X_MAX))} stroke="var(--cobalt)" strokeWidth="2" />
            <text x={W - PAD.r + 24} y={yOf(tokensTellMe(X_MAX)) + 4} fontSize="12" fill="var(--ink-2)">Tell Me.</text>
          </g>
        )}

        <line x1={cx} x2={cx} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink-3)" strokeWidth="1" opacity="0.5" />
        <circle cx={cx} cy={cloudY} r="5" fill="var(--ember)" stroke="var(--surface)" strokeWidth="2" />
        <circle cx={cx} cy={tellY} r="5" fill="var(--cobalt)" stroke="var(--surface)" strokeWidth="2" />
      </svg>
      <p className="text-right text-[0.75rem] text-ink-3 -mt-1">recording length (minutes)</p>

      <div
        className="pointer-events-none absolute top-24 rounded-xl bg-surface border border-line px-3 py-2 text-[0.8rem] shadow-[var(--shadow-float)] whitespace-nowrap"
        style={{ left: `${tipLeft}%`, transform: tipLeft > 55 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
      >
        <p className="font-semibold text-ink">{shown} min recording</p>
        <p className="mt-1 flex items-center gap-2 text-ink-2"><span className="w-2.5 h-0.5 bg-ember rounded" />Chatbot <span className="t-num ml-auto pl-3 text-ink">{fmt(tokensCloud(shown))}</span></p>
        <p className="flex items-center gap-2 text-ink-2"><span className="w-2.5 h-0.5 bg-cobalt rounded" />Tell Me. <span className="t-num ml-auto pl-3 text-ink">{fmt(tokensTellMe(shown))}</span></p>
      </div>
    </div>
  );
}

/* ── Bars: a 10-question conversation ── */

export function SessionBars({ minutes, questions = 10 }: { minutes: number; questions?: number }) {
  const T = minutes * ASSUME.tokensPerMin;
  // Chatbot: each question re-sends the pasted transcript plus the growing chat history.
  let cloud = 0;
  for (let q = 0; q < questions; q++) cloud += T + ASSUME.chatOverhead + q * ASSUME.turnTokens;
  // Tell Me.: each question sends only its own passages; no history.
  const tell = questions * tokensTellMe(minutes);
  const max = Math.max(cloud, tell);
  const rows = [
    { label: 'Chatbot', value: cloud, cls: 'bg-ember' },
    { label: 'Tell Me.', value: tell, cls: 'bg-cobalt' },
  ];
  return (
    <div className="flex flex-col gap-4" role="img" aria-label={`Bar chart. Total tokens over a ${questions}-question conversation about a ${minutes}-minute recording: chatbot about ${fmt(cloud)}, Tell Me. about ${fmt(tell)}.`}>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-3">
          <span className="text-[0.85rem] text-ink-2">{r.label}</span>
          <div className="h-6 min-w-0">
            <div
              className={`h-full w-full rounded-r-[4px] origin-left ${r.cls}`}
              style={{ transform: `scaleX(${Math.max(0.01, r.value / max)})`, transition: 'transform 400ms var(--ease-out)' }}
            />
          </div>
          <span className="t-num text-[0.85rem] text-ink text-right whitespace-nowrap">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Dot grid: which passages reach the model ── */

export function PassageGrid({ minutes }: { minutes: number }) {
  const n = Math.min(passageCount(minutes), 240);
  // the 6 "most relevant" passages, spread deterministically through the recording
  const picked = new Set([0.08, 0.21, 0.37, 0.52, 0.68, 0.86].map((f) => Math.min(n - 1, Math.floor(f * n))));
  return (
    <div>
      <div className="flex flex-wrap gap-[5px]" role="img" aria-label={`${n} passages in a ${minutes}-minute transcript; only ${Math.min(6, n)} are sent to the model.`}>
        {Array.from({ length: n }).map((_, i) => (
          <span
            key={i}
            className={`w-[10px] h-[10px] rounded-[3px] ${picked.has(i) ? 'bg-cobalt' : 'bg-line'}`}
            style={picked.has(i) ? { boxShadow: '0 0 0 2px var(--surface), 0 0 0 4px var(--cobalt-wash)' } : undefined}
          />
        ))}
      </div>
      <p className="mt-3 text-[0.85rem] text-ink-3">
        <span className="t-num text-ink">{n}</span> passages in the transcript ·{' '}
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-cobalt" />
          <span className="t-num text-ink">{Math.min(6, n)}</span> sent to the model</span>
      </p>
    </div>
  );
}

/** Table view of the line chart (accessibility + exact values). */
export function TokenTable() {
  const rows = [10, 30, 60, 90, 120, 180];
  return (
    <table className="w-full text-left text-[0.88rem]">
      <thead>
        <tr className="border-b border-line text-ink-3">
          <th scope="col" className="py-2 font-medium">Recording</th>
          <th scope="col" className="py-2 font-medium text-right">Chatbot (pasted transcript)</th>
          <th scope="col" className="py-2 font-medium text-right">Tell Me.</th>
          <th scope="col" className="py-2 font-medium text-right">Fewer tokens</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m} className="border-b border-line">
            <td className="py-2 t-num">{m} min</td>
            <td className="py-2 t-num text-right">{fmt(tokensCloud(m))}</td>
            <td className="py-2 t-num text-right">{fmt(tokensTellMe(m))}</td>
            <td className="py-2 t-num text-right">{(tokensCloud(m) / tokensTellMe(m)).toFixed(1)}×</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
