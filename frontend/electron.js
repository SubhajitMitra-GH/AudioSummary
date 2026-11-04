const { app, BrowserWindow, protocol, net, shell, nativeTheme, ipcMain } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Register 'app' scheme as privileged to support CORS and Fetch correctly
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow;
let backendProcess;
let redisProcess;

/* ── tellme:// links (password-reset emails) ─────────────────────────────────
   Supabase sends the reset link back to tellme://reset-password?code=…; the browser hands it to
   macOS, which delivers it here (open-url), even when it launches the app. The link is kept until
   the page takes it (window.tellme.takeAuthLink in preload.js), so none is lost while loading. */
const LINK_SCHEME = 'tellme';
const pendingLinks = [];

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function receiveLink(url) {
  if (typeof url !== 'string' || !url.startsWith(`${LINK_SCHEME}://`) || url.length > 4096) return;
  pendingLinks.push(url);
  if (pendingLinks.length > 5) pendingLinks.shift();
  if (mainWindow) {
    showWindow();
    mainWindow.webContents.send('tellme:auth-link');
  } else if (app.isReady()) {
    createWindow(); // app was running with no window (macOS); the page takes the link when it loads
  }
}

// Must be registered before 'ready' so a link that launches the app isn't missed.
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveLink(url);
});

ipcMain.handle('tellme:take-auth-link', () => pendingLinks.shift() || null);

if (process.defaultApp) {
  // `npm run electron` (dev): register this Electron binary + script for tellme://.
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  // Packaged: Info.plist (package.json build.protocols) declares the scheme; this makes us the default.
  app.setAsDefaultProtocolClient(LINK_SCHEME);
}

// One running copy only: a second launch focuses the existing window
// (on Windows/Linux a tellme:// link arrives this way, as an argument).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((a) => typeof a === 'string' && a.startsWith(`${LINK_SCHEME}://`));
    if (link) receiveLink(link);
    else showWindow();
  });
}

/** Open web links (Ollama download, docs, email-confirmation pages) in the user's browser, not inside the app. */
function isExternal(url) {
  return /^https?:\/\//i.test(url) && !url.startsWith('http://localhost:3000');
}

function createWindow() {
  if (mainWindow) return; // a reset link can ask for the window before the startup timer does
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    title: 'Tell Me.',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    // Matches the app background (light / dark) so there is no flash while loading.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0f14' : '#f7f8fa',
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadURL('app://index.html').catch(err => {
      console.error('Failed to load Next.js static files via app://:', err);
    });
  }
  if (process.env.TELLME_DEVTOOLS === '1') mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Find a Redis with the search module (needed for the vector index).
 * Packaged app: Resources/redis/redis-server + redisearch.so (copied by scripts/build-desktop.sh).
 * Development: Homebrew's redis-stack-server, then a plain redis-server (Redis 8 builds with search).
 */
function resolveRedis() {
  const isDev = !app.isPackaged;
  const candidates = [];
  if (!isDev) {
    candidates.push({ bin: path.join(process.resourcesPath, 'redis', 'redis-server'), module: path.join(process.resourcesPath, 'redis', 'redisearch.so') });
  }
  for (const root of ['/opt/homebrew/Caskroom/redis-stack-server', '/usr/local/Caskroom/redis-stack-server']) {
    if (!fs.existsSync(root)) continue;
    for (const version of fs.readdirSync(root).sort().reverse()) {
      candidates.push({ bin: path.join(root, version, 'bin', 'redis-server'), module: path.join(root, version, 'lib', 'redisearch.so') });
    }
  }
  for (const bin of ['/opt/homebrew/bin/redis-server', '/usr/local/bin/redis-server']) candidates.push({ bin, module: null });

  for (const c of candidates) {
    if (fs.existsSync(c.bin)) return { bin: c.bin, module: c.module && fs.existsSync(c.module) ? c.module : null };
  }
  return { bin: 'redis-server', module: null };
}

