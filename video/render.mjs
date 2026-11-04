// Render intro.html frame by frame with headless Chrome (CDP), then the caller encodes with ffmpeg.
// Usage: node render.mjs <framesDir> [fps=30] [onlyTimes=comma list for stills]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, fpsArg, only] = process.argv.slice(2);
const fps = Number(fpsArg || 30);
mkdirSync(outDir, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9466;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(outDir, '..', 'chrome-profile')}`,
  '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url: 'file://' + path.join(here, 'intro.html') + '?render=1' });
for (let i = 0; i < 100; i++) {
  try { if (await evaluate('window.ready ? window.ready.then(() => document.fonts.status) : null') === 'loaded') break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const fonts = await evaluate(`['Bricolage Grotesque','Figtree','JetBrains Mono'].map(f => f + ':' + document.fonts.check('700 40px "' + f + '"'))`);
console.log('fonts', fonts.join(' '));
const duration = await evaluate('window.DURATION');

const times = only ? only.split(',').map(Number) : Array.from({ length: Math.ceil(duration * fps) }, (_, i) => i / fps);
const t0 = Date.now();
for (let i = 0; i < times.length; i++) {
  await evaluate(`render(${times[i]}); new Promise(r => requestAnimationFrame(() => r(1)))`);
  const shot = await send('Page.captureScreenshot', { format: only ? 'png' : 'jpeg', quality: 95, optimizeForSpeed: true });
  const name = only ? `still-${String(times[i]).replace('.', '_')}.png` : `f${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(path.join(outDir, name), Buffer.from(shot.result.data, 'base64'));
  if (i % 150 === 0) console.log(`frame ${i}/${times.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`done: ${times.length} frames, duration ${duration.toFixed(2)}s`);
ws.close();
chrome.kill();
process.exit(0);
