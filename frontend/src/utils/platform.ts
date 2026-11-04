/** Where the UI is running: inside the Mac app (Electron) or in a web browser. */

declare global {
  interface Window {
    tellme?: {
      isDesktop: boolean;
      platform: string;
      /** Next tellme:// link macOS handed to the app (password-reset email), or null. */
      takeAuthLink?: () => Promise<string | null>;
      /** Called when a new tellme:// link arrives; returns an unsubscribe function. */
      onAuthLink?: (callback: () => void) => () => void;
    };
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && window.tellme?.isDesktop === true;
}

export const REPO = 'SubhajitMitra-GH/AudioSummary';
export const DOWNLOAD_ASSET = 'Tell-Me-mac-arm64.zip';
/** Always points at the newest published release's Mac download. */
export const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/${DOWNLOAD_ASSET}`;
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

export interface ReleaseInfo {
  version: string;
  sizeMb: number | null;
  publishedAt: string | null;
}

/** Version and size of the latest release, from GitHub's public API (best effort). */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const asset = Array.isArray(data.assets) ? data.assets.find((a: { name?: string }) => a.name === DOWNLOAD_ASSET) : null;
    return {
      version: typeof data.tag_name === 'string' ? data.tag_name : '',
      sizeMb: asset && typeof asset.size === 'number' ? Math.round(asset.size / 1048576) : null,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
    };
  } catch {
    return null;
  }
}

export type VisitorPlatform = 'mac' | 'windows' | 'mobile' | 'other';

/** Which kind of device a browser user agent belongs to (only Macs can run the desktop app). */
export function detectPlatform(ua: string, maxTouchPoints = 0): VisitorPlatform {
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'mobile';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/Macintosh|Mac OS X/.test(ua)) return maxTouchPoints > 1 ? 'mobile' : 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  return 'other';
}

/** The visitor's platform in the browser. Before hydration (static HTML) it assumes a Mac. */
export function visitorPlatform(): VisitorPlatform {
  if (typeof navigator === 'undefined') return 'mac';
  return detectPlatform(navigator.userAgent || '', navigator.maxTouchPoints || 0);
}

/** Path prefix when the website is hosted in a sub-folder (GitHub Pages: "/AudioSummary"); "" otherwise. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
