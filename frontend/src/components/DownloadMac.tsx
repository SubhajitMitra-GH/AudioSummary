'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ExternalLink } from 'lucide-react';
import { DOWNLOAD_URL, RELEASES_URL, fetchLatestRelease, visitorPlatform, ReleaseInfo } from '../utils/platform';

type Variant = 'primary' | 'nav' | 'inverse';

const STEPS = [
  { title: 'Move it to Applications', body: 'Open the downloaded zip and drag Tell Me into Applications.' },
  { title: 'Allow it the first time', body: 'Control-click Tell Me → Open → Open. If macOS still blocks it: System Settings → Privacy & Security → Open Anyway.' },
  { title: 'Sign in', body: 'Use your website account, or create one.' },
  { title: 'Pick an AI model', body: 'Tell Me sets up Ollama and downloads the model you choose (1.3–4.1 GB).' },
];

const subscribeNothing = () => () => {};

/** "Download for Mac" button (shown to everyone): starts the download and shows install steps. */
export default function DownloadMac({ variant = 'primary', label = 'Download for Mac' }: { variant?: Variant; label?: string }) {
  const [open, setOpen] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const platform = useSyncExternalStore(subscribeNothing, visitorPlatform, () => 'mac' as const);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchLatestRelease().then((r) => { if (active) setRelease(r); });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => { active = false; window.removeEventListener('keydown', onKey); };
  }, [open]);

  const styles: Record<Variant, string> = {
    primary: 'rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt pl-5 pr-6 py-3.5 text-[1rem] font-semibold shadow-[0_10px_30px_-10px_rgba(47,91,255,0.6)]',
    nav: 'rounded-full bg-cobalt hover:bg-cobalt-hover text-on-cobalt px-4 py-2 text-[0.9rem] font-medium',
    inverse: 'rounded-full bg-surface text-ink hover:bg-lime hover:text-on-lime pl-5 pr-6 py-3.5 font-semibold',
  };

  return (
    <>
      <a
        href={DOWNLOAD_URL}
        onClick={() => setOpen(true)}
        className={`group inline-flex items-center gap-2.5 cursor-pointer active:scale-[0.98] ${styles[variant]}`}
      >
        <Download className="w-4 h-4" />
        {label}
      </a>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 rise-in"
          style={{ background: 'rgba(14, 17, 22, 0.45)' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Install Tell Me for Mac"
        >
          <div className="relative w-full max-w-[480px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[24px] bg-surface text-ink p-6 sm:p-7 shadow-[var(--shadow-pop)] pop-in" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-4 top-4 p-2 rounded-full text-ink-3 hover:text-ink hover:bg-sunk cursor-pointer">
              <X className="w-4 h-4" />
            </button>

            <>
                <h2 className="t-title text-[1.4rem] pr-8">Your download is starting</h2>
                {platform !== 'mac' && (
                  <p className="mt-3 rounded-xl bg-cobalt-wash px-4 py-3 text-[0.88rem] leading-relaxed text-ink">
                    Tell Me is Mac-only for now. Copy the zip to a Mac (Apple Silicon, M1 or newer) to install it. On this device you can
                    view your saved chats online.
                  </p>
                )}
                <p className="mt-1.5 text-[0.9rem] text-ink-3">
                  Tell Me for Mac{release?.version ? ` ${release.version}` : ''}{release?.sizeMb ? ` · ${release.sizeMb} MB` : ''} · Apple Silicon (M1 or newer)
                </p>

                <ol className="mt-5 flex flex-col gap-3.5">
                  {STEPS.map((s, i) => (
                    <li key={s.title} className="grid grid-cols-[1.75rem_1fr] gap-3">
                      <span className="w-7 h-7 rounded-full bg-sunk text-ink t-num text-[0.8rem] flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="font-semibold text-[0.98rem]">{s.title}</p>
                        <p className="mt-0.5 text-[0.88rem] leading-snug text-ink-2">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <p className="mt-5 rounded-xl bg-bg px-4 py-3 text-[0.8rem] leading-relaxed text-ink-3">
                  Needs macOS 12+, about 8 GB of memory, and internet for the first launch (it downloads the speech models).
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.88rem]">
                  <a href={DOWNLOAD_URL} className="inline-flex items-center gap-1.5 font-medium text-cobalt hover:underline">
                    <Download className="w-4 h-4" /> Download didn&apos;t start? Try again
                  </a>
                  <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
                    Release notes <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
            </>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