function startServices() {
  const isDev = !app.isPackaged;

  const backendBinPath = isDev
    ? path.join(__dirname, '../backend/dist/backend-service/backend-service')
    : path.join(process.resourcesPath, 'backend-service/backend-service');

  const redis = resolveRedis();
  console.log(`Resolved Python backend path: ${backendBinPath}`);
  console.log(`Resolved Redis server path: ${redis.bin}${redis.module ? ` (+ ${redis.module})` : ''}`);

  // 1. Local Redis (cache, offline queue and vector index). Only reachable from this computer.
  try {
    const redisArgs = ['--port', '6379', '--bind', '127.0.0.1', '--protected-mode', 'yes'];
    if (redis.module) redisArgs.push('--loadmodule', redis.module);

    // In production, keep data in the user's Application Support folder. Its own "redis" subfolder,
    // so a dump written by a different Redis version (e.g. the v1.0 app used Homebrew's Redis 8)
    // can't stop the bundled Redis from starting. Redis is only a cache: data restores from the cloud.
    if (!isDev) {
      const appDataDir = path.join(app.getPath('appData'), 'Tell Me', 'redis');
      fs.mkdirSync(appDataDir, { recursive: true });
      redisArgs.push('--dir', appDataDir);
    }

    console.log('Launching local Redis Server...');
    redisProcess = spawn(redis.bin, redisArgs);
    redisProcess.on('error', (err) => console.error('Failed to launch Redis:', err.message));
    redisProcess.stdout.on('data', (data) => console.log(`[Redis Stdout]: ${data}`));
    redisProcess.stderr.on('data', (data) => console.error(`[Redis Stderr]: ${data}`));
  } catch (err) {
    console.error('Failed to launch local Redis server sidecar:', err);
  }

  // 2. Compiled FastAPI backend.
  if (fs.existsSync(backendBinPath)) {
    try {
      console.log('Launching local FastAPI Python Backend...');
      const env = {
        ...process.env,
        PORT: '8000',
        HOST: '127.0.0.1',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        // Bundled tools first (ffmpeg for links, if present), then common Homebrew locations.
        PATH: `${path.join(process.resourcesPath || '', 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}`,
      };
      backendProcess = spawn(backendBinPath, [], { env, cwd: path.dirname(backendBinPath) });
      backendProcess.on('error', (err) => console.error('Failed to launch backend:', err.message));
      backendProcess.stdout.on('data', (data) => console.log(`[Backend Stdout]: ${data}`));
      backendProcess.stderr.on('data', (data) => console.error(`[Backend Stderr]: ${data}`));
    } catch (err) {
      console.error('Failed to launch compiled FastAPI backend sidecar:', err);
    }
  } else {
    console.warn(`FastAPI backend binary not found at ${backendBinPath}. Launching UI only.`);
  }
}

function stopServices() {
  console.log('Stopping background sidecar services...');
  if (backendProcess) backendProcess.kill('SIGTERM');
  if (redisProcess) redisProcess.kill('SIGTERM');
}

app.on('ready', () => {
  // Serve the Next.js static export from app://
  protocol.handle('app', (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const cleanPath = parsedUrl.pathname === '/' ? 'index.html' : decodeURIComponent(parsedUrl.pathname);
      const outDir = path.join(__dirname, 'out');
      let filePath = path.normalize(path.join(outDir, cleanPath));

      // Never serve files outside the export folder; fall back to the app shell.
      if (!filePath.startsWith(outDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(outDir, 'index.html');
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (e) {
      console.error('Failed to route custom protocol:', e);
      return new Response('Protocol routing error', { status: 500 });
    }
  });

  startServices();
  // The page itself waits for the backend's /health, so a short head start is enough.
  setTimeout(createWindow, 300);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', () => {
  stopServices();
});

// If the app is terminated (not quit normally), still stop Redis and the backend so they don't
// keep holding ports 6379/8000 for the next launch.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    stopServices();
    app.quit();
  });
}
