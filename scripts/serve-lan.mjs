#!/usr/bin/env node
// Share Tell Me with people on the same Wi-Fi, for testing (see scripts/serve-lan.sh).
//
//   http://<this Mac's IP>:3001        → the static site (frontend/.lan-site, built with API base "/api")
//   http://<this Mac's IP>:3001/api/…  → the local backend at 127.0.0.1:8000 (which stays private)
//
// Everything goes through one port, so visitors' browsers never need to reach 127.0.0.1 and no CORS
// change is needed. Redis and Ollama stay local. Stop with Ctrl+C.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../frontend/.lan-site');
const PORT = Number(process.env.LAN_PORT || 3001);
const BACKEND = { host: '127.0.0.1', port: 8000 };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.map': 'application/json',
};

function proxy(req, res) {
  const headers = { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` };
  delete headers.origin; // same-origin for the visitor; the backend's CORS list stays app:// + localhost
  delete headers.referer;
  const upstream = http.request(
    { ...BACKEND, method: req.method, path: req.url.replace(/^\/api/, '') || '/', headers },
    (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'The Tell Me engine on the host Mac is not running.' }));
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }
  const candidates = [pathname, `${pathname}.html`, path.join(pathname, 'index.html')];
  for (const c of candidates) {
    const file = path.normalize(path.join(ROOT, c));
    if (!file.startsWith(ROOT)) break; // no path traversal
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': TYPES['.html'] });
  fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No site at ${ROOT}. Run scripts/serve-lan.sh (it builds it first).`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) proxy(req, res);
  else serveStatic(req, res);
});
server.requestTimeout = 0; // transcribing a long link can take many minutes
server.headersTimeout = 60_000;
server.listen(PORT, '0.0.0.0', () => console.log(`Tell Me on your Wi-Fi: port ${PORT} (Ctrl+C to stop)`));
